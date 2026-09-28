import { describe, expect, it } from 'vitest';
import { findEmojiQuery, insertEmoji, rankEmoji, type Emoji } from '../src/shared/emoji';

const e = (emoji: string, names: string[], tags: string[] = []): Emoji => ({ emoji, names, tags });

describe('findEmojiQuery', () => {
  it('finds a colon shortcode at the caret', () => {
    expect(findEmojiQuery('nice :ta', 8)).toEqual({ start: 5, query: 'ta' });
    expect(findEmojiQuery(':+1', 3)).toEqual({ start: 0, query: '+1' });
    expect(findEmojiQuery('ok\n:rocket', 10)).toEqual({ start: 3, query: 'rocket' });
  });

  it('ignores times, URLs, smileys, and finished shortcodes', () => {
    expect(findEmojiQuery('at 10:30', 8)).toBeNull();
    expect(findEmojiQuery('http://ex', 9)).toBeNull();
    expect(findEmojiQuery('thanks :D', 9)).toBeNull();
    expect(findEmojiQuery(':tada: ', 7)).toBeNull();
    expect(findEmojiQuery('a::b', 4)).toBeNull();
  });
});

describe('rankEmoji', () => {
  const list = [e('😀', ['grinning'], ['smile']), e('😄', ['smile'], ['happy']), e('🎉', ['tada'], ['party']), e('😼', ['smirk_cat'])];

  it('puts name prefixes first, then name substrings, then tag prefixes', () => {
    expect(rankEmoji('sm', list).map((entry) => entry.emoji)).toEqual(['😄', '😼', '😀']);
    expect(rankEmoji('cat', list).map((entry) => entry.emoji)).toEqual(['😼']);
    expect(rankEmoji('part', list).map((entry) => entry.emoji)).toEqual(['🎉']);
  });

  it('respects the limit', () => {
    expect(rankEmoji('s', list, 1)).toHaveLength(1);
  });
});

describe('insertEmoji', () => {
  it('replaces the shortcode with the character and a space', () => {
    expect(insertEmoji('nice :ta', { start: 5, query: 'ta' }, '🎉')).toEqual({ text: 'nice 🎉 ', caret: 8 });
    expect(insertEmoji(':ta done', { start: 0, query: 'ta' }, '🎉')).toEqual({ text: '🎉 done', caret: 3 });
  });
});
