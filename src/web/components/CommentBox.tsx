import type { ReactNode } from 'react';
import type { User } from '../../shared/schema';
import { relativeTime } from '../model';
import { Avatar } from './Avatar';

export function CommentBox({
  author,
  createdAt,
  url,
  bodyHTML,
  badge,
  compact = false,
}: {
  author: User | null;
  createdAt: string | null;
  url: string;
  bodyHTML: string;
  badge?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`flex gap-3 ${compact ? 'px-4 py-3' : ''}`}>
      <Avatar user={author} size={compact ? 24 : 32} />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-semibold">{author?.login ?? 'ghost'}</span>
          <a href={url} target="_blank" rel="noreferrer" className="text-fg-muted hover:text-accent hover:underline">
            {relativeTime(createdAt)}
          </a>
          {badge}
        </div>
        {bodyHTML.trim() ? (
          <div className="markdown-body" dangerouslySetInnerHTML={{ __html: bodyHTML }} />
        ) : (
          <p className="text-fg-muted italic">No description provided.</p>
        )}
      </div>
    </div>
  );
}
