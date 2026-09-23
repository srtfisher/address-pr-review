import { describe, expect, it } from 'vitest';
import { GhGitHub, parsePrUrl } from '../src/server/github';

const ref = { owner: 'acme', repo: 'storefront', number: 482 };

function recorder(response: string) {
  const calls: Array<{ args: string[]; input: string | undefined }> = [];
  const gh = async (args: string[], input?: string) => {
    calls.push({ args, input });
    return response;
  };
  return { calls, gh };
}

describe('GhGitHub posting', () => {
  const body = 'Line one\n\nLine two with `code`, "quotes", a trailing space \nand @jordan-k.';

  it('replies in a thread with the body passed on stdin untouched', async () => {
    const { calls, gh } = recorder(JSON.stringify({ html_url: 'https://github.com/x#r1' }));
    const url = await new GhGitHub(gh).replyToThread(ref, 123, body);
    expect(url).toBe('https://github.com/x#r1');
    expect(calls[0]!.args).toEqual(['api', '-X', 'POST', 'repos/acme/storefront/pulls/482/comments/123/replies', '--input', '-']);
    expect(JSON.parse(calls[0]!.input!)).toEqual({ body });
  });

  it('posts top-level comments on the issue', async () => {
    const { calls, gh } = recorder(JSON.stringify({ html_url: 'https://github.com/x#c1' }));
    await new GhGitHub(gh).createComment(ref, body);
    expect(calls[0]!.args[3]).toBe('repos/acme/storefront/issues/482/comments');
    expect(JSON.parse(calls[0]!.input!).body).toBe(body);
  });
});

describe('GhGitHub reads', () => {
  it('pages through a connection until it runs out', async () => {
    let call = 0;
    const gh = async (args: string[]) => {
      const query = args.find((arg) => arg.startsWith('query='))!;
      if (!query.includes('$after')) {
        return JSON.stringify({
          data: { repository: { pullRequest: { title: 't', url: 'u', headRefName: 'h', baseRefName: 'b', author: null, participants: { nodes: [] }, assignees: { nodes: [] }, reviewRequests: { nodes: [] } } } },
        });
      }
      const connection = ['reviewThreads', 'comments', 'reviews'].find((name) => query.includes(`${name}(first`))!;
      const second = connection === 'comments' && args.includes('after=CURSOR');
      if (connection === 'comments') call++;
      const node = { databaseId: second ? 2 : 1, author: { login: 'a', avatarUrl: '' }, body: '', bodyHTML: '', createdAt: '', url: '' };
      return JSON.stringify({
        data: { repository: { pullRequest: { [connection]: {
          pageInfo: { hasNextPage: connection === 'comments' && !second, endCursor: 'CURSOR' },
          nodes: connection === 'comments' ? [node] : [],
        } } } },
      });
    };
    const pr = await new GhGitHub(gh).loadPullRequest(ref);
    expect(call).toBe(2);
    expect(pr.comments.map((comment) => comment.id)).toEqual([1, 2]);
    expect(pr.participants.map((user) => user.login)).toEqual(['a']);
  });

  it('parses PR URLs', () => {
    expect(parsePrUrl('https://github.com/acme/storefront/pull/482/files')).toEqual(ref);
    expect(parsePrUrl('nope')).toBeNull();
  });
});
