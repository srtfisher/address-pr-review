import { spawn } from 'node:child_process';
import type { Comment, FilePatch, PrRef, PullRequest, Review, Thread, User } from '../shared/schema';

/** Everything the app needs from GitHub. The gh-backed version is the only code that talks to GitHub. */
export interface GitHub {
  checkAuth(): Promise<void>;
  resolvePr(input?: string): Promise<PrRef>;
  loadPullRequest(ref: PrRef): Promise<PullRequest>;
  listFiles(ref: PrRef): Promise<FilePatch[]>;
  searchMentionable(ref: PrRef, query: string): Promise<User[]>;
  renderMarkdown(ref: PrRef, text: string): Promise<string>;
  replyToThread(ref: PrRef, commentId: number, body: string): Promise<string>;
  createComment(ref: PrRef, body: string): Promise<string>;
}

export class GhError extends Error {}

export type GhRunner = (args: string[], input?: string) => Promise<string>;

export function runGh(args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error: NodeJS.ErrnoException) => {
      reject(new GhError(error.code === 'ENOENT' ? 'The GitHub CLI (gh) is not installed or not on PATH.' : error.message));
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString('utf8'));
      } else {
        const message = Buffer.concat(stderr).toString('utf8').trim() || Buffer.concat(stdout).toString('utf8').trim();
        reject(new GhError(`gh ${args[0] ?? ''} failed: ${message || `exit code ${code}`}`));
      }
    });
    child.stdin.end(input ?? '');
  });
}

export function parsePrUrl(input: string): PrRef | null {
  const match = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(input);
  if (!match) {
    return null;
  }
  return { owner: match[1]!, repo: match[2]!, number: Number(match[3]) };
}

const USER_FIELDS = 'login avatarUrl ... on User { name }';
const COMMENT_FIELDS = `databaseId author { ${USER_FIELDS} } body bodyHTML createdAt url`;

interface GqlUser {
  login: string;
  avatarUrl: string;
  name?: string | null;
}

interface GqlComment {
  databaseId: number;
  author: GqlUser | null;
  body: string;
  bodyHTML: string;
  createdAt: string;
  url: string;
}

interface GqlThread {
  id: string;
  path: string;
  line: number | null;
  startLine: number | null;
  originalLine: number | null;
  isOutdated: boolean;
  isResolved: boolean;
  comments: { nodes: Array<GqlComment & { diffHunk: string }> };
}

interface GqlReview {
  databaseId: number;
  author: GqlUser | null;
  state: string;
  body: string;
  bodyHTML: string;
  submittedAt: string | null;
  url: string;
}

interface Page<T> {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: T[];
}

const toUser = (user: GqlUser | null): User | null =>
  user ? { login: user.login, name: user.name ?? null, avatarUrl: user.avatarUrl } : null;

const toComment = (comment: GqlComment): Comment => ({
  id: comment.databaseId,
  author: toUser(comment.author),
  body: comment.body,
  bodyHTML: comment.bodyHTML,
  createdAt: comment.createdAt,
  url: comment.url,
});

export class GhGitHub implements GitHub {
  constructor(private readonly gh: GhRunner = runGh) {}

  async checkAuth(): Promise<void> {
    await this.gh(['auth', 'status']);
  }

  async resolvePr(input?: string): Promise<PrRef> {
    if (input) {
      const fromUrl = parsePrUrl(input);
      if (fromUrl) {
        return fromUrl;
      }
      if (/^\d+$/.test(input)) {
        const repo = JSON.parse(await this.gh(['repo', 'view', '--json', 'owner,name'])) as { owner: { login: string }; name: string };
        return { owner: repo.owner.login, repo: repo.name, number: Number(input) };
      }
      throw new GhError(`Could not read "${input}" as a pull request number or URL.`);
    }
    const pr = JSON.parse(await this.gh(['pr', 'view', '--json', 'url'])) as { url: string };
    const ref = parsePrUrl(pr.url);
    if (!ref) {
      throw new GhError(`Unexpected pull request URL from gh: ${pr.url}`);
    }
    return ref;
  }

  private async graphql<T>(query: string, variables: Record<string, string | number | null>): Promise<T> {
    const args = ['api', 'graphql', '-f', `query=${query}`];
    for (const [key, value] of Object.entries(variables)) {
      if (value === null) continue;
      args.push(typeof value === 'number' ? '-F' : '-f', `${key}=${value}`);
    }
    const response = JSON.parse(await this.gh(args)) as { data?: T; errors?: Array<{ message: string }> };
    if (response.errors?.length || !response.data) {
      throw new GhError(`GitHub GraphQL error: ${response.errors?.map((e) => e.message).join('; ') ?? 'no data'}`);
    }
    return response.data;
  }

  private async paginate<T>(ref: PrRef, connection: string, fields: string): Promise<T[]> {
    const query = `query($owner: String!, $repo: String!, $number: Int!, $after: String) {
      repository(owner: $owner, name: $repo) { pullRequest(number: $number) {
        ${connection}(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${fields} } }
      } }
    }`;
    const nodes: T[] = [];
    let after: string | null = null;
    do {
      const data: { repository: { pullRequest: Record<string, Page<T>> } } = await this.graphql(query, { ...ref, after });
      const page = data.repository.pullRequest[connection]!;
      nodes.push(...page.nodes);
      after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (after);
    return nodes;
  }

  async loadPullRequest(ref: PrRef): Promise<PullRequest> {
    const meta = await this.graphql<{
      repository: {
        pullRequest: {
          title: string;
          url: string;
          headRefName: string;
          baseRefName: string;
          author: GqlUser | null;
          participants: { nodes: GqlUser[] };
          assignees: { nodes: GqlUser[] };
          reviewRequests: { nodes: Array<{ requestedReviewer: GqlUser | null }> };
        };
      };
    }>(
      `query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) { pullRequest(number: $number) {
          title url headRefName baseRefName author { ${USER_FIELDS} }
          participants(first: 100) { nodes { login avatarUrl name } }
          assignees(first: 50) { nodes { login avatarUrl name } }
          reviewRequests(first: 50) { nodes { requestedReviewer { ... on User { login avatarUrl name } } } }
        } }
      }`,
      { ...ref },
    );
    const [threads, comments, reviews] = await Promise.all([
      this.paginate<GqlThread>(
        ref,
        'reviewThreads',
        `id path line startLine originalLine isOutdated isResolved comments(first: 100) { nodes { ${COMMENT_FIELDS} diffHunk } }`,
      ),
      this.paginate<GqlComment>(ref, 'comments', COMMENT_FIELDS),
      this.paginate<GqlReview>(ref, 'reviews', `databaseId author { ${USER_FIELDS} } state body bodyHTML submittedAt url`),
    ]);

    const pr = meta.repository.pullRequest;
    const people = new Map<string, User>();
    const addPerson = (user: GqlUser | null | undefined): void => {
      if (user?.login && !people.has(user.login)) {
        people.set(user.login, toUser(user)!);
      }
    };
    addPerson(pr.author);
    pr.participants.nodes.forEach(addPerson);
    pr.assignees.nodes.forEach(addPerson);
    pr.reviewRequests.nodes.forEach((request) => addPerson(request.requestedReviewer));
    threads.forEach((thread) => thread.comments.nodes.forEach((comment) => addPerson(comment.author)));
    comments.forEach((comment) => addPerson(comment.author));

    return {
      ...ref,
      title: pr.title,
      url: pr.url,
      headRefName: pr.headRefName,
      baseRefName: pr.baseRefName,
      author: toUser(pr.author),
      participants: [...people.values()],
      threads: threads.map(
        (thread): Thread => ({
          id: thread.id,
          path: thread.path,
          line: thread.line,
          startLine: thread.startLine,
          originalLine: thread.originalLine,
          isOutdated: thread.isOutdated,
          isResolved: thread.isResolved,
          diffHunk: thread.comments.nodes[0]?.diffHunk ?? '',
          comments: thread.comments.nodes.map(toComment),
        }),
      ),
      comments: comments.map(toComment),
      reviews: reviews.map(
        (review): Review => ({
          id: review.databaseId,
          author: toUser(review.author),
          state: review.state,
          body: review.body,
          bodyHTML: review.bodyHTML,
          submittedAt: review.submittedAt,
          url: review.url,
        }),
      ),
    };
  }

  async listFiles(ref: PrRef): Promise<FilePatch[]> {
    const output = await this.gh([
      'api',
      `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/files`,
      '--paginate',
      '--jq',
      '.[] | {path: .filename, status, additions, deletions, patch}',
    ]);
    return output
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => {
        const file = JSON.parse(line) as FilePatch;
        return { ...file, patch: file.patch ?? null };
      });
  }

  async searchMentionable(ref: PrRef, query: string): Promise<User[]> {
    const data = await this.graphql<{ repository: { mentionableUsers: { nodes: GqlUser[] } } }>(
      `query($owner: String!, $repo: String!, $query: String!) {
        repository(owner: $owner, name: $repo) { mentionableUsers(query: $query, first: 10) { nodes { login avatarUrl name } } }
      }`,
      { owner: ref.owner, repo: ref.repo, query },
    );
    return data.repository.mentionableUsers.nodes.map((user) => toUser(user)!);
  }

  renderMarkdown(ref: PrRef, text: string): Promise<string> {
    return this.gh(['api', 'markdown', '--input', '-'], JSON.stringify({ text, mode: 'gfm', context: `${ref.owner}/${ref.repo}` }));
  }

  async replyToThread(ref: PrRef, commentId: number, body: string): Promise<string> {
    return this.post(`repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/comments/${commentId}/replies`, body);
  }

  async createComment(ref: PrRef, body: string): Promise<string> {
    return this.post(`repos/${ref.owner}/${ref.repo}/issues/${ref.number}/comments`, body);
  }

  private async post(path: string, body: string): Promise<string> {
    const response = JSON.parse(await this.gh(['api', '-X', 'POST', path, '--input', '-'], JSON.stringify({ body }))) as {
      html_url: string;
    };
    return response.html_url;
  }
}
