import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, sep } from 'node:path';
import { rankMentions } from '../shared/mentions';
import {
  Action,
  type Drafts,
  type FilePatch,
  type PullRequest,
  type ResultStatus,
  type SessionItem,
  type SessionPayload,
  type SessionState,
} from '../shared/schema';
import type { GitHub } from './github';
import { buildItems, buildResults, initialState, readSavedState, sessionFiles, writeJson } from './session';

export interface ServerOptions {
  sessionDir: string;
  drafts: Drafts;
  github: GitHub;
  webDir: string | null;
  fixture: boolean;
  port?: number;
  onFinish?: (status: ResultStatus) => void;
}

export interface RunningServer {
  server: Server;
  url: string;
  token: string;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'request body is not JSON');
  }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const { drafts, github, sessionDir } = options;
  const token = randomBytes(24).toString('hex');
  const files = sessionFiles(sessionDir);

  const pr: PullRequest = await github.loadPullRequest(drafts.pr);
  const items: SessionItem[] = buildItems(drafts, pr);
  const state: SessionState = initialState(items, readSavedState(sessionDir));
  writeJson(files.state, state);

  let filePatches: Promise<FilePatch[]> | null = null;
  let posting = false;

  const itemById = (id: string): SessionItem => {
    const item = items.find((candidate) => candidate.id === id);
    if (!item) throw new HttpError(404, `no item "${id}"`);
    return item;
  };

  const save = (): void => writeJson(files.state, state);

  const postItem = async (item: SessionItem): Promise<void> => {
    const itemState = state.items[item.id]!;
    if (itemState.action !== 'send' || itemState.postedUrl) return;
    if (itemState.body.trim() === '') {
      itemState.error = 'The reply is empty. Write something or skip it.';
      save();
      return;
    }
    try {
      itemState.postedUrl =
        item.kind === 'thread'
          ? await github.replyToThread(drafts.pr, item.commentId!, itemState.body)
          : await github.createComment(drafts.pr, itemState.body);
      itemState.error = null;
    } catch (error) {
      itemState.error = errorMessage(error);
    }
    save();
  };

  const authorized = (request: IncomingMessage): boolean => {
    const given = Buffer.from(String(request.headers['x-crf-token'] ?? ''));
    const expected = Buffer.from(token);
    return given.length === expected.length && timingSafeEqual(given, expected);
  };

  const serveStatic = (pathname: string, response: ServerResponse): void => {
    if (!options.webDir) throw new HttpError(404, 'no web build');
    const relative = normalize(pathname === '/' ? 'index.html' : pathname.slice(1));
    const path = join(options.webDir, relative);
    if (!path.startsWith(options.webDir + sep) || !existsSync(path)) throw new HttpError(404, 'not found');
    response.writeHead(200, {
      'content-type': MIME[extname(path)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    response.end(readFileSync(path));
  };

  const handleApi = async (request: IncomingMessage, url: URL, response: ServerResponse): Promise<void> => {
    if (!authorized(request)) throw new HttpError(401, 'missing or wrong session token');
    const route = `${request.method} ${url.pathname}`;

    if (route === 'GET /api/session') {
      const payload: SessionPayload = { pr, items, state, fixture: options.fixture };
      return send(response, 200, payload);
    }

    const itemMatch = /^PUT \/api\/items\/([^/]+)$/.exec(route);
    if (itemMatch) {
      const item = itemById(decodeURIComponent(itemMatch[1]!));
      const itemState = state.items[item.id]!;
      if (itemState.postedUrl) throw new HttpError(409, 'this reply has already been posted');
      const body = (await readBody(request)) as { action?: unknown; body?: unknown };
      if (body.action !== undefined) {
        const action = body.action === null ? { success: true as const, data: null } : Action.safeParse(body.action);
        if (!action.success) throw new HttpError(400, 'action must be "send", "skip", or null');
        itemState.action = action.data;
      }
      if (typeof body.body === 'string') itemState.body = body.body;
      itemState.error = null;
      save();
      return send(response, 200, itemState);
    }

    if (route === 'GET /api/mentions') {
      const query = url.searchParams.get('q') ?? '';
      const others = query.length > 0 ? await github.searchMentionable(drafts.pr, query).catch(() => []) : [];
      return send(response, 200, rankMentions(query, pr.participants, others));
    }

    if (route === 'POST /api/preview') {
      const { text } = (await readBody(request)) as { text?: unknown };
      const html = await github.renderMarkdown(drafts.pr, typeof text === 'string' ? text : '');
      return send(response, 200, { html });
    }

    if (route === 'GET /api/file') {
      const path = url.searchParams.get('path') ?? '';
      filePatches ??= github.listFiles(drafts.pr).catch((error: unknown) => {
        filePatches = null;
        throw error;
      });
      const file = (await filePatches).find((candidate) => candidate.path === path);
      if (!file) throw new HttpError(404, `no changed file "${path}"`);
      return send(response, 200, file);
    }

    if (route === 'POST /api/post') {
      if (posting) throw new HttpError(409, 'already posting');
      const { ids } = (await readBody(request)) as { ids?: unknown };
      const wanted = Array.isArray(ids) ? ids.map(String) : items.map((item) => item.id);
      posting = true;
      try {
        for (const id of wanted) await postItem(itemById(id));
      } finally {
        posting = false;
      }
      return send(response, 200, state);
    }

    if (route === 'POST /api/finish') {
      const { status } = (await readBody(request)) as { status?: unknown };
      if (status !== 'done' && status !== 'canceled') throw new HttpError(400, 'status must be "done" or "canceled"');
      writeJson(files.results, buildResults(status, drafts, items, state));
      send(response, 200, { ok: true });
      options.onFinish?.(status);
      return;
    }

    throw new HttpError(404, `no route ${route}`);
  };

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const handled = (async () =>
      url.pathname.startsWith('/api/') ? handleApi(request, url, response) : serveStatic(url.pathname, response))();
    handled.catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500;
      if (!response.headersSent) send(response, status, { error: errorMessage(error) });
    });
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    server,
    token,
    url: `http://127.0.0.1:${port}/?token=${token}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
