import { useEffect, useRef, useState } from 'react';
import type { ResultStatus, SessionItem, SessionState } from '../../shared/schema';
import { authorOf, excerptOf, statusOf } from '../model';
import { Icon } from './icons';
import { Kbd } from './Kbd';

interface Props {
  open: boolean;
  items: SessionItem[];
  state: SessionState;
  onClose: () => void;
  onFinish: (status: ResultStatus) => Promise<void>;
  onSelect: (id: string) => void;
}

const firstLine = (text: string) => text.trim().split('\n')[0] ?? '';

export function SubmitDialog({ open, items, state, onClose, onFinish, onSelect }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      setConfirmCancel(false);
      setError(null);
      element.showModal();
      primaryRef.current?.focus();
    }
    if (!open && element.open) element.close();
  }, [open]);

  const byStatus = (wanted: string) => items.filter((item) => statusOf(state.items[item.id]!) === wanted);
  const toSend = [...byStatus('send'), ...byStatus('failed')];
  const asking = byStatus('ask');
  const undecided = byStatus('undecided');
  const skipped = byStatus('skip');
  const missingNotes = asking.filter((item) => state.items[item.id]!.instructions.trim() === '');
  const revising = asking.length > 0;

  const finish = async (status: ResultStatus) => {
    setBusy(true);
    setError(null);
    try {
      await onFinish(status);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const jump = (id: string) => {
    onSelect(id);
    onClose();
  };

  const row = (item: SessionItem, detail: string, tone: 'ask' | 'send') => (
    <li key={item.id}>
      <button type="button" onClick={() => jump(item.id)} className="flex w-full gap-2 px-4 py-2 text-left hover:bg-canvas-subtle">
        <Icon name={tone === 'ask' ? 'sparkle' : 'reply'} className={`mt-0.5 shrink-0 ${tone === 'ask' ? 'text-done' : 'text-fg-muted'}`} />
        <span className="min-w-0 flex-1 text-sm">
          <span className="block truncate text-xs text-fg-muted">
            {item.kind === 'summary' ? 'General comment' : `${authorOf(item)?.login ?? 'ghost'}: ${excerptOf(item)}`}
          </span>
          <span className={`block truncate ${detail ? '' : 'text-danger'}`}>{detail || 'Say what the agent should change'}</span>
        </span>
      </button>
    </li>
  );

  const primary = 'inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60';

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      className="m-auto w-[min(40rem,calc(100vw-2rem))] rounded-xl border border-border bg-overlay p-0 text-fg shadow-2xl backdrop:bg-black/50"
    >
      <div className="flex items-center border-b border-border px-4 py-3">
        <h2 className="flex-1 font-semibold">{revising ? 'Send back to the agent' : 'Approve your replies'}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-fg-muted hover:bg-btn-hover hover:text-fg">
          <Icon name="x" />
        </button>
      </div>

      <div className="max-h-[60vh] overflow-y-auto">
        <p className="px-4 pt-3 text-sm text-fg-muted">
          {revising
            ? `The agent reworks ${asking.length} ${asking.length === 1 ? 'item' : 'items'} and reopens this page. Your ${toSend.length} approved ${toSend.length === 1 ? 'reply is' : 'replies are'} kept for the next round, and nothing is posted yet.`
            : 'The agent pushes its fixes first, then posts these exactly as written.'}
        </p>
        <p className="px-4 pt-1 text-sm text-fg-muted">
          {toSend.length} to send · {skipped.length} skipped
          {revising && ` · ${asking.length} for the agent`}
          {undecided.length > 0 && <span className="text-attention"> · {undecided.length} undecided, which won't be posted</span>}
        </p>
        {revising ? (
          <ul className="mt-2 divide-y divide-border-muted border-y border-border-muted">
            {asking.map((item) => row(item, firstLine(state.items[item.id]!.instructions), 'ask'))}
          </ul>
        ) : toSend.length > 0 ? (
          <ul className="mt-2 divide-y divide-border-muted border-y border-border-muted">
            {toSend.map((item) => row(item, firstLine(state.items[item.id]!.body), 'send'))}
          </ul>
        ) : (
          <p className="px-4 py-4 text-sm">Nothing is marked to send. The agent will push its fixes and post no replies.</p>
        )}
        {error && <p className="mx-4 my-3 rounded-md border border-danger/40 bg-danger-subtle px-3 py-2 text-sm text-danger">{error}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
        {confirmCancel ? (
          <>
            <span className="mr-auto text-sm">End the session? Nothing is pushed or posted.</span>
            <button type="button" onClick={() => setConfirmCancel(false)} className="rounded-md border border-border bg-btn px-3 py-1.5 text-sm font-medium hover:bg-btn-hover">
              Go back
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => finish('canceled')}
              className="rounded-md border border-border bg-btn px-3 py-1.5 text-sm font-medium text-danger hover:border-danger hover:bg-danger hover:text-white disabled:opacity-60"
            >
              End session
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setConfirmCancel(true)} className="mr-auto text-sm text-fg-muted hover:text-danger hover:underline">
              End without posting
            </button>
            {revising ? (
              <button
                ref={primaryRef}
                type="button"
                disabled={busy || missingNotes.length > 0}
                title={missingNotes.length ? 'Every item sent back needs a note for the agent' : undefined}
                onClick={() => finish('revise')}
                className={`${primary} border-done bg-done hover:opacity-90`}
              >
                {busy ? 'Sending…' : `Send ${asking.length} back to the agent`}
                <Kbd>↵</Kbd>
              </button>
            ) : (
              <button
                ref={primaryRef}
                type="button"
                disabled={busy}
                onClick={() => finish('approved')}
                className={`${primary} border-success-emphasis bg-success-emphasis hover:bg-success-emphasis-hover`}
              >
                {busy ? 'Approving…' : toSend.length ? `Approve ${toSend.length} ${toSend.length === 1 ? 'reply' : 'replies'}` : 'Approve with no replies'}
                <Kbd>↵</Kbd>
              </button>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
