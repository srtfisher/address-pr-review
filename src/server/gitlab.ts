import { spawn } from 'node:child_process';
import type { Comment, FilePatch, PrRef, PullRequest, Thread, User } from '../shared/schema';
import type { GitHub } from './github';

/**
 * GitLab merge requests through the `glab` CLI, behind the same interface as GitHub.
 * PrRef mapping: `owner` is the namespace (e.g. "energyzero/backend"), `repo` the project, `number` the MR iid.
 * Threads are resolvable discussions; their `id` is the GitLab discussion id. Comments are individual notes.
 * GitLab has no review bodies, so `reviews` is always empty.
 */

export class GlabError extends Error {}

export type GlabRunner = (args: string[]) => Promise<string>;

export function runGlab(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('glab', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error: NodeJS.ErrnoException) => {
      reject(new GlabError(error.code === 'ENOENT' ? 'The GitLab CLI (glab) is not installed or not on PATH.' : error.message));
    });
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(stdout).toString('utf8'));
      else {
        const message = Buffer.concat(stderr).toString('utf8').trim() || Buffer.concat(stdout).toString('utf8').trim();
        reject(new GlabError(`glab ${args[0] ?? ''} failed: ${message || `exit code ${code}`}`));
      }
    });
  });
}

export function parseMrUrl(input: string): PrRef | null {
  const match = /^https?:\/\/[^/]+\/(.+)\/([^/]+)\/-\/merge_requests\/(\d+)/.exec(input);
  if (!match) return null;
  return { owner: match[1]!, repo: match[2]!, number: Number(match[3]), provider: 'gitlab' };
}

interface GlUser {
  username: string;
  name?: string | null;
  avatar_url?: string | null;
}

interface GlNote {
  id: number;
  author: GlUser | null;
  body: string;
  created_at: string;
  system: boolean;
  resolvable: boolean;
  resolved?: boolean;
  position?: { new_path?: string | null; old_path?: string | null; new_line?: number | null; old_line?: number | null } | null;
}

interface GlDiscussion {
  id: string;
  individual_note: boolean;
  notes: GlNote[];
}

const toUser = (user: GlUser | null | undefined): User | null =>
  user ? { login: user.username, name: user.name ?? null, avatarUrl: user.avatar_url ?? '' } : null;

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Like GitHub's diffHunk: the hunk around a new-side line, cut off at that line. Empty when the line isn't in the diff. */
export function hunkUpTo(patch: string | null, newLine: number | null): string {
  if (!patch || !newLine) return '';
  for (const hunk of patch.split(/^(?=@@ )/m)) {
    const start = Number(/^@@ -\d+(?:,\d+)? \+(\d+)/.exec(hunk)?.[1]);
    if (!start) continue;
    const lines = hunk.replace(/\n$/, '').split('\n');
    let line = start - 1;
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i]!.startsWith('-')) line++;
      if (line === newLine && !lines[i]!.startsWith('-')) return lines.slice(0, i + 1).join('\n');
    }
  }
  return '';
}

const project = (ref: PrRef): string => encodeURIComponent(`${ref.owner}/${ref.repo}`);
const mrPath = (ref: PrRef): string => `projects/${project(ref)}/merge_requests/${ref.number}`;

export class GlabGitLab implements GitHub {
  constructor(private readonly glab: GlabRunner = runGlab) {}

  async checkAuth(): Promise<void> {
    await this.glab(['auth', 'status']);
  }

  async resolvePr(input?: string): Promise<PrRef> {
    if (input) {
      const fromUrl = parseMrUrl(input);
      if (fromUrl) return fromUrl;
      const iid = /^!?(\d+)$/.exec(input)?.[1];
      if (!iid) throw new GlabError(`Could not read "${input}" as a merge request number or URL.`);
      const repo = JSON.parse(await this.glab(['api', 'projects/:id'])) as { path_with_namespace: string };
      return parseMrUrl(`https://x/${repo.path_with_namespace}/-/merge_requests/${iid}`)!;
    }
    const mr = JSON.parse(await this.glab(['mr', 'view', '-F', 'json'])) as { web_url: string };
    const ref = parseMrUrl(mr.web_url);
    if (!ref) throw new GlabError(`Unexpected merge request URL from glab: ${mr.web_url}`);
    return ref;
  }

  private async api<T>(path: string): Promise<T> {
    return JSON.parse(await this.glab(['api', path])) as T;
  }

  private async paginate<T>(path: string): Promise<T[]> {
    const all: T[] = [];
    for (let page = 1; ; page++) {
      const items = await this.api<T[]>(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      all.push(...items);
      if (items.length < 100) return all;
    }
  }

  async loadPullRequest(ref: PrRef): Promise<PullRequest> {
    const [mr, discussions, files] = await Promise.all([
      this.api<{ title: string; web_url: string; source_branch: string; target_branch: string; author: GlUser; assignees?: GlUser[]; reviewers?: GlUser[] }>(
        mrPath(ref),
      ),
      this.paginate<GlDiscussion>(`${mrPath(ref)}/discussions`),
      this.listFiles(ref).catch((): FilePatch[] => []),
    ]);
    const patches = new Map(files.map((file) => [file.path, file.patch]));

    const html = await this.renderAll(
      ref,
      discussions.flatMap((d) => d.notes.filter((n) => !n.system)),
    );
    const toComment = (note: GlNote): Comment => ({
      id: note.id,
      author: toUser(note.author),
      body: note.body,
      bodyHTML: html.get(note.id) ?? `<p>${escapeHtml(note.body)}</p>`,
      createdAt: note.created_at,
      url: `${mr.web_url}#note_${note.id}`,
    });

    const threads: Thread[] = [];
    const comments: Comment[] = [];
    for (const discussion of discussions) {
      const notes = discussion.notes.filter((note) => !note.system);
      const first = notes[0];
      if (!first) continue;
      if (discussion.individual_note || !first.resolvable) {
        comments.push(...notes.map(toComment));
        continue;
      }
      const position = first.position ?? {};
      threads.push({
        id: discussion.id,
        path: position.new_path ?? position.old_path ?? '',
        line: position.new_line ?? position.old_line ?? null,
        startLine: null,
        originalLine: position.new_line ?? position.old_line ?? null,
        isOutdated: false,
        isResolved: notes.every((note) => !note.resolvable || note.resolved === true),
        diffHunk: hunkUpTo(patches.get(position.new_path ?? '') ?? null, position.new_line ?? null),
        comments: notes.map(toComment),
      });
    }

    const people = new Map<string, User>();
    const add = (user: User | null): void => {
      if (user && !people.has(user.login)) people.set(user.login, user);
    };
    add(toUser(mr.author));
    [...(mr.assignees ?? []), ...(mr.reviewers ?? [])].forEach((user) => add(toUser(user)));
    [...threads.flatMap((t) => t.comments), ...comments].forEach((comment) => add(comment.author));

    return {
      ...ref,
      title: mr.title,
      url: mr.web_url,
      headRefName: mr.source_branch,
      baseRefName: mr.target_branch,
      author: toUser(mr.author),
      participants: [...people.values()],
      threads,
      comments,
      reviews: [],
    };
  }

  private async renderAll(ref: PrRef, notes: GlNote[]): Promise<Map<number, string>> {
    const html = new Map<number, string>();
    const queue = [...notes];
    const worker = async (): Promise<void> => {
      for (let note = queue.shift(); note; note = queue.shift()) {
        html.set(note.id, await this.renderMarkdown(ref, note.body).catch(() => `<p>${escapeHtml(note.body)}</p>`));
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    return html;
  }

  async listFiles(ref: PrRef): Promise<FilePatch[]> {
    const diffs = await this.paginate<{ new_path: string; old_path: string; new_file: boolean; deleted_file: boolean; renamed_file: boolean; diff: string }>(
      `${mrPath(ref)}/diffs`,
    );
    return diffs.map((file) => {
      const patch = file.diff ? file.diff.replace(/\n$/, '') : null;
      const lines = patch?.split('\n') ?? [];
      return {
        path: file.new_path,
        status: file.new_file ? 'added' : file.deleted_file ? 'removed' : file.renamed_file ? 'renamed' : 'modified',
        additions: lines.filter((line) => line.startsWith('+')).length,
        deletions: lines.filter((line) => line.startsWith('-')).length,
        patch,
      };
    });
  }

  async searchMentionable(ref: PrRef, query: string): Promise<User[]> {
    const users = await this.api<GlUser[]>(`projects/${project(ref)}/users?search=${encodeURIComponent(query)}&per_page=10`);
    return users.map((user) => toUser(user)!);
  }

  async renderMarkdown(ref: PrRef, text: string): Promise<string> {
    const out = await this.glab(['api', '-X', 'POST', 'markdown', '-f', `text=${text}`, '-F', 'gfm=true', '-f', `project=${ref.owner}/${ref.repo}`]);
    return (JSON.parse(out) as { html: string }).html;
  }

  async replyToThread(ref: PrRef, commentId: number, body: string): Promise<string> {
    const discussions = await this.paginate<GlDiscussion>(`${mrPath(ref)}/discussions`);
    const discussion = discussions.find((d) => d.notes.some((note) => note.id === commentId));
    if (!discussion) throw new GlabError(`No discussion on ${ref.owner}/${ref.repo}!${ref.number} contains note ${commentId}.`);
    return this.postNote(ref, `${mrPath(ref)}/discussions/${discussion.id}/notes`, body);
  }

  createComment(ref: PrRef, body: string): Promise<string> {
    return this.postNote(ref, `${mrPath(ref)}/notes`, body);
  }

  async resolveThread(ref: PrRef, threadId: string): Promise<void> {
    await this.glab(['api', '-X', 'PUT', `${mrPath(ref)}/discussions/${threadId}`, '-F', 'resolved=true']);
  }

  private async postNote(ref: PrRef, path: string, body: string): Promise<string> {
    const note = JSON.parse(await this.glab(['api', '-X', 'POST', path, '-f', `body=${body}`])) as { id: number };
    const mr = await this.api<{ web_url: string }>(mrPath(ref));
    return `${mr.web_url}#note_${note.id}`;
  }
}
