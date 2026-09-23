import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Drafts,
  SUMMARY_ID,
  SessionState,
  type PullRequest,
  type ResultStatus,
  type Results,
  type SessionItem,
  type Source,
} from '../shared/schema';

export const sessionFiles = (dir: string) => ({
  drafts: join(dir, 'drafts.json'),
  state: join(dir, 'state.json'),
  results: join(dir, 'results.json'),
  server: join(dir, 'server.json'),
  log: join(dir, 'server.log'),
  meta: join(dir, 'session.json'),
});

export interface SessionMeta {
  repoDir: string;
}

export interface ServerInfo {
  url: string;
  pid: number;
}

export function parseDrafts(json: unknown): Drafts {
  const result = Drafts.safeParse(json);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    throw new Error(`drafts file is invalid:\n${problems.join('\n')}`);
  }
  return result.data;
}

function findSource(item: Drafts['items'][number], pr: PullRequest): { source: Source; newestId: number | null } {
  if (item.kind === 'thread') {
    const thread = pr.threads.find((t) => t.comments.some((c) => c.id === item.commentId));
    return thread
      ? { source: { kind: 'thread', thread }, newestId: Math.max(...thread.comments.map((c) => c.id)) }
      : { source: { kind: 'missing' }, newestId: null };
  }
  const newestIssueComment = pr.comments.length ? Math.max(...pr.comments.map((c) => c.id)) : null;
  if (item.kind === 'comment') {
    const comment = pr.comments.find((c) => c.id === item.commentId);
    return { source: comment ? { kind: 'comment', comment } : { kind: 'missing' }, newestId: newestIssueComment };
  }
  const review = pr.reviews.find((r) => r.id === item.commentId);
  return { source: review ? { kind: 'review', review } : { kind: 'missing' }, newestId: newestIssueComment };
}

export function buildItems(drafts: Drafts, pr: PullRequest): SessionItem[] {
  const items: SessionItem[] = drafts.items.map((item) => {
    const { source, newestId } = findSource(item, pr);
    return {
      id: item.id,
      kind: item.kind,
      commentId: item.commentId,
      decision: item.decision,
      rationale: item.rationale,
      commits: item.commits,
      draft: item.draft,
      source,
      newActivity: item.lastSeenCommentId !== undefined && newestId !== null && newestId > item.lastSeenCommentId,
    };
  });
  items.push({
    id: SUMMARY_ID,
    kind: 'summary',
    commentId: null,
    decision: null,
    rationale: '',
    commits: [],
    draft: drafts.summary?.draft ?? '',
    source: { kind: 'summary' },
    newActivity: false,
  });
  return items;
}

/**
 * State for a round. A saved item carries over unless the human sent it back
 * to the agent or the agent redrafted it; then it starts over from the new
 * draft, remembering what the human asked for. Posted replies never reset.
 */
export function initialState(items: SessionItem[], saved?: SessionState): SessionState {
  const state: SessionState = { items: {} };
  for (const item of items) {
    const blankComment = item.kind === 'summary' && item.draft.trim() === '';
    const previous = saved?.items[item.id];
    const reworked = previous !== undefined && (previous.action === 'ask' || previous.basedOn !== item.draft);
    if (previous && (previous.postedUrl || !reworked)) {
      state.items[item.id] = previous;
      continue;
    }
    state.items[item.id] = {
      action: blankComment ? 'skip' : null,
      body: item.draft,
      instructions: '',
      basedOn: item.draft,
      lastAsk: previous?.action === 'ask' ? previous.instructions : null,
      postedUrl: null,
      error: null,
    };
  }
  return state;
}

export function buildResults(status: ResultStatus, drafts: Drafts, items: SessionItem[], state: SessionState): Results {
  return {
    status,
    pr: drafts.pr,
    items: items.map((item) => {
      const itemState = state.items[item.id]!;
      return {
        id: item.id,
        kind: item.kind,
        commentId: item.commentId,
        action: itemState.action,
        body: itemState.body,
        instructions: itemState.instructions,
        postedUrl: itemState.postedUrl,
        error: itemState.error,
      };
    }),
  };
}

export function writeJson(path: string, value: unknown): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, path);
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function readSavedState(dir: string): SessionState | undefined {
  const path = sessionFiles(dir).state;
  if (!existsSync(path)) return undefined;
  const parsed = SessionState.safeParse(readJson(path));
  return parsed.success ? parsed.data : undefined;
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}
