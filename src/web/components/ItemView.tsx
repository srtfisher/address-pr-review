import { useMemo, useState, type RefObject } from 'react';
import { commentedLineCount, parseDiff, type DiffLine } from '../../shared/diff';
import type { Action, FilePatch, ItemState, PullRequest, SessionItem, Thread } from '../../shared/schema';
import { api } from '../api';
import { decisionLabel, decisionTone, lineLabel, statusOf } from '../model';
import { CommentBox } from './CommentBox';
import { DiffView } from './DiffView';
import { Icon } from './icons';
import { ReplyEditor } from './ReplyEditor';

const CONTEXT_LINES = 6;

const reviewStateLabel: Record<string, { label: string; tone: string }> = {
  APPROVED: { label: 'Approved', tone: 'text-success border-success/40' },
  CHANGES_REQUESTED: { label: 'Changes requested', tone: 'text-danger border-danger/40' },
  COMMENTED: { label: 'Commented', tone: 'text-fg-muted border-border' },
  DISMISSED: { label: 'Dismissed', tone: 'text-fg-muted border-border' },
};

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 text-xs leading-5 font-medium ${className}`}>{children}</span>;
}

function ThreadContext({ thread, label }: { thread: Thread; label: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const [file, setFile] = useState<FilePatch | null>(null);
  const [fileState, setFileState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [showFile, setShowFile] = useState(false);

  const hunk = useMemo(() => parseDiff(thread.diffHunk).filter((line) => line.type !== 'hunk'), [thread.diffHunk]);
  const highlightCount = commentedLineCount(thread.line, thread.startLine);
  const visible = expanded ? hunk : hunk.slice(-Math.max(CONTEXT_LINES, highlightCount));
  const hidden = hunk.length - visible.length;
  const tailStart = visible.length - highlightCount;

  const toggleFile = () => {
    if (showFile) return setShowFile(false);
    setShowFile(true);
    if (file) return;
    setFileState('loading');
    api
      .file(thread.path)
      .then((patch) => {
        setFile(patch);
        setFileState('idle');
      })
      .catch(() => setFileState('error'));
  };

  const fileLines = useMemo(() => (file?.patch ? parseDiff(file.patch) : []), [file]);
  const inRange = (line: DiffLine) =>
    !thread.isOutdated &&
    thread.line !== null &&
    line.newNo !== null &&
    line.type !== 'del' &&
    line.newNo >= (thread.startLine ?? thread.line) &&
    line.newNo <= thread.line;

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-canvas-subtle px-4 py-2">
        <Icon name="file" className="text-fg-muted" />
        <span className="min-w-0 truncate font-mono text-xs font-semibold" title={thread.path}>
          {thread.path}
        </span>
        {label && <span className="font-mono text-xs text-fg-muted">{label}</span>}
        {thread.isOutdated && <Badge className="border-attention/40 text-attention">Outdated</Badge>}
        <button type="button" onClick={toggleFile} className="ml-auto text-xs text-accent hover:underline">
          {showFile ? 'Hide file diff' : 'Show file diff'}
        </button>
      </div>
      {showFile ? (
        fileState === 'loading' ? (
          <p className="px-4 py-3 text-sm text-fg-muted">Loading the diff…</p>
        ) : fileState === 'error' ? (
          <p className="px-4 py-3 text-sm text-danger">Could not load this file's diff.</p>
        ) : file?.patch ? (
          <div className="max-h-[32rem] overflow-y-auto">
            <DiffView lines={fileLines} isHighlighted={inRange} />
          </div>
        ) : (
          <p className="px-4 py-3 text-sm text-fg-muted">GitHub doesn't show a diff for this file (binary or too large).</p>
        )
      ) : (
        <>
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="flex w-full items-center gap-2 bg-diff-hunk px-4 py-1 text-left text-xs text-fg-muted hover:text-accent"
            >
              <Icon name="unfold" size={14} /> Show {hidden} more {hidden === 1 ? 'line' : 'lines'} above
            </button>
          )}
          <DiffView lines={visible} isHighlighted={(_line, index) => index >= tailStart} />
        </>
      )}
    </div>
  );
}

function Source({ item }: { item: SessionItem }) {
  const { source } = item;
  if (source.kind === 'thread') {
    return (
      <div className="space-y-3">
        <ThreadContext thread={source.thread} label={lineLabel(item)} />
        <div className="divide-y divide-border-muted overflow-hidden rounded-md border border-border">
          {source.thread.comments.map((comment) => (
            <CommentBox key={comment.id} compact author={comment.author} createdAt={comment.createdAt} url={comment.url} bodyHTML={comment.bodyHTML} />
          ))}
        </div>
      </div>
    );
  }
  if (source.kind === 'comment') {
    return (
      <div className="rounded-md border border-border p-4">
        <CommentBox author={source.comment.author} createdAt={source.comment.createdAt} url={source.comment.url} bodyHTML={source.comment.bodyHTML} />
      </div>
    );
  }
  if (source.kind === 'review') {
    const state = reviewStateLabel[source.review.state] ?? { label: source.review.state.toLowerCase(), tone: 'text-fg-muted border-border' };
    return (
      <div className="rounded-md border border-border p-4">
        <CommentBox
          author={source.review.author}
          createdAt={source.review.submittedAt}
          url={source.review.url}
          bodyHTML={source.review.bodyHTML}
          badge={<Badge className={state.tone}>{state.label}</Badge>}
        />
      </div>
    );
  }
  if (source.kind === 'summary') {
    return (
      <div className="rounded-md border border-border bg-canvas-subtle px-4 py-3 text-sm text-fg-muted">
        A new comment on the pull request, posted after the thread replies. Use it to say anything to the reviewers, or leave it skipped.
      </div>
    );
  }
  return (
    <div className="flex gap-2 rounded-md border border-danger/40 bg-danger-subtle px-4 py-3 text-sm text-danger">
      <Icon name="alert" className="mt-0.5 shrink-0" />
      This comment is no longer on the pull request. It may have been deleted, so there is nothing to reply to.
    </div>
  );
}

function AgentCard({ item, pr }: { item: SessionItem; pr: PullRequest }) {
  if (!item.decision && !item.rationale) return null;
  return (
    <div className="rounded-md border border-border bg-canvas-subtle px-4 py-3">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-sm">
        <Icon name="sparkle" className="text-done" />
        <span className="font-semibold">Agent's take</span>
        {item.decision && <Badge className={decisionTone[item.decision]}>{decisionLabel[item.decision]}</Badge>}
        {item.commits.map((sha) => (
          <a
            key={sha}
            href={`${pr.url}/commits/${sha}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono text-xs text-accent hover:underline"
          >
            <Icon name="commit" size={14} />
            {sha.slice(0, 7)}
          </a>
        ))}
      </div>
      {item.rationale && <p className="text-sm text-fg-muted">{item.rationale}</p>}
    </div>
  );
}

interface Props {
  item: SessionItem;
  state: ItemState;
  pr: PullRequest;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onBody: (body: string) => void;
  onAction: (action: Action | null) => void;
  onSendAndNext: () => void;
  onRetry: () => void;
  retrying: boolean;
}

export function ItemView({ item, state, pr, textareaRef, onBody, onAction, onSendAndNext, onRetry, retrying }: Props) {
  const status = statusOf(state);
  const posted = status === 'posted';
  const missing = item.source.kind === 'missing';
  const target = item.kind === 'thread' ? 'Replies in this thread' : 'Posts as a new comment on the pull request';

  return (
    <article className="mx-auto max-w-4xl space-y-4 px-6 py-6">
      <Source item={item} />

      {item.newActivity && (
        <div className="flex gap-2 rounded-md border border-attention/40 bg-attention-subtle px-4 py-3 text-sm">
          <Icon name="alert" className="mt-0.5 shrink-0 text-attention" />
          <span>There are new replies since this draft was written. Read them before you send.</span>
        </div>
      )}

      <AgentCard item={item} pr={pr} />

      <section aria-label="Your reply" className="space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <Icon name="reply" className="text-fg-muted" />
          <h2 className="font-semibold">{item.kind === 'summary' ? 'Your comment' : 'Your reply'}</h2>
          <span className="text-fg-muted">· {target}</span>
          {!posted && item.draft !== '' && state.body !== item.draft && (
            <button type="button" onClick={() => onBody(item.draft)} className="ml-auto text-xs text-accent hover:underline">
              Reset to draft
            </button>
          )}
        </div>

        {posted ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-md border border-done/40 bg-done-subtle px-4 py-2 text-sm text-done">
              <Icon name="checkCircle" />
              Posted.
              <a href={state.postedUrl!} target="_blank" rel="noreferrer" className="font-medium underline">
                View on GitHub
              </a>
            </div>
            <div className="rounded-md border border-border px-4 py-3">
              <pre className="font-sans text-sm whitespace-pre-wrap">{state.body}</pre>
            </div>
          </div>
        ) : (
          <>
            <ReplyEditor
              value={state.body}
              onChange={onBody}
              disabled={missing}
              textareaRef={textareaRef}
              onSubmitShortcut={onSendAndNext}
              placeholder={item.kind === 'summary' ? 'Say something to the reviewers' : 'Leave a reply'}
            />
            {state.error && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-danger/40 bg-danger-subtle px-4 py-2 text-sm text-danger">
                <Icon name="alert" className="shrink-0" />
                <span className="min-w-0 flex-1">Posting failed: {state.error}</span>
                <button
                  type="button"
                  onClick={onRetry}
                  disabled={retrying}
                  className="rounded-md border border-border bg-btn px-3 py-1 font-medium text-fg hover:bg-btn-hover disabled:opacity-60"
                >
                  {retrying ? 'Retrying…' : 'Retry'}
                </button>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="mr-auto text-xs text-fg-muted">
                <kbd className="font-mono">s</kbd> send · <kbd className="font-mono">x</kbd> skip · <kbd className="font-mono">e</kbd> edit ·{' '}
                <kbd className="font-mono">j</kbd>/<kbd className="font-mono">k</kbd> next/previous
              </span>
              <button
                type="button"
                aria-pressed={state.action === 'skip'}
                onClick={() => onAction(state.action === 'skip' ? null : 'skip')}
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium ${
                  state.action === 'skip'
                    ? 'border-fg-muted bg-neutral-muted text-fg'
                    : 'border-border bg-btn text-fg hover:bg-btn-hover'
                }`}
              >
                <Icon name="skip" size={14} />
                {state.action === 'skip' ? "Won't reply" : "Don't reply"}
              </button>
              <button
                type="button"
                aria-pressed={state.action === 'send'}
                disabled={missing || !state.body.trim()}
                onClick={() => onAction(state.action === 'send' ? null : 'send')}
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                  state.action === 'send'
                    ? 'border-success-emphasis bg-success-emphasis text-white hover:bg-success-emphasis-hover'
                    : 'border-border bg-btn text-fg hover:bg-btn-hover'
                }`}
              >
                <Icon name="check" size={14} />
                {state.action === 'send' ? 'Will send' : 'Send this reply'}
              </button>
            </div>
          </>
        )}
      </section>
    </article>
  );
}
