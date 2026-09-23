import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeGitHub, loadFixture } from '../src/server/fake-github';
import { startServer, type RunningServer } from '../src/server/server';
import { parseDrafts, readJson, sessionFiles } from '../src/server/session';
import type { Results, SessionPayload, SessionState } from '../src/shared/schema';

const fixtureDir = join(import.meta.dirname, 'fixtures/large-pr');
let running: RunningServer | null = null;

afterEach(async () => {
  await running?.close();
  running = null;
});

async function boot() {
  const sessionDir = mkdtempSync(join(tmpdir(), 'crf-test-'));
  const drafts = parseDrafts(JSON.parse(readFileSync(join(fixtureDir, 'drafts.json'), 'utf8')));
  const github = new FakeGitHub(loadFixture(fixtureDir));
  const finished: string[] = [];
  running = await startServer({ sessionDir, drafts, github, webDir: null, fixture: true, onFinish: (status) => finished.push(status) });
  const base = new URL(running.url).origin;
  const token = running.token;
  const api = async <T>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> => {
    const response = await fetch(base + path, {
      method,
      headers: { 'x-crf-token': token, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, json: (await response.json()) as T };
  };
  return { api, base, github, sessionDir, finished, drafts };
}

describe('review app server', () => {
  it('rejects API calls without the session token', async () => {
    const { base } = await boot();
    expect((await fetch(`${base}/api/session`)).status).toBe(401);
  });

  it('answers a missing static file with a 404 and keeps running', async () => {
    const { base } = await boot();
    expect((await fetch(`${base}/favicon.ico`)).status).toBe(404);
    expect((await fetch(`${base}/api/session`)).status).toBe(401);
  });

  it('posts only the replies marked send, exactly as edited, and retries failures without double posting', async () => {
    const { api, github, sessionDir, finished, drafts } = await boot();
    const { json: session } = await api<SessionPayload>('GET', '/api/session');
    const [first, second, failing] = session.items;
    const summary = session.items.find((item) => item.id === 'summary')!;

    const edited = 'Fixed in abc123.\n\nThanks @jordan-k — nice catch.  ';
    await api('PUT', `/api/items/${first!.id}`, { action: 'send', body: edited });
    await api('PUT', `/api/items/${second!.id}`, { action: 'skip' });
    await api('PUT', `/api/items/${failing!.id}`, { action: 'send' });
    await api('PUT', `/api/items/${summary.id}`, { action: 'send' });

    const { json: afterFirst } = await api<SessionState>('POST', '/api/post', {});
    expect(afterFirst.items[failing!.id]!.error).toMatch(/502/);
    expect(afterFirst.items[failing!.id]!.postedUrl).toBeNull();
    expect(github.posts).toEqual([
      { kind: 'thread', commentId: first!.commentId, body: edited },
      { kind: 'comment', commentId: null, body: drafts.summary!.draft },
    ]);

    const { json: afterRetry } = await api<SessionState>('POST', '/api/post', { ids: [failing!.id, first!.id] });
    expect(afterRetry.items[failing!.id]!.postedUrl).toMatch(/discussion_r/);
    expect(github.posts).toHaveLength(3);

    expect((await api('PUT', `/api/items/${first!.id}`, { body: 'changed' })).status).toBe(409);

    await api('POST', '/api/finish', { status: 'done' });
    expect(finished).toEqual(['done']);
    const results = readJson<Results>(sessionFiles(sessionDir).results);
    expect(results.status).toBe('done');
    expect(results.items.find((item) => item.id === first!.id)).toMatchObject({ action: 'send', body: edited });
    expect(results.items.find((item) => item.id === second!.id)).toMatchObject({ action: 'skip', postedUrl: null });
  });

  it('keeps edits across a restart', async () => {
    const first = await boot();
    const { json: session } = await first.api<SessionPayload>('GET', '/api/session');
    const id = session.items[0]!.id;
    await first.api('PUT', `/api/items/${id}`, { action: 'skip', body: 'kept' });
    await running!.close();

    running = await startServer({
      sessionDir: first.sessionDir,
      drafts: first.drafts,
      github: first.github,
      webDir: null,
      fixture: true,
    });
    const response = await fetch(`${new URL(running.url).origin}/api/session`, { headers: { 'x-crf-token': running.token } });
    const reloaded = (await response.json()) as SessionPayload;
    expect(reloaded.state.items[id]).toMatchObject({ action: 'skip', body: 'kept' });
  });

  it('suggests PR participants before other repo members', async () => {
    const { api } = await boot();
    const { json } = await api<Array<{ login: string }>>('GET', '/api/mentions?q=j');
    expect(json.map((user) => user.login)).toEqual(['jordan-k', 'jamie-l']);
  });
});
