import { describe, expect, it } from 'vitest';
import { findMentionQuery, insertMention, rankMentions } from '../src/shared/mentions';
import type { User } from '../src/shared/schema';

const u = (login: string, name: string | null = null): User => ({ login, name, avatarUrl: '' });

describe('findMentionQuery', () => {
  it('finds an @ at the caret', () => {
    expect(findMentionQuery('thanks @jo', 10)).toEqual({ start: 7, query: 'jo' });
    expect(findMentionQuery('@', 1)).toEqual({ start: 0, query: '' });
  });

  it('ignores emails and code', () => {
    expect(findMentionQuery('mail me@example', 15)).toBeNull();
    expect(findMentionQuery('`@decorator', 11)).toBeNull();
    expect(findMentionQuery('@jo done', 8)).toBeNull();
  });
});

describe('rankMentions', () => {
  it('puts PR participants first, then prefix matches before substring matches', () => {
    const participants = [u('sam-o', 'Sam Oyelaran'), u('jordan-k', 'Jordan Kim')];
    const others = [u('jo'), u('majority'), u('jordan-k')];
    expect(rankMentions('jo', participants, others).map((user) => user.login)).toEqual(['jordan-k', 'jo', 'majority']);
    expect(rankMentions('oye', participants, []).map((user) => user.login)).toEqual(['sam-o']);
  });

  it('lists participants for an empty query', () => {
    expect(rankMentions('', [u('b'), u('a')], []).map((user) => user.login)).toEqual(['a', 'b']);
  });
});

describe('insertMention', () => {
  it('replaces the partial mention and places the caret after it', () => {
    expect(insertMention('hi @jo there', { start: 3, query: 'jo' }, 'jordan-k')).toEqual({ text: 'hi @jordan-k there', caret: 13 });
  });
});
