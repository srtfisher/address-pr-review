import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeGit, FakeGitHub, loadFixture } from '../src/server/fake-github';
import { startServer, type RunningServer } from '../src/server/server';
import { parseDrafts, readJson, sessionFiles } from '../src/server/session';
import type { FilePatch, Results, SessionPayload } from '../src/shared/schema';

const fixtureDir = join(import.meta.dirname, 'fixtures/large-pr');
let running: RunningServer | null = null;

afterEach(async () => {
  await running?.close();
  running = null;
});

async function boot(sessionDir = mkdtempSync(join(tmpdir(), 'crf-test-'))) {
  const drafts = parseDrafts(JSON.parse(readFileSync(join(fixtureDir, 'drafts.json'), 'utf8')));
  const fixture = loadFixture(fixtureDir);
  const github = new FakeGitHub(fixture);
  const finished: string[] = [];
  running = await startServer({
    sessionDir,
    drafts,
    github,
    git: new FakeGit(fixture),
    webDir: null,
    fixture: true,
    onFinish: (status) => finished.push(status),
  });
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

  it('never posts to GitHub itself', async () => {
    const { api, github } = await boot();
    const { json: session } = await api<SessionPayload>('GET', '/api/session');
    await api('PUT', `/api/items/${session.items[0]!.id}`, { action: 'send' });
    expect((await api('POST', '/api/post', {})).status).toBe(404);
    await api('POST', '/api/finish', { status: 'approved' });
    expect(github.posts).toEqual([]);
  });

  it('hands approved replies back exactly as edited', async () => {
    const { api, sessionDir, finished } = await boot();
    const { json: session } = await api<SessionPayload>('GET', '/api/session');
    const [first, second] = session.items;
    const edited = 'Fixed in abc123.\n\nThanks @jordan-k — nice catch.  ';
    await api('PUT', `/api/items/${first!.id}`, { action: 'send', body: edited });
    await api('PUT', `/api/items/${second!.id}`, { action: 'skip' });

    expect((await api('POST', '/api/finish', { status: 'approved' })).status).toBe(200);
    expect(finished).toEqual(['approved']);
    const results = readJson<Results>(sessionFiles(sessionDir).results);
    expect(results.status).toBe('approved');
    expect(results.items.find((item) => item.id === first!.id)).toMatchObject({ action: 'send', body: edited });
    expect(results.items.find((item) => item.id === second!.id)).toMatchObject({ action: 'skip', postedUrl: null });
  });

  it('sends items back to the agent only with a note on each', async () => {
    const { api, sessionDir } = await boot();
    const { json: session } = await api<SessionPayload>('GET', '/api/session');
    const id = session.items[0]!.id;

    expect((await api('POST', '/api/finish', { status: 'revise' })).status).toBe(409);
    await api('PUT', `/api/items/${id}`, { action: 'ask' });
    expect((await api('POST', '/api/finish', { status: 'approved' })).status).toBe(409);
    expect((await api('POST', '/api/finish', { status: 'revise' })).status).toBe(409);

    await api('PUT', `/api/items/${id}`, { instructions: 'Revert this, the old message was fine.' });
    expect((await api('POST', '/api/finish', { status: 'revise' })).status).toBe(200);
    const results = readJson<Results>(sessionFiles(sessionDir).results);
    expect(results.status).toBe('revise');
    expect(results.items[0]).toMatchObject({ id, action: 'ask', instructions: 'Revert this, the old message was fine.' });
  });

  it('rejects an unknown action', async () => {
    const { api } = await boot();
    const { json: session } = await api<SessionPayload>('GET', '/api/session');
    expect((await api('PUT', `/api/items/${session.items[0]!.id}`, { action: 'post' })).status).toBe(400);
  });

  it('shows the diff of a commit an item lists, and no other', async () => {
    const { api } = await boot();
    const { json: session } = await api<SessionPayload>('GET', '/api/session');
    const sha = session.items.find((item) => item.commits.length)!.commits[0]!;
    const { status, json } = await api<FilePatch[]>('GET', `/api/commit?sha=${sha}`);
    expect(status).toBe(200);
    expect(json[0]!.patch).toMatch(/^@@ /);
    expect((await api('GET', '/api/commit?sha=deadbeef')).status).toBe(404);
  });

  it('suggests PR participants before other repo members', async () => {
    const { api } = await boot();
    const { json } = await api<Array<{ login: string }>>('GET', '/api/mentions?q=j');
    expect(json.map((user) => user.login)).toEqual(['jordan-k', 'jamie-l']);
  });

  it('keeps edits across a restart', async () => {
    const first = await boot();
    const { json: session } = await first.api<SessionPayload>('GET', '/api/session');
    const id = session.items[0]!.id;
    await first.api('PUT', `/api/items/${id}`, { action: 'skip', body: 'kept' });
    await running!.close();

    const second = await boot(first.sessionDir);
    const { json: reloaded } = await second.api<SessionPayload>('GET', '/api/session');
    expect(reloaded.state.items[id]).toMatchObject({ action: 'skip', body: 'kept' });
  });
});
