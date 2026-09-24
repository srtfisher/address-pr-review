import type { PullRequest } from '../../shared/schema';
import { Icon, type IconName } from './icons';

export type Theme = 'system' | 'light' | 'dark';

const themeOrder: Theme[] = ['system', 'light', 'dark'];
const themeIcon: Record<Theme, IconName> = { system: 'deviceDesktop', light: 'sun', dark: 'moon' };

interface Props {
  pr: PullRequest;
  decided: number;
  total: number;
  sendCount: number;
  askCount: number;
  fixture: boolean;
  theme: Theme;
  onTheme: (theme: Theme) => void;
  onReview: () => void;
}

export function Header({ pr, decided, total, sendCount, askCount, fixture, theme, onTheme, onReview }: Props) {
  const next = themeOrder[(themeOrder.indexOf(theme) + 1) % themeOrder.length]!;
  const percent = total ? Math.round((decided / total) * 100) : 0;
  return (
    <header className="border-b border-border bg-canvas px-6 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl leading-7">
            <a href={pr.url} target="_blank" rel="noreferrer" className="hover:text-accent hover:underline">
              {pr.title}
            </a>{' '}
            <span className="font-light text-fg-muted">#{pr.number}</span>
          </h1>
          <p className="flex flex-wrap items-center gap-1.5 text-sm text-fg-muted">
            <span className="inline-flex items-center gap-1 rounded-full bg-success-emphasis px-2 text-xs leading-5 font-medium text-white">
              <Icon name="pr" size={12} /> Open
            </span>
            <span>
              {pr.owner}/{pr.repo} ·{' '}
              <code className="rounded-md bg-accent-subtle px-1.5 font-mono text-xs text-accent">{pr.baseRefName}</code> ←{' '}
              <code className="rounded-md bg-accent-subtle px-1.5 font-mono text-xs text-accent">{pr.headRefName}</code>
            </span>
            {fixture && (
              <span className="rounded-full border border-attention/40 px-2 text-xs leading-5 text-attention">Fixture data, nothing is posted</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right text-xs text-fg-muted" aria-live="polite">
            <div>
              <span className="font-semibold text-fg">{decided}</span> of {total} decided
            </div>
            <div className="mt-1 h-1.5 w-32 overflow-hidden rounded-full bg-neutral-muted">
              <div className="h-full rounded-full bg-success-emphasis transition-[width]" style={{ width: `${percent}%` }} />
            </div>
          </div>
          <button
            type="button"
            onClick={() => onTheme(next)}
            title={`Theme: ${theme}. Switch to ${next}.`}
            aria-label={`Theme: ${theme}. Switch to ${next}.`}
            className="rounded-md border border-border bg-btn p-2 text-fg-muted hover:bg-btn-hover hover:text-fg"
          >
            <Icon name={themeIcon[theme]} />
          </button>
          <button
            type="button"
            onClick={onReview}
            title="Review and finish (f)"
            aria-keyshortcuts="f"
            className={`rounded-md border px-3 py-1.5 text-sm font-medium text-white ${
              askCount ? 'border-done bg-done hover:opacity-90' : 'border-success-emphasis bg-success-emphasis hover:bg-success-emphasis-hover'
            }`}
          >
            {askCount ? `Send ${askCount} back to the agent…` : sendCount ? `Approve ${sendCount} ${sendCount === 1 ? 'reply' : 'replies'}…` : 'Finish…'}
          </button>
        </div>
      </div>
    </header>
  );
}
