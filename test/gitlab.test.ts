import { describe, expect, it } from 'vitest';
import { GlabGitLab, hunkUpTo, parseMrUrl } from '../src/server/gitlab';

const ref = { owner: 'acme/platform', repo: 'storefront', number: 482, provider: 'gitlab' as const };
const mrPath = 'projects/acme%2Fplatform%2Fstorefront/merge_requests/482';

/** Answers glab calls by the first matching path fragment, and records every call. */
function fakeGlab(routes: Array<[string, unknown]>) {
  const calls: string[][] = [];
  const glab = async (args: string[]) => {
    calls.push(args);
    const path = args.find((arg) => arg.startsWith('projects/') || arg === 'markdown') ?? '';
    const route = routes.find(([fragment]) => path.includes(fragment));
    if (!route) throw new Error(`unexpected glab call: ${args.join(' ')}`);
    return JSON.stringify(route[1]);
  };
  return { calls, glab };
}

const note = (id: number, body: string, extra: object = {}) => ({
  id,
  body,
  author: { username: 'vijay', name: 'Vijay', avatar_url: 'https://a/v.png' },
  created_at: '2026-11-26T10:00:00Z',
  system: false,
  resolvable: true,
  resolved: false,
  ...extra,
});

describe('parseMrUrl', () => {
  it('reads nested groups and the iid', () => {
    expect(parseMrUrl('https://gitlab.com/energyzero/backend/backend/-/merge_requests/10208#note_1')).toEqual({
      owner: 'energyzero/backend',
      repo: 'backend',
      number: 10208,
      provider: 'gitlab',
    });
  });

  it('ignores GitHub URLs', () => {
    expect(parseMrUrl('https://github.com/acme/storefront/pull/482')).toBeNull();
  });
});

describe('hunkUpTo', () => {
  const patch = '@@ -1,3 +1,4 @@\n a\n-b\n+c\n+d\n e\n@@ -20,2 +21,2 @@\n x\n+y';

  it('cuts the hunk at the commented new-side line', () => {
    expect(hunkUpTo(patch, 3)).toBe('@@ -1,3 +1,4 @@\n a\n-b\n+c\n+d');
    expect(hunkUpTo(patch, 22)).toBe('@@ -20,2 +21,2 @@\n x\n+y');
  });

  it('is empty for lines outside the diff', () => {
    expect(hunkUpTo(patch, 10)).toBe('');
    expect(hunkUpTo(null, 3)).toBe('');
  });
});

describe('GlabGitLab', () => {
  const discussions = [
    { id: 'd-open', individual_note: false, notes: [note(1, 'Rename this', { position: { new_path: 'a.go', new_line: 2 } }), note(2, 'Agreed')] },
    { id: 'd-done', individual_note: false, notes: [note(3, 'Fixed?', { resolved: true })] },
    { id: 'd-general', individual_note: true, notes: [note(4, 'LGTM overall', { resolvable: false })] },
    { id: 'd-system', individual_note: true, notes: [note(5, 'added 1 commit', { system: true, resolvable: false })] },
  ];
  const routes: Array<[string, unknown]> = [
    ['/discussions', discussions],
    ['/diffs', [{ new_path: 'a.go', old_path: 'a.go', new_file: false, deleted_file: false, renamed_file: false, diff: '@@ -1,2 +1,2 @@\n x\n+y\n' }]],
    ['markdown', { html: '<p>rendered</p>' }],
    [mrPath, { title: 'Add a thing', web_url: 'https://gitlab.com/acme/platform/storefront/-/merge_requests/482', source_branch: 'feat', target_branch: 'main', author: { username: 'casper' } }],
  ];

  it('maps resolvable discussions to threads and individual notes to comments', async () => {
    const { glab } = fakeGlab(routes);
    const pr = await new GlabGitLab(glab).loadPullRequest(ref);
    expect(pr.threads.map((t) => [t.id, t.path, t.line, t.isResolved])).toEqual([
      ['d-open', 'a.go', 2, false],
      ['d-done', '', null, true],
    ]);
    expect(pr.threads[0]!.diffHunk).toBe('@@ -1,2 +1,2 @@\n x\n+y');
    expect(pr.threads[0]!.comments[1]!.url).toBe('https://gitlab.com/acme/platform/storefront/-/merge_requests/482#note_2');
    expect(pr.comments.map((c) => c.body)).toEqual(['LGTM overall']);
    expect(pr.reviews).toEqual([]);
    expect(pr.participants.map((p) => p.login)).toEqual(['casper', 'vijay']);
  });

  it('replies in the discussion that holds the comment', async () => {
    const { calls, glab } = fakeGlab([['/discussions/d-open/notes', { id: 9 }], ...routes]);
    const url = await new GlabGitLab(glab).replyToThread(ref, 2, 'Done, `x` and "y".');
    expect(url).toBe('https://gitlab.com/acme/platform/storefront/-/merge_requests/482#note_9');
    const post = calls.find((args) => args.includes('POST'))!;
    expect(post).toEqual(['api', '-X', 'POST', `${mrPath}/discussions/d-open/notes`, '-f', 'body=Done, `x` and "y".']);
  });

  it('resolves a discussion by id', async () => {
    const { calls, glab } = fakeGlab([['/discussions/d-open', {}]]);
    await new GlabGitLab(glab).resolveThread(ref, 'd-open');
    expect(calls[0]).toEqual(['api', '-X', 'PUT', `${mrPath}/discussions/d-open`, '-F', 'resolved=true']);
  });
});
