import { describe, expect, it } from 'vitest';
import { commentedLineCount, parseDiff } from '../src/shared/diff';

describe('parseDiff', () => {
  it('numbers old and new lines across hunks', () => {
    const lines = parseDiff(['@@ -1,2 +1,2 @@', ' same', '-old', '+new', '@@ -10,1 +10,2 @@', ' ten', '+eleven', '\\ No newline at end of file'].join('\n'));
    expect(lines.map((l) => [l.type, l.oldNo, l.newNo, l.text])).toEqual([
      ['hunk', null, null, '@@ -1,2 +1,2 @@'],
      ['context', 1, 1, 'same'],
      ['del', 2, null, 'old'],
      ['add', null, 2, 'new'],
      ['hunk', null, null, '@@ -10,1 +10,2 @@'],
      ['context', 10, 10, 'ten'],
      ['add', null, 11, 'eleven'],
      ['meta', null, null, '\\ No newline at end of file'],
    ]);
  });
});

describe('commentedLineCount', () => {
  it('is one line unless the comment spans a range', () => {
    expect(commentedLineCount(12, null)).toBe(1);
    expect(commentedLineCount(null, null)).toBe(1);
    expect(commentedLineCount(14, 11)).toBe(4);
    expect(commentedLineCount(10, 12)).toBe(1);
  });
});
