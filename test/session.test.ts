import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FixtureData } from '../src/server/fake-github';
import { buildItems, initialState, parseDrafts } from '../src/server/session';

const dir = join(import.meta.dirname, 'fixtures/large-pr');
const fixture = JSON.parse(readFileSync(join(dir, 'fixture.json'), 'utf8')) as FixtureData;
const rawDrafts = JSON.parse(readFileSync(join(dir, 'drafts.json'), 'utf8'));

describe('parseDrafts', () => {
  it('accepts the fixture drafts', () => {
    expect(parseDrafts(rawDrafts).items.length).toBeGreaterThan(20);
  });

  it('reports where a drafts file is wrong', () => {
    const bad = { ...rawDrafts, items: [{ ...rawDrafts.items[0], decision: 'maybe' }, rawDrafts.items[0]] };
    expect(() => parseDrafts(bad)).toThrow(/items\.0\.decision/);
    expect(() => parseDrafts({ ...rawDrafts, items: [rawDrafts.items[0], rawDrafts.items[0]] })).toThrow(/duplicate/);
    expect(() => parseDrafts({ ...rawDrafts, version: 2 })).toThrow(/version/);
  });
});

describe('buildItems', () => {
  const drafts = parseDrafts(rawDrafts);
  const items = buildItems(drafts, fixture.pr);

  it('joins every draft to its GitHub source and appends the summary', () => {
    expect(items.filter((item) => item.source.kind === 'missing')).toEqual([]);
    expect(items.at(-1)).toMatchObject({ id: 'summary', kind: 'summary' });
  });

  it('flags threads with replies newer than the draft', () => {
    const flagged = items.filter((item) => item.newActivity).map((item) => item.id);
    expect(flagged).toContain(drafts.items[3]!.id);
    expect(flagged).not.toContain(drafts.items[0]!.id);
  });

  it('always offers a general comment, starting skipped when the agent drafted none', () => {
    const withoutSummary = buildItems({ ...drafts, summary: null }, fixture.pr);
    const general = withoutSummary.at(-1)!;
    expect(general).toMatchObject({ id: 'summary', kind: 'summary', draft: '' });
    expect(initialState(withoutSummary).items.summary).toMatchObject({ action: 'skip', body: '' });
    expect(initialState(items).items.summary).toMatchObject({ action: null, body: drafts.summary!.draft });
  });

  it('marks a draft whose comment no longer exists as missing', () => {
    const [item] = buildItems({ ...drafts, items: [{ ...drafts.items[0]!, commentId: 1 }], summary: null }, fixture.pr);
    expect(item!.source.kind).toBe('missing');
  });

  it('starts undecided with the draft text, keeping saved state', () => {
    const fresh = initialState(items);
    expect(fresh.items[items[0]!.id]).toEqual({
      action: null,
      body: items[0]!.draft,
      instructions: '',
      basedOn: items[0]!.draft,
      lastAsk: null,
      postedUrl: null,
      error: null,
    });
    const saved = initialState(items);
    saved.items[items[0]!.id] = { ...saved.items[items[0]!.id]!, action: 'skip', body: 'x' };
    expect(initialState(items, saved).items[items[0]!.id]).toMatchObject({ action: 'skip', body: 'x' });
  });

  describe('on reopen after the agent reworked items', () => {
    const [approved, asked, redrafted, posted] = items;
    const saved = initialState(items);
    saved.items[approved!.id] = { ...saved.items[approved!.id]!, action: 'send', body: 'My own words.' };
    saved.items[asked!.id] = { ...saved.items[asked!.id]!, action: 'ask', instructions: 'Revert it.' };
    saved.items[redrafted!.id] = { ...saved.items[redrafted!.id]!, action: 'skip' };
    saved.items[posted!.id] = { ...saved.items[posted!.id]!, action: 'send', postedUrl: 'https://github.com/x#r1' };
    const next = items.map((item) =>
      item.id === asked!.id || item.id === redrafted!.id || item.id === posted!.id ? { ...item, draft: `${item.draft} (v2)` } : item,
    );
    const reopened = initialState(next, saved);

    it('keeps approved replies whose draft did not change', () => {
      expect(reopened.items[approved!.id]).toMatchObject({ action: 'send', body: 'My own words.', lastAsk: null });
    });

    it('resets what the human sent back, showing what they asked', () => {
      expect(reopened.items[asked!.id]).toMatchObject({ action: null, body: `${asked!.draft} (v2)`, instructions: '', lastAsk: 'Revert it.' });
    });

    it('resets an item the agent redrafted without being asked', () => {
      expect(reopened.items[redrafted!.id]).toMatchObject({ action: null, body: `${redrafted!.draft} (v2)`, lastAsk: null });
    });

    it('never resets a reply that already posted', () => {
      expect(reopened.items[posted!.id]).toMatchObject({ postedUrl: 'https://github.com/x#r1' });
    });

    it('resets an item sent back even when the agent kept the draft', () => {
      const same = initialState(items, saved);
      expect(same.items[asked!.id]).toMatchObject({ action: null, lastAsk: 'Revert it.' });
    });
  });
});
