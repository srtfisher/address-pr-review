import type { User } from '../../shared/schema';

export function Avatar({ user, size = 20 }: { user: User | null; size?: number }) {
  if (!user?.avatarUrl) {
    return <span className="inline-block shrink-0 rounded-full bg-neutral-muted" style={{ width: size, height: size }} />;
  }
  return (
    <img
      src={user.avatarUrl.includes('?') || user.avatarUrl.startsWith('data:') ? user.avatarUrl : `${user.avatarUrl}?s=${size * 2}`}
      alt=""
      width={size}
      height={size}
      className="inline-block shrink-0 rounded-full object-cover"
      style={{ width: size, height: size, boxShadow: '0 0 0 1px var(--gh-border-muted)' }}
    />
  );
}
