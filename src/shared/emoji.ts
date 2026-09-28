export interface Emoji {
  emoji: string;
  names: string[];
  tags: string[];
}

export interface EmojiQuery {
  start: number;
  query: string;
}

// Two characters minimum so a smiley like ":D" doesn't grab Enter.
export function findEmojiQuery(text: string, caret: number): EmojiQuery | null {
  const match = /(^|[\s([{>])(:)([a-z0-9_+-]{2,})$/i.exec(text.slice(0, caret));
  if (!match) {
    return null;
  }
  const query = match[3] ?? '';
  return { start: caret - query.length - 1, query };
}

export function rankEmoji(query: string, emoji: Emoji[], limit = 8): Emoji[] {
  const needle = query.toLowerCase();
  const score = (entry: Emoji): number => {
    if (entry.names.some((name) => name.startsWith(needle))) return 0;
    if (entry.names.some((name) => name.includes(needle))) return 1;
    if (entry.tags.some((tag) => tag.startsWith(needle))) return 2;
    return -1;
  };
  return emoji
    .map((entry, index) => ({ entry, index, rank: score(entry) }))
    .filter(({ rank }) => rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, limit)
    .map(({ entry }) => entry);
}

export function insertEmoji(text: string, query: EmojiQuery, emoji: string): { text: string; caret: number } {
  const before = text.slice(0, query.start);
  const after = text.slice(query.start + 1 + query.query.length);
  const inserted = `${emoji} `;
  return { text: before + inserted + after.replace(/^ /, ''), caret: before.length + inserted.length };
}
