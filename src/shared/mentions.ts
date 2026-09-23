import type { User } from './schema';

export interface MentionQuery {
  start: number;
  query: string;
}

export function findMentionQuery(text: string, caret: number): MentionQuery | null {
  const match = /(^|[^\w`@])@([A-Za-z0-9-]{0,39})$/.exec(text.slice(0, caret));
  if (!match) {
    return null;
  }
  const query = match[2] ?? '';
  return { start: caret - query.length - 1, query };
}

export function rankMentions(query: string, participants: User[], others: User[], limit = 8): User[] {
  const needle = query.toLowerCase();
  const score = (user: User): number => {
    const login = user.login.toLowerCase();
    const name = (user.name ?? '').toLowerCase();
    if (login.startsWith(needle)) return 0;
    if (name.split(/\s+/).some((part) => part.startsWith(needle))) return 1;
    if (login.includes(needle) || name.includes(needle)) return 2;
    return -1;
  };
  const seen = new Set<string>();
  const pick = (users: User[]): User[] =>
    users
      .map((user) => ({ user, rank: score(user) }))
      .filter(({ user, rank }) => rank >= 0 && !seen.has(user.login))
      .sort((a, b) => a.rank - b.rank || a.user.login.localeCompare(b.user.login))
      .map(({ user }) => {
        seen.add(user.login);
        return user;
      });
  return [...pick(participants), ...pick(others)].slice(0, limit);
}

export function insertMention(text: string, mention: MentionQuery, login: string): { text: string; caret: number } {
  const before = text.slice(0, mention.start);
  const after = text.slice(mention.start + 1 + mention.query.length);
  const inserted = `@${login} `;
  return { text: before + inserted + after.replace(/^ /, ''), caret: before.length + inserted.length };
}
