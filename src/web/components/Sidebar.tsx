import type { SessionItem, SessionState } from '../../shared/schema';
import { authorOf, excerptOf, lineLabel, statusOf, type Group, type ItemStatus } from '../model';
import { Icon, type IconName } from './icons';

const statusIcon: Record<ItemStatus, { icon: IconName; className: string; label: string }> = {
  undecided: { icon: 'circle', className: 'text-fg-muted', label: 'Undecided' },
  send: { icon: 'checkCircle', className: 'text-success', label: 'Will send' },
  skip: { icon: 'skip', className: 'text-fg-muted', label: "Won't reply" },
  posted: { icon: 'checkCircle', className: 'text-done', label: 'Posted' },
  failed: { icon: 'alert', className: 'text-danger', label: 'Failed to post' },
};

function splitPath(path: string): { dir: string; name: string } {
  const index = path.lastIndexOf('/');
  return index === -1 ? { dir: '', name: path } : { dir: path.slice(0, index + 1), name: path.slice(index + 1) };
}

interface Props {
  groups: Group[];
  state: SessionState;
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: 'all' | 'undecided';
  onFilter: (filter: 'all' | 'undecided') => void;
  counts: Record<ItemStatus, number>;
}

export function Sidebar({ groups, state, selectedId, onSelect, filter, onFilter, counts }: Props) {
  const visible = (item: SessionItem) => filter === 'all' || statusOf(state.items[item.id]!) === 'undecided';
  const shown = groups.map((group) => ({ ...group, items: group.items.filter(visible) })).filter((group) => group.items.length);
  const filterButton = (value: 'all' | 'undecided', label: string, count: number) => (
    <button
      type="button"
      aria-pressed={filter === value}
      onClick={() => onFilter(value)}
      className={`flex-1 rounded-md px-2 py-1 text-xs font-medium ${filter === value ? 'bg-canvas text-fg shadow-sm ring-1 ring-border' : 'text-fg-muted hover:text-fg'}`}
    >
      {label} <span className="ml-1 rounded-full bg-neutral-muted px-1.5">{count}</span>
    </button>
  );
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);

  return (
    <nav aria-label="Feedback" className="flex h-full flex-col">
      <div className="border-b border-border p-3">
        <div className="flex gap-1 rounded-md bg-canvas-subtle p-1 ring-1 ring-border-muted">
          {filterButton('all', 'All', total)}
          {filterButton('undecided', 'Undecided', counts.undecided)}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {shown.length === 0 && <p className="px-4 py-6 text-center text-sm text-fg-muted">Everything has a decision.</p>}
        {shown.map((group) => {
          const { dir, name } = splitPath(group.label);
          return (
            <section key={group.key} aria-label={group.label}>
              <h3
                className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-border-muted bg-canvas-subtle px-3 py-1.5 text-xs"
                title={group.label}
              >
                <Icon name={group.isFile ? 'file' : 'comment'} size={14} className="shrink-0 text-fg-muted" />
                {group.isFile ? (
                  <span className="flex min-w-0 font-mono">
                    <span className="truncate text-fg-muted" style={{ direction: 'rtl' }}>
                      {`\u200e${dir}\u200e`}
                    </span>
                    <span className="shrink-0 font-semibold">{name}</span>
                  </span>
                ) : (
                  <span className="font-semibold">{group.label}</span>
                )}
              </h3>
              <ul>
                {group.items.map((item) => {
                  const status = statusOf(state.items[item.id]!);
                  const icon =
                    item.kind === 'summary' && status === 'skip'
                      ? { icon: 'comment' as const, className: 'text-fg-muted', label: 'Optional' }
                      : statusIcon[status];
                  const selected = item.id === selectedId;
                  const author = authorOf(item);
                  const line = lineLabel(item);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(item.id)}
                        aria-current={selected || undefined}
                        data-item-id={item.id}
                        className={`relative flex w-full scroll-mt-9 gap-2 px-3 py-2 text-left hover:bg-canvas-subtle ${selected ? 'bg-accent-subtle hover:bg-accent-subtle' : ''}`}
                      >
                        {selected && <span className="absolute inset-y-1 left-0 w-1 rounded-r bg-accent-emphasis" />}
                        <Icon name={icon.icon} className={`mt-0.5 shrink-0 ${icon.className}`} aria-label={icon.label} role="img" aria-hidden={false} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 text-xs text-fg-muted">
                            {line && <span className="font-mono">{line}</span>}
                            {author && <span className="truncate">{author.login}</span>}
                            {item.newActivity && <span className="size-1.5 shrink-0 rounded-full bg-attention" title="New replies since the draft" />}
                          </span>
                          <span className={`line-clamp-2 text-sm ${status === 'skip' ? 'text-fg-muted' : ''}`}>{excerptOf(item)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </nav>
  );
}
