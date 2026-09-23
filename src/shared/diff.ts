export type DiffLineType = 'hunk' | 'add' | 'del' | 'context' | 'meta';

export interface DiffLine {
  type: DiffLineType;
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseDiff(patch: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  const raw = patch.replace(/\n$/, '').split('\n');
  for (const text of raw) {
    const header = HUNK_HEADER.exec(text);
    if (header) {
      oldNo = Number(header[1]);
      newNo = Number(header[2]);
      lines.push({ type: 'hunk', oldNo: null, newNo: null, text });
    } else if (text.startsWith('+')) {
      lines.push({ type: 'add', oldNo: null, newNo: newNo++, text: text.slice(1) });
    } else if (text.startsWith('-')) {
      lines.push({ type: 'del', oldNo: oldNo++, newNo: null, text: text.slice(1) });
    } else if (text.startsWith('\\')) {
      lines.push({ type: 'meta', oldNo: null, newNo: null, text });
    } else {
      lines.push({ type: 'context', oldNo: oldNo++, newNo: newNo++, text: text.slice(1) });
    }
  }
  return lines;
}

// GitHub trims a review comment's diff hunk so it ends on the commented line.
export function commentedLineCount(line: number | null, startLine: number | null): number {
  if (line === null || startLine === null || startLine > line) {
    return 1;
  }
  return line - startLine + 1;
}
