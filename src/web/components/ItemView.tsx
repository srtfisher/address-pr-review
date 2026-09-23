import { useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react';
import { commentedLineCount, parseDiff, type DiffLine } from '../../shared/diff';
import type { Action, FilePatch, ItemState, SessionItem, Thread } from '../../shared/schema';
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

function Badge({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 text-xs leading-5 font-medium ${className}`}>{children}</span>;
}

function FileHeader({ path, children }: { path: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-canvas-subtle px-4 py-2">
      <Icon name="file" className="text-fg-muted" />
      <span className="min-w-0 truncate font-mono text-xs font-semibold" title={path}>
        {path}
      </span>
      {children}
    </div>
  );
}

function ThreadComments({ thread }: { thread: Thread }) {
  return (
    <div className="divide-y divide-border-muted">
      {thread.comments.map((comment) => (
        <CommentBox key={comment.id} compact author={comment.author} createdAt={comment.createdAt} url={comment.url} bodyHTML={comment.bodyHTML} />
      ))}
    </div>
  );
}

function ThreadOnDiff({ thread, label }: { thread: Thread; label: string | null }) {
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
  const threadRow = fileLines.findLastIndex(inRange);
  const comments = <ThreadComments thread={thread} />;

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <FileHeader path={thread.path}>
        {label && <span className="font-mono text-xs text-fg-muted">{label}</span>}
        {thread.isOutdated && <Badge className="border-attention/40 text-attention">Outdated</Badge>}
        <button type="button" onClick={toggleFile} className="ml-auto text-xs text-accent hover:underline">
          {showFile ? 'Hide file diff' : 'Show file diff'}
        </button>
      </FileHeader>
      {showFile ? (
        fileState === 'loading' ? (
          <p className="px-4 py-3 text-sm text-fg-muted">Loading the diff…</p>
        ) : fileState === 'error' ? (
          <p className="px-4 py-3 text-sm text-danger">Could not load this file's diff.</p>
        ) : file?.patch ? (
          <>
            <div className="max-h-[36rem] overflow-y-auto">
              <DiffView lines={fileLines} isHighlighted={inRange} insertAfter={threadRow === -1 ? undefined : { index: threadRow, node: comments }} />
            </div>
            {threadRow === -1 && <div className="border-t border-border">{comments}</div>}
          </>
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
          <div className="border-t border-border">{comments}</div>
        </>
      )}
    </div>
  );
}

function Source({ item }: { item: SessionItem }) {
  const { source } = item;
  if (source.kind === 'thread') return <ThreadOnDiff thread={source.thread} label={lineLabel(item)} />;
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

function AppliedFix({ commits, focusPath }: { commits: string[]; focusPath: string | null }) {
  const [files, setFiles] = useState<FilePatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    Promise.all(commits.map((sha) => api.commit(sha)))
      .then((perCommit) => {
        if (!current) return;
        const all = perCommit.flat();
        setFiles(focusPath ? [...all.filter((f) => f.path === focusPath), ...all.filter((f) => f.path !== focusPath)] : all);
      })
      .catch((caught: Error) => current && setError(caught.message));
    return () => {
      current = false;
    };
  }, [commits, focusPath]);

  return (
    <section aria-label="Applied fix" className="space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <Icon name="commit" className="text-fg-muted" />
        <h2 className="font-semibold">Applied fix</h2>
        <span className="text-fg-muted">· Committed locally, not pushed yet</span>
      </div>
      {error ? (
        <p className="rounded-md border border-danger/40 bg-danger-subtle px-4 py-2 text-sm text-danger">Could not read the fix: {error}</p>
      ) : !files ? (
        <p className="text-sm text-fg-muted">Loading the fix…</p>
      ) : (
        files.map((file, index) => (
          <div key={`${file.path}-${index}`} className="overflow-hidden rounded-md border border-border">
            <FileHeader path={file.path}>
              <span className="ml-auto font-mono text-xs">
                <span className="text-success">+{file.additions}</span> <span className="text-danger">−{file.deletions}</span>
              </span>
            </FileHeader>
            {file.patch ? (
              <div className="max-h-[28rem] overflow-y-auto">
                <DiffView lines={parseDiff(file.patch)} />
              </div>
            ) : (
              <p className="px-4 py-3 text-sm text-fg-muted">No text diff for this file.</p>
            )}
          </div>
        ))
      )}
    </section>
  );
}

function AgentCard({ item }: { item: SessionItem }) {
  if (!item.decision && !item.rationale) return null;
  return (
    <div className="rounded-md border border-border bg-canvas-subtle px-4 py-3">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-sm">
        <Icon name="sparkle" className="text-done" />
        <span className="font-semibold">Agent's take</span>
        {item.decision && <Badge className={decisionTone[item.decision]}>{decisionLabel[item.decision]}</Badge>}
      </div>
      {item.rationale && <p className="text-sm text-fg-muted">{item.rationale}</p>}
    </div>
  );
}

interface Props {
  item: SessionItem;
  state: ItemState;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  instructionsRef: RefObject<HTMLTextAreaElement | null>;
  onBody: (body: string) => void;
  onInstructions: (instructions: string) => void;
  onAction: (action: Action | null) => void;
  onSendAndNext: () => void;
  onNext: (() => void) | null;
  onReview: () => void;
}

export function ItemView({ item, state, textareaRef, instructionsRef, onBody, onInstructions, onAction, onSendAndNext, onNext, onReview }: Props) {
  const status = statusOf(state);
  const posted = status === 'posted';
  const missing = item.source.kind === 'missing';
  const isComment = item.kind === 'summary';
  const target = item.kind === 'thread' ? 'Replies in this thread' : 'Posts as a new comment on the pull request';
  const focusPath = item.source.kind === 'thread' ? item.source.thread.path : null;

  const choice = (action: Action, icon: 'skip' | 'sparkle' | 'check', idle: string, active: string, activeClass: string, disabled = false) => (
    <button
      type="button"
      aria-pressed={state.action === action}
      disabled={disabled}
      onClick={() => onAction(state.action === action ? null : action)}
      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
        state.action === action ? activeClass : 'border-border bg-btn text-fg hover:bg-btn-hover'
      }`}
    >
      <Icon name={icon} size={14} />
      {state.action === action ? active : idle}
    </button>
  );

  return (
    <article className="mx-auto max-w-4xl space-y-4 px-6 py-6">
      <Source item={item} />

      {item.newActivity && (
        <div className="flex gap-2 rounded-md border border-attention/40 bg-attention-subtle px-4 py-3 text-sm">
          <Icon name="alert" className="mt-0.5 shrink-0 text-attention" />
          <span>There are new replies since this draft was written. Read them before you send.</span>
        </div>
      )}

      {state.lastAsk && (
        <div className="rounded-md border border-done/40 bg-done-subtle px-4 py-3 text-sm">
          <p className="mb-1 flex items-center gap-2 font-semibold text-done">
            <Icon name="sparkle" /> Reworked by the agent. You asked:
          </p>
          <p className="whitespace-pre-wrap">{state.lastAsk}</p>
        </div>
      )}

      <AgentCard item={item} />

      {item.commits.length > 0 && <AppliedFix commits={item.commits} focusPath={focusPath} />}

      <section aria-label={isComment ? 'Your comment' : 'Your reply'} className="space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <Icon name="reply" className="text-fg-muted" />
          <h2 className="font-semibold">{isComment ? 'Your comment' : 'Your reply'}</h2>
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
              placeholder={isComment ? 'Say something to the reviewers' : 'Leave a reply'}
            />
            {state.error && (
              <div className="flex items-center gap-2 rounded-md border border-danger/40 bg-danger-subtle px-4 py-2 text-sm text-danger">
                <Icon name="alert" className="shrink-0" />
                <span>Posting failed last time: {state.error}</span>
              </div>
            )}
            {state.action === 'ask' && (
              <div className="rounded-md border border-done/40 bg-done-subtle p-3">
                <label htmlFor={`ask-${item.id}`} className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
                  <Icon name="sparkle" className="text-done" /> What should the agent change?
                </label>
                <textarea
                  id={`ask-${item.id}`}
                  ref={instructionsRef}
                  value={state.instructions}
                  onChange={(event) => onInstructions(event.target.value)}
                  placeholder="For example: revert this, the old message was fine. Or: implement it, but keep the constant."
                  className="block min-h-24 w-full resize-y rounded-md border border-border bg-canvas px-3 py-2 text-sm outline-none focus:border-accent-emphasis focus:ring-1 focus:ring-accent-emphasis"
                />
                <p className="mt-1.5 text-xs text-fg-muted">Only the agent sees this. It reworks the item and reopens this page, keeping your other choices.</p>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="mr-auto text-xs text-fg-muted">
                <kbd className="font-mono">s</kbd> send · <kbd className="font-mono">x</kbd> skip · <kbd className="font-mono">a</kbd> ask agent ·{' '}
                <kbd className="font-mono">e</kbd> edit · <kbd className="font-mono">j</kbd>/<kbd className="font-mono">k</kbd> next/previous · <kbd className="font-mono">?</kbd> all shortcuts
              </span>
              {choice('skip', 'skip', "Don't reply", "Won't reply", 'border-fg-muted bg-neutral-muted text-fg')}
              {!isComment &&
                choice('ask', 'sparkle', 'Ask agent to change', 'Back to the agent', 'border-done bg-done-subtle text-done', missing)}
              {choice(
                'send',
                'check',
                isComment ? 'Send this comment' : 'Send this reply',
                'Will send',
                'border-success-emphasis bg-success-emphasis text-white hover:bg-success-emphasis-hover',
                missing || !state.body.trim(),
              )}
            </div>
            {(state.action === 'send' || (isComment && state.action === 'skip')) && (
              <div
                role="status"
                className={`flex flex-wrap items-center gap-2 rounded-md border px-4 py-2 text-sm ${
                  state.action === 'send' ? 'border-success/40 bg-success-subtle' : 'border-border bg-canvas-subtle'
                }`}
              >
                <Icon name={state.action === 'send' ? 'checkCircle' : 'skip'} className={`shrink-0 ${state.action === 'send' ? 'text-success' : 'text-fg-muted'}`} />
                <span className="mr-auto">
                  {state.action === 'send' ? 'Marked to send.' : 'No comment will be posted.'}
                  {!onNext && ' That was the last one.'}
                  {state.action === 'send' && ' Nothing posts until you finish the review.'}
                </span>
                <button
                  type="button"
                  onClick={onNext ?? onReview}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-btn px-3 py-1.5 text-sm font-medium text-fg hover:bg-btn-hover"
                >
                  {onNext ? 'Next review note' : 'Review and finish'}
                  <Icon name="arrowRight" size={14} />
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </article>
  );
}
