import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FilePatch, PrRef, PullRequest, User } from '../shared/schema';
import type { GitHub } from './github';
import type { LocalGit } from './local-git';

export interface FakePost {
  kind: 'thread' | 'comment';
  commentId: number | null;
  body: string;
}

export interface FixtureData {
  pr: PullRequest;
  files: FilePatch[];
  users: User[];
  /** Thread comment ids whose first reply attempt fails, to exercise retry. */
  failOnce?: number[];
  commits?: Record<string, FilePatch[]>;
}

export class FakeGit implements LocalGit {
  constructor(private readonly data: FixtureData) {}

  async commitFiles(sha: string): Promise<FilePatch[]> {
    const files = this.data.commits?.[sha];
    if (!files) throw new Error(`unknown revision ${sha}`);
    return files;
  }
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function loadFixture(dir: string): FixtureData {
  return JSON.parse(readFileSync(join(dir, 'fixture.json'), 'utf8')) as FixtureData;
}

/** Serves a fixture instead of GitHub and records what would have been posted. */
export class FakeGitHub implements GitHub {
  readonly posts: FakePost[] = [];
  private readonly failing: Set<number>;

  constructor(private readonly data: FixtureData) {
    this.failing = new Set(data.failOnce ?? []);
  }

  async checkAuth(): Promise<void> {}

  async resolvePr(): Promise<PrRef> {
    const { owner, repo, number } = this.data.pr;
    return { owner, repo, number };
  }

  async loadPullRequest(): Promise<PullRequest> {
    return this.data.pr;
  }

  async listFiles(): Promise<FilePatch[]> {
    return this.data.files;
  }

  async searchMentionable(_ref: PrRef, query: string): Promise<User[]> {
    const needle = query.toLowerCase();
    return this.data.users.filter((user) => user.login.toLowerCase().includes(needle)).slice(0, 10);
  }

  async renderMarkdown(_ref: PrRef, text: string): Promise<string> {
    return text
      .split(/\n{2,}/)
      .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
      .join('\n');
  }

  async replyToThread(_ref: PrRef, commentId: number, body: string): Promise<string> {
    this.maybeFail(commentId);
    this.posts.push({ kind: 'thread', commentId, body });
    return `${this.data.pr.url}#discussion_r${900000 + this.posts.length}`;
  }

  async createComment(_ref: PrRef, body: string): Promise<string> {
    this.posts.push({ kind: 'comment', commentId: null, body });
    return `${this.data.pr.url}#issuecomment-${900000 + this.posts.length}`;
  }

  private maybeFail(commentId: number): void {
    if (this.failing.delete(commentId)) {
      throw new Error('HTTP 502: Bad Gateway (simulated by the fixture)');
    }
  }
}
