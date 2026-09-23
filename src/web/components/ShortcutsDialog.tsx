import { useEffect, useRef } from 'react';
import { Icon } from './icons';

const groups: { title: string; shortcuts: { keys: string[]; label: string }[] }[] = [
  {
    title: 'Review',
    shortcuts: [
      { keys: ['j'], label: 'Next item' },
      { keys: ['k'], label: 'Previous item' },
      { keys: ['s'], label: 'Send the reply and move on' },
      { keys: ['x'], label: "Don't reply and move on" },
      { keys: ['a'], label: 'Ask the agent to change it' },
      { keys: ['e'], label: 'Edit the reply' },
      { keys: ['?'], label: 'Show keyboard shortcuts' },
    ],
  },
  {
    title: 'Writing a reply',
    shortcuts: [
      { keys: ['⌘', 'Enter'], label: 'Send the reply and move on' },
      { keys: ['@'], label: 'Mention someone' },
      { keys: ['Esc'], label: 'Stop editing' },
    ],
  },
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(event) => event.target === event.currentTarget && onClose()}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-border bg-overlay p-0 text-fg shadow-2xl backdrop:bg-black/50"
    >
      <div className="flex items-center border-b border-border px-4 py-3">
        <h2 className="flex-1 font-semibold">Keyboard shortcuts</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-fg-muted hover:bg-btn-hover hover:text-fg">
          <Icon name="x" />
        </button>
      </div>
      <div className="space-y-4 px-4 py-3">
        {groups.map((group) => (
          <section key={group.title}>
            <h3 className="mb-1 text-xs font-semibold text-fg-muted">{group.title}</h3>
            <dl className="divide-y divide-border-muted">
              {group.shortcuts.map((shortcut) => (
                <div key={shortcut.label + shortcut.keys.join()} className="flex items-center justify-between gap-4 py-1.5 text-sm">
                  <dt>{shortcut.label}</dt>
                  <dd className="flex gap-1">
                    {shortcut.keys.map((key) => (
                      <kbd key={key} className="min-w-6 rounded border border-border bg-canvas-subtle px-1.5 text-center font-mono text-xs leading-5">
                        {key}
                      </kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </dialog>
  );
}
