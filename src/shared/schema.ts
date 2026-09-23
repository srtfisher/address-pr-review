import { z } from 'zod';

export const DRAFTS_VERSION = 1;

export const PrRef = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  number: z.number().int().positive(),
});
export type PrRef = z.infer<typeof PrRef>;

export const Decision = z.enum(['implemented', 'declined', 'clarify', 'acknowledged']);
export type Decision = z.infer<typeof Decision>;

export const DraftItem = z.object({
  id: z.string().min(1),
  kind: z.enum(['thread', 'comment', 'review']),
  commentId: z.number().int().positive(),
  lastSeenCommentId: z.number().int().positive().optional(),
  decision: Decision,
  rationale: z.string().default(''),
  commits: z.array(z.string()).default([]),
  draft: z.string(),
});
export type DraftItem = z.infer<typeof DraftItem>;

export const Drafts = z
  .object({
    version: z.literal(DRAFTS_VERSION),
    pr: PrRef,
    items: z.array(DraftItem),
    summary: z.object({ draft: z.string() }).nullable().optional(),
  })
  .superRefine((drafts, ctx) => {
    const seen = new Set<string>();
    for (const [index, item] of drafts.items.entries()) {
      if (item.id === SUMMARY_ID || seen.has(item.id)) {
        ctx.addIssue({ code: 'custom', path: ['items', index, 'id'], message: `duplicate or reserved id "${item.id}"` });
      }
      seen.add(item.id);
    }
  });
export type Drafts = z.infer<typeof Drafts>;

export const SUMMARY_ID = 'summary';

export const Action = z.enum(['send', 'skip']);
export type Action = z.infer<typeof Action>;

export const ItemState = z.object({
  action: Action.nullable(),
  body: z.string(),
  postedUrl: z.string().nullable(),
  error: z.string().nullable(),
});
export type ItemState = z.infer<typeof ItemState>;

export const SessionState = z.object({
  items: z.record(z.string(), ItemState),
});
export type SessionState = z.infer<typeof SessionState>;

export type ResultStatus = 'done' | 'canceled';

export interface ResultItem {
  id: string;
  kind: DraftItem['kind'] | 'summary';
  commentId: number | null;
  action: Action | null;
  body: string;
  postedUrl: string | null;
  error: string | null;
}

export interface Results {
  status: ResultStatus;
  pr: PrRef;
  items: ResultItem[];
}

export interface User {
  login: string;
  name: string | null;
  avatarUrl: string;
}

export interface Comment {
  id: number;
  author: User | null;
  body: string;
  bodyHTML: string;
  createdAt: string;
  url: string;
}

export interface Thread {
  id: string;
  path: string;
  line: number | null;
  startLine: number | null;
  originalLine: number | null;
  isOutdated: boolean;
  isResolved: boolean;
  diffHunk: string;
  comments: Comment[];
}

export interface Review {
  id: number;
  author: User | null;
  state: string;
  body: string;
  bodyHTML: string;
  submittedAt: string | null;
  url: string;
}

export interface PullRequest extends PrRef {
  title: string;
  url: string;
  headRefName: string;
  baseRefName: string;
  author: User | null;
  threads: Thread[];
  comments: Comment[];
  reviews: Review[];
  participants: User[];
}

export interface FilePatch {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

export type Source =
  | { kind: 'thread'; thread: Thread }
  | { kind: 'comment'; comment: Comment }
  | { kind: 'review'; review: Review }
  | { kind: 'summary' }
  | { kind: 'missing' };

export interface SessionItem {
  id: string;
  kind: DraftItem['kind'] | 'summary';
  commentId: number | null;
  decision: Decision | null;
  rationale: string;
  commits: string[];
  draft: string;
  source: Source;
  newActivity: boolean;
}

export interface SessionPayload {
  pr: PullRequest;
  items: SessionItem[];
  state: SessionState;
  fixture: boolean;
}
