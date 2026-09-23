import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeGitHub, loadFixture } from '../src/server/fake-github';
import { postApproved } from '../src/server/post';
import { buildItems, buildResults, initialState, parseDrafts, readJson, sessionFiles, writeJson } from '../src/server/session';
import type { Results } from '../src/shared/schema';

const fixtureDir = join(import.meta.dirname, 'fixtures/large-pr');

function approvedSession(status: Results['status'] = 'approved') {
  const dir = mkdtempSync(join(tmpdir(), 'crf-post-'));
  const drafts = parseDrafts(JSON.parse(readFileSync(join(fixtureDir, 'drafts.json'), 'utf8')));
  const fixture = loadFixture(fixtureDir);
  const items = buildItems(drafts, fixture.pr);
  const state = initialState(items);
  const [first, second, failing] = items;
  state.items[first!.id] = { ...state.items[first!.id]!, action: 'send', body: 'Fixed.\n\nExactly this  ' };
  state.items[second!.id] = { ...state.items[second!.id]!, action: 'skip' };
  state.items[failing!.id] = { ...state.items[failing!.id]!, action: 'send' };
  state.items.summary = { ...state.items.summary!, action: 'send' };
  const files = sessionFiles(dir);
  writeJson(files.drafts, drafts);
  writeJson(files.state, state);
  writeJson(files.results, buildResults(status, drafts, items, state));
  return { dir, github: new FakeGitHub(fixture), first: first!, failing: failing!, summaryDraft: drafts.summary!.draft };
}

describe('postApproved', () => {
  it('refuses to post a round the human did not approve', async () => {
    const { dir, github } = approvedSession('revise');
    await expect(postApproved(dir, github)).rejects.toThrow(/not approved/);
    expect(github.posts).toEqual([]);
  });

  it('posts the approved text byte for byte, threads before the general comment', async () => {
    const { dir, github, first, summaryDraft } = approvedSession();
    const outcomes = await postApproved(dir, github);
    expect(github.posts).toEqual([
      { kind: 'thread', commentId: first.commentId, body: 'Fixed.\n\nExactly this  ' },
      { kind: 'comment', commentId: null, body: summaryDraft },
    ]);
    expect(outcomes.filter((outcome) => outcome.error)).toHaveLength(1);
  });

  it('retries only what failed when run again', async () => {
    const { dir, github, failing } = approvedSession();
    await postApproved(dir, github);
    const again = await postApproved(dir, github);
    expect(github.posts).toHaveLength(3);
    expect(again.every((outcome) => outcome.postedUrl && !outcome.error)).toBe(true);
    const results = readJson<Results>(sessionFiles(dir).results);
    expect(results.items.find((item) => item.id === failing.id)!.postedUrl).toMatch(/discussion_r/);
  });
});
