import type { DiffLine } from '../../shared/diff';

const rowTone: Record<DiffLine['type'], { code: string; num: string; sign: string }> = {
  add: { code: 'bg-diff-add', num: 'bg-diff-add-num', sign: '+' },
  del: { code: 'bg-diff-del', num: 'bg-diff-del-num', sign: '-' },
  context: { code: '', num: '', sign: ' ' },
  hunk: { code: 'bg-diff-hunk text-fg-muted', num: 'bg-diff-hunk', sign: '' },
  meta: { code: 'text-fg-muted', num: '', sign: '' },
};

export function DiffView({ lines, isHighlighted }: { lines: DiffLine[]; isHighlighted?: (line: DiffLine, index: number) => boolean }) {
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
              <tr key={index} data-highlighted={highlighted || undefined}>
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
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
