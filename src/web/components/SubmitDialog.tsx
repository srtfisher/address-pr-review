import { useEffect, useRef, useState } from 'react';
import type { ResultStatus, SessionItem, SessionState } from '../../shared/schema';
import { authorOf, excerptOf, statusOf } from '../model';
import { Icon } from './icons';

interface Props {
  open: boolean;
  items: SessionItem[];
  state: SessionState;
  onClose: () => void;
  onPost: (ids: string[]) => Promise<void>;
  onFinish: (status: ResultStatus) => Promise<void>;
  onSelect: (id: string) => void;
}

const firstLine = (text: string) => text.trim().split('\n')[0] ?? '';

export function SubmitDialog({ open, items, state, onClose, onPost, onFinish, onSelect }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState<'posting' | 'finishing' | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      setConfirmCancel(false);
      setError(null);
      element.showModal();
    }
    if (!open && element.open) element.close();
  }, [open]);

  const byStatus = (wanted: string) => items.filter((item) => statusOf(state.items[item.id]!) === wanted);
  const toSend = byStatus('send');
  const failed = byStatus('failed');
  const posted = byStatus('posted');
  const undecided = byStatus('undecided');
  const skipped = byStatus('skip');
  const pending = [...toSend, ...failed];

  const run = async (kind: 'posting' | 'finishing', action: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };

  const jump = (id: string) => {
    onSelect(id);
    onClose();
  };

  const row = (item: SessionItem, tone: 'send' | 'failed') => (
    <li key={item.id}>
      <button type="button" onClick={() => jump(item.id)} className="flex w-full gap-2 px-4 py-2 text-left hover:bg-canvas-subtle">
        <Icon name={tone === 'failed' ? 'alert' : 'reply'} className={`mt-0.5 shrink-0 ${tone === 'failed' ? 'text-danger' : 'text-fg-muted'}`} />
        <span className="min-w-0 flex-1 text-sm">
          <span className="block truncate text-xs text-fg-muted">
            {item.kind === 'summary' ? 'General comment' : `${authorOf(item)?.login ?? 'ghost'}: ${excerptOf(item)}`}
          </span>
          <span className="block truncate">{firstLine(state.items[item.id]!.body)}</span>
          {tone === 'failed' && <span className="block text-xs text-danger">{state.items[item.id]!.error}</span>}
        </span>
      </button>
    </li>
  );

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      className="m-auto w-[min(40rem,calc(100vw-2rem))] rounded-xl border border-border bg-overlay p-0 text-fg shadow-2xl backdrop:bg-black/50"
    >
      <div className="flex items-center border-b border-border px-4 py-3">
        <h2 className="flex-1 font-semibold">Post your replies</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-fg-muted hover:bg-btn-hover hover:text-fg">
          <Icon name="x" />
        </button>
      </div>

      <div className="max-h-[60vh] overflow-y-auto">
        <p className="px-4 pt-3 text-sm text-fg-muted">
          {pending.length} to post · {posted.length} posted · {skipped.length} skipped
          {undecided.length > 0 && <span className="text-attention"> · {undecided.length} undecided, which won't be posted</span>}
        </p>
        {pending.length > 0 && <ul className="mt-2 divide-y divide-border-muted border-y border-border-muted">{[...failed.map((i) => row(i, 'failed')), ...toSend.map((i) => row(i, 'send'))]}</ul>}
        {pending.length === 0 && (
          <p className="px-4 py-4 text-sm">{posted.length ? 'Everything marked to send has been posted.' : 'Nothing is marked to send.'}</p>
        )}
        {error && <p className="mx-4 my-3 rounded-md border border-danger/40 bg-danger-subtle px-3 py-2 text-sm text-danger">{error}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
        {confirmCancel ? (
          <>
            <span className="mr-auto text-sm">End the session without posting anything else?</span>
            <button type="button" onClick={() => setConfirmCancel(false)} className="rounded-md border border-border bg-btn px-3 py-1.5 text-sm font-medium hover:bg-btn-hover">
              Go back
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => run('finishing', () => onFinish('canceled'))}
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
            {pending.length > 0 ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => run('posting', () => onPost(pending.map((item) => item.id)))}
                className="rounded-md border border-success-emphasis bg-success-emphasis px-3 py-1.5 text-sm font-medium text-white hover:bg-success-emphasis-hover disabled:opacity-60"
              >
                {busy === 'posting' ? 'Posting…' : failed.length && !toSend.length ? `Retry ${failed.length} failed` : `Post ${pending.length} ${pending.length === 1 ? 'reply' : 'replies'}`}
              </button>
            ) : (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => run('finishing', () => onFinish('done'))}
                className="rounded-md border border-success-emphasis bg-success-emphasis px-3 py-1.5 text-sm font-medium text-white hover:bg-success-emphasis-hover disabled:opacity-60"
              >
                {busy === 'finishing' ? 'Finishing…' : 'Finish and hand back'}
              </button>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
