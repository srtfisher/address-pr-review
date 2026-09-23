import { Fragment, type ReactNode } from 'react';
import type { DiffLine } from '../../shared/diff';

const rowTone: Record<DiffLine['type'], { code: string; num: string; sign: string }> = {
  add: { code: 'bg-diff-add', num: 'bg-diff-add-num', sign: '+' },
  del: { code: 'bg-diff-del', num: 'bg-diff-del-num', sign: '-' },
  context: { code: '', num: '', sign: ' ' },
  hunk: { code: 'bg-diff-hunk text-fg-muted', num: 'bg-diff-hunk', sign: '' },
  meta: { code: 'text-fg-muted', num: '', sign: '' },
};

interface Props {
  lines: DiffLine[];
  isHighlighted?: (line: DiffLine, index: number) => boolean;
  /** Content shown under a row, the way GitHub shows a review thread under its line. */
  insertAfter?: { index: number; node: ReactNode };
}

export function DiffView({ lines, isHighlighted, insertAfter }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse font-mono text-xs leading-5">
        <tbody>
          {lines.map((line, index) => {
            const tone = rowTone[line.type];
            const highlighted = isHighlighted?.(line, index) ?? false;
            const numClass = `w-[1%] min-w-10 select-none px-2 text-right align-top text-fg-muted ${
              highlighted ? 'bg-diff-selected-num' : tone.num
            }`;
            return (
              <Fragment key={index}>
              <tr data-highlighted={highlighted || undefined}>
                {line.type === 'hunk' ? (
                  <td colSpan={2} className={`${numClass} bg-diff-hunk`} />
                ) : (
                  <>
                    <td className={numClass}>{line.oldNo ?? ''}</td>
                    <td className={numClass}>{line.newNo ?? ''}</td>
                  </>
                )}
                <td className={`whitespace-pre px-2 align-top ${highlighted ? 'bg-diff-selected' : tone.code}`}>
                  <span className="mr-2 select-none text-fg-muted">{tone.sign}</span>
                  {line.text}
                </td>
              </tr>
              {insertAfter?.index === index && (
                <tr>
                  <td colSpan={3} className="border-y border-border bg-canvas p-0 font-sans text-sm leading-normal">
                    {insertAfter.node}
                  </td>
                </tr>
              )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
