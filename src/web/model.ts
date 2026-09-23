import type { Decision, ItemState, SessionItem, User } from '../shared/schema';

export type ItemStatus = 'undecided' | 'send' | 'skip' | 'posted' | 'failed';

export function statusOf(state: ItemState): ItemStatus {
  if (state.postedUrl) return 'posted';
  if (state.error) return 'failed';
  return state.action ?? 'undecided';
}

export interface Group {
  key: string;
  label: string;
  isFile: boolean;
  items: SessionItem[];
}

const lineOf = (item: SessionItem): number =>
  item.source.kind === 'thread' ? (item.source.thread.line ?? item.source.thread.originalLine ?? 0) : 0;

export function groupItems(items: SessionItem[]): Group[] {
  const files = new Map<string, SessionItem[]>();
  const conversation: SessionItem[] = [];
  const summary: SessionItem[] = [];
  for (const item of items) {
    if (item.source.kind === 'thread') {
      const path = item.source.thread.path;
      files.set(path, [...(files.get(path) ?? []), item]);
    } else if (item.kind === 'summary') {
      summary.push(item);
    } else {
      conversation.push(item);
    }
  }
  const groups: Group[] = [...files.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, fileItems]) => ({
      key: `file:${path}`,
      label: path,
      isFile: true,
      items: [...fileItems].sort((a, b) => lineOf(a) - lineOf(b)),
    }));
  if (conversation.length) groups.push({ key: 'conversation', label: 'Conversation', isFile: false, items: conversation });
  if (summary.length) groups.push({ key: 'summary', label: 'Summary comment', isFile: false, items: summary });
  return groups;
}

export function authorOf(item: SessionItem): User | null {
  switch (item.source.kind) {
    case 'thread':
      return item.source.thread.comments[0]?.author ?? null;
    case 'comment':
      return item.source.comment.author;
    case 'review':
      return item.source.review.author;
    default:
      return null;
  }
}

export function excerptOf(item: SessionItem): string {
  const text =
    item.source.kind === 'thread'
      ? (item.source.thread.comments[0]?.body ?? '')
      : item.source.kind === 'comment'
        ? item.source.comment.body
        : item.source.kind === 'review'
          ? item.source.review.body
          : item.kind === 'summary'
            ? 'A new top-level comment on the PR'
            : 'This comment is no longer on the PR';
  return text.replace(/\s+/g, ' ').trim();
}

export function lineLabel(item: SessionItem): string | null {
  if (item.source.kind !== 'thread') return null;
  const { line, startLine, originalLine } = item.source.thread;
  const end = line ?? originalLine;
  if (end === null) return null;
  return startLine !== null && startLine < end ? `L${startLine}–${end}` : `L${end}`;
}

export const decisionLabel: Record<Decision, string> = {
  implemented: 'Implemented',
  declined: 'Declined',
  clarify: 'Needs clarification',
  acknowledged: 'Acknowledged',
};

export const decisionTone: Record<Decision, string> = {
  implemented: 'text-success border-success/40 bg-success-subtle',
  declined: 'text-danger border-danger/40 bg-danger-subtle',
  clarify: 'text-attention border-attention/40 bg-attention-subtle',
  acknowledged: 'text-fg-muted border-border bg-canvas-subtle',
};

export function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  const format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(-Math.round(seconds / size), unit);
  }
  return 'just now';
}
