import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Action, ItemState, ResultStatus, SessionPayload, SessionState } from '../shared/schema';
import { api } from './api';
import { Header, type Theme } from './components/Header';
import { Icon } from './components/icons';
import { ItemView } from './components/ItemView';
import { Sidebar } from './components/Sidebar';
import { SubmitDialog } from './components/SubmitDialog';
import { groupItems, statusOf, type ItemStatus } from './model';

const THEME_KEY = 'address-pr-review:theme';
const SAVE_DELAY_MS = 400;

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

function applyTheme(theme: Theme): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {}
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export function App() {
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, setState] = useState<SessionState>({ items: {} });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'undecided'>('all');
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [finished, setFinished] = useState<ResultStatus | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const instructionsRef = useRef<HTMLTextAreaElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const pendingSaves = useRef(new Map<string, { timer: number; save: () => Promise<unknown> }>());

  useEffect(() => applyTheme(theme), [theme]);

  useEffect(() => {
    api
      .session()
      .then((payload) => {
        setSession(payload);
        setState(payload.state);
        const groups = groupItems(payload.items);
        const firstUndecided = groups.flatMap((g) => g.items).find((item) => statusOf(payload.state.items[item.id]!) === 'undecided');
        setSelectedId(firstUndecided?.id ?? groups[0]?.items[0]?.id ?? null);
      })
      .catch((error: Error) => setLoadError(error.message));
  }, []);

  const groups = useMemo(() => (session ? groupItems(session.items) : []), [session]);
  const ordered = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const selected = ordered.find((item) => item.id === selectedId) ?? null;

  const counts = useMemo(() => {
    const result: Record<ItemStatus, number> = { undecided: 0, send: 0, skip: 0, ask: 0, posted: 0, failed: 0 };
    for (const item of ordered) result[statusOf(state.items[item.id]!)]++;
    return result;
  }, [ordered, state]);

  const patchLocal = (id: string, patch: Partial<ItemState>) =>
    setState((current) => ({ items: { ...current.items, [id]: { ...current.items[id]!, ...patch } } }));

  const persist = useCallback((id: string, patch: { action?: Action | null; body?: string; instructions?: string }) => {
    return api
      .updateItem(id, patch)
      .then(() => setSaveError(null))
      .catch((error: Error) => setSaveError(error.message));
  }, []);

  const saveLater = (id: string, field: 'body' | 'instructions', value: string) => {
    const key = `${id}:${field}`;
    window.clearTimeout(pendingSaves.current.get(key)?.timer);
    const save = () => {
      pendingSaves.current.delete(key);
      return persist(id, { [field]: value });
    };
    pendingSaves.current.set(key, { timer: window.setTimeout(save, SAVE_DELAY_MS), save });
  };

  const flushSaves = async () => {
    for (const { timer, save } of [...pendingSaves.current.values()]) {
      window.clearTimeout(timer);
      await save();
    }
  };

  const setBody = (id: string, body: string) => {
    patchLocal(id, { body, error: null });
    saveLater(id, 'body', body);
  };

  const setInstructions = (id: string, instructions: string) => {
    patchLocal(id, { instructions });
    saveLater(id, 'instructions', instructions);
  };

  const setAction = (id: string, action: Action | null) => {
    patchLocal(id, { action, error: null });
    void flushSaves().then(() => persist(id, { action }));
    if (action === 'ask') requestAnimationFrame(() => instructionsRef.current?.focus());
  };

  const visibleIds = useMemo(
    () => ordered.filter((item) => filter === 'all' || statusOf(state.items[item.id]!) === 'undecided' || item.id === selectedId).map((item) => item.id),
    [ordered, filter, state, selectedId],
  );

  const move = useCallback(
    (step: 1 | -1) => {
      if (!selectedId) return;
      const index = visibleIds.indexOf(selectedId);
      const next = visibleIds[index + step];
      if (next) setSelectedId(next);
    },
    [selectedId, visibleIds],
  );

  const decideAndAdvance = (action: Action) => {
    if (!selected) return;
    const itemState = state.items[selected.id]!;
    if (itemState.postedUrl || (action === 'send' && (!itemState.body.trim() || selected.source.kind === 'missing'))) return;
    setAction(selected.id, action);
    move(1);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (dialogOpen || finished || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (event.key === 'j') move(1);
      else if (event.key === 'k') move(-1);
      else if (event.key === 's') decideAndAdvance('send');
      else if (event.key === 'x') decideAndAdvance('skip');
      else if (event.key === 'a' && selected && selected.kind !== 'summary' && selected.source.kind !== 'missing') setAction(selected.id, 'ask');
      else if (event.key === 'e') {
        event.preventDefault();
        const textarea = textareaRef.current;
        textarea?.focus();
        textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
      } else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
    document.querySelector(`[data-item-id="${CSS.escape(selectedId ?? '')}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const finish = async (status: ResultStatus) => {
    await flushSaves();
    await api.finish(status);
    setDialogOpen(false);
    setFinished(status);
  };

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md rounded-md border border-danger/40 bg-danger-subtle p-4 text-sm text-danger">
          <p className="font-semibold">Could not load the review session.</p>
          <p className="mt-1">{loadError}</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <div className="flex h-full items-center justify-center text-fg-muted">Loading the pull request…</div>;
  }

  if (finished) {
    const ending = {
      approved: {
        icon: 'checkCircle' as const,
        tone: 'text-done',
        title: 'Approved',
        text: 'Your agent will push the fixes, then post your replies exactly as written. You can close this tab.',
      },
      revise: {
        icon: 'sparkle' as const,
        tone: 'text-done',
        title: 'Sent back to the agent',
        text: 'It will rework what you asked for and open a new page with your other choices kept. You can close this tab.',
      },
      canceled: { icon: 'skip' as const, tone: 'text-fg-muted', title: 'Session ended', text: 'Nothing was pushed or posted. You can close this tab.' },
    }[finished];
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md text-center">
          <Icon name={ending.icon} size={32} className={`mx-auto ${ending.tone}`} />
          <h1 className="mt-3 text-xl font-semibold">{ending.title}</h1>
          <p className="mt-2 text-fg-muted">{ending.text}</p>
          <a href={session.pr.url} target="_blank" rel="noreferrer" className="mt-4 inline-block text-accent hover:underline">
            Open the pull request
          </a>
        </div>
      </div>
    );
  }

  const decided = ordered.length - counts.undecided;

  return (
    <div className="flex h-full flex-col">
      <Header
        pr={session.pr}
        decided={decided}
        total={ordered.length}
        sendCount={counts.send + counts.failed}
        askCount={counts.ask}
        fixture={session.fixture}
        theme={theme}
        onTheme={setTheme}
        onReview={() => setDialogOpen(true)}
      />
      {saveError && (
        <div className="border-b border-danger/40 bg-danger-subtle px-6 py-2 text-sm text-danger">Your last change was not saved: {saveError}</div>
      )}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="max-h-72 shrink-0 border-b border-border md:max-h-none md:w-80 md:border-r md:border-b-0">
          <Sidebar groups={groups} state={state} selectedId={selectedId} onSelect={setSelectedId} filter={filter} onFilter={setFilter} counts={counts} />
        </aside>
        <main ref={mainRef} className="min-w-0 flex-1 overflow-y-auto">
          {selected ? (
            <ItemView
              key={selected.id}
              item={selected}
              state={state.items[selected.id]!}
              textareaRef={textareaRef}
              instructionsRef={instructionsRef}
              onBody={(body) => setBody(selected.id, body)}
              onInstructions={(instructions) => setInstructions(selected.id, instructions)}
              onAction={(action) => setAction(selected.id, action)}
              onSendAndNext={() => decideAndAdvance('send')}
            />
          ) : (
            <p className="p-6 text-fg-muted">There is no feedback in this session.</p>
          )}
        </main>
      </div>
      <SubmitDialog
        open={dialogOpen}
        items={ordered}
        state={state}
        onClose={() => setDialogOpen(false)}
        onFinish={finish}
        onSelect={setSelectedId}
      />
    </div>
  );
}
