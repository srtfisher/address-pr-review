import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { findMentionQuery, insertMention, type MentionQuery } from '../../shared/mentions';
import type { User } from '../../shared/schema';
import { api } from '../api';
import { Avatar } from './Avatar';

const MIRRORED = [
  'boxSizing',
  'width',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'tabSize',
] as const;

function caretPosition(textarea: HTMLTextAreaElement, index: number): { top: number; left: number } {
  const mirror = document.createElement('div');
  const style = window.getComputedStyle(textarea);
  for (const property of MIRRORED) mirror.style[property] = style[property];
  Object.assign(mirror.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', top: '0', left: '0' });
  mirror.textContent = textarea.value.slice(0, index);
  const marker = document.createElement('span');
  marker.textContent = '​';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.offsetTop + Number.parseFloat(style.lineHeight || '20') - textarea.scrollTop;
  const left = marker.offsetLeft - textarea.scrollLeft;
  mirror.remove();
  return { top, left };
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onSubmitShortcut: () => void;
  placeholder?: string;
}

export function ReplyEditor({ value, onChange, disabled, textareaRef, onSubmitShortcut, placeholder }: Props) {
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [preview, setPreview] = useState<{ text: string; html: string } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [mention, setMention] = useState<MentionQuery | null>(null);
  const [suggestions, setSuggestions] = useState<User[]>([]);
  const [active, setActive] = useState(0);
  const [anchor, setAnchor] = useState({ top: 0, left: 0 });
  const lookup = useRef(0);

  useEffect(() => {
    if (tab !== 'preview' || preview?.text === value) return;
    let current = true;
    setPreviewError(null);
    api
      .preview(value)
      .then(({ html }) => current && setPreview({ text: value, html }))
      .catch((error: Error) => current && setPreviewError(error.message));
    return () => {
      current = false;
    };
  }, [tab, value, preview?.text]);

  useEffect(() => {
    if (!mention) {
      setSuggestions([]);
      return;
    }
    const id = ++lookup.current;
    const timer = window.setTimeout(
      () => {
        api
          .mentions(mention.query)
          .then((users) => {
            if (id === lookup.current) {
              setSuggestions(users);
              setActive(0);
            }
          })
          .catch(() => setSuggestions([]));
      },
      mention.query ? 150 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [mention?.query, mention?.start]);

  const refreshMention = (textarea: HTMLTextAreaElement) => {
    const found = textarea.selectionStart === textarea.selectionEnd ? findMentionQuery(textarea.value, textarea.selectionStart) : null;
    setMention(found);
    if (found) setAnchor(caretPosition(textarea, found.start));
  };

  const choose = (user: User) => {
    const textarea = textareaRef.current;
    if (!textarea || !mention) return;
    const next = insertMention(textarea.value, mention, user.login);
    onChange(next.text);
    setMention(null);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(next.caret, next.caret);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && suggestions.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActive((index) => (index + step + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        choose(suggestions[active]!);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setMention(null);
        return;
      }
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSubmitShortcut();
    }
    if (event.key === 'Escape') {
      event.currentTarget.blur();
    }
  };

  const tabClass = (name: 'write' | 'preview') =>
    `-mb-px rounded-t-md border px-4 py-2 text-sm ${
      tab === name ? 'border-border border-b-canvas bg-canvas font-medium text-fg' : 'border-transparent text-fg-muted hover:text-fg'
    }`;

  return (
    <div className="rounded-md border border-border bg-canvas">
      <div className="flex items-end gap-1 rounded-t-md border-b border-border bg-canvas-subtle px-2 pt-2">
        <button type="button" className={tabClass('write')} onClick={() => setTab('write')}>
          Write
        </button>
        <button type="button" className={tabClass('preview')} onClick={() => setTab('preview')}>
          Preview
        </button>
      </div>
      <div className="relative p-2">
        {tab === 'write' ? (
          <>
            <textarea
              ref={textareaRef}
              value={value}
              disabled={disabled}
              placeholder={placeholder}
              aria-label="Reply"
              aria-autocomplete="list"
              aria-expanded={Boolean(mention && suggestions.length)}
              onChange={(event) => {
                onChange(event.target.value);
                refreshMention(event.target);
              }}
              onKeyDown={onKeyDown}
              onClick={(event) => refreshMention(event.currentTarget)}
              onKeyUp={(event) => {
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) refreshMention(event.currentTarget);
              }}
              onBlur={() => window.setTimeout(() => setMention(null), 150)}
              className="block min-h-32 w-full resize-y rounded-md border border-border bg-canvas-inset px-3 py-2 text-sm leading-5 outline-none focus:border-accent-emphasis focus:bg-canvas focus:ring-1 focus:ring-accent-emphasis disabled:cursor-not-allowed disabled:opacity-70"
            />
            {mention && suggestions.length > 0 && (
              <ul
                role="listbox"
                className="absolute z-20 w-64 overflow-hidden rounded-md border border-border bg-overlay py-1 shadow-lg"
                style={{ top: anchor.top + 12, left: Math.min(anchor.left + 8, 480) }}
              >
                {suggestions.map((user, index) => (
                  <li key={user.login} role="option" aria-selected={index === active}>
                    <button
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        choose(user);
                      }}
                      onMouseEnter={() => setActive(index)}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                        index === active ? 'bg-accent-emphasis text-white' : ''
                      }`}
                    >
                      <Avatar user={user} size={20} />
                      <span className="font-semibold">{user.login}</span>
                      {user.name && <span className={`truncate ${index === active ? 'text-white/80' : 'text-fg-muted'}`}>{user.name}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <div className="min-h-32 px-2 py-2">
            {previewError ? (
              <p className="text-danger">Preview failed: {previewError}</p>
            ) : !value.trim() ? (
              <p className="text-fg-muted">Nothing to preview</p>
            ) : preview?.text === value ? (
              <div className="markdown-body" dangerouslySetInnerHTML={{ __html: preview.html }} />
            ) : (
              <p className="text-fg-muted">Loading preview…</p>
            )}
          </div>
        )}
      </div>
      <p className="px-3 pb-2 text-xs text-fg-muted">
        Markdown supported. Type <kbd className="font-mono">@</kbd> to mention someone. <kbd className="font-mono">⌘↵</kbd> marks it to send and moves on.
      </p>
    </div>
  );
}
