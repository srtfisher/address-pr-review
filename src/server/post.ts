import { existsSync } from 'node:fs';
import { SUMMARY_ID, type Drafts, type Results, type SessionState } from '../shared/schema';
import type { GitHub } from './github';
import { parseDrafts, readJson, readSavedState, sessionFiles, writeJson } from './session';

export interface PostOutcome {
  id: string;
  postedUrl: string | null;
  error: string | null;
}

/**
 * Posts the replies the human approved, exactly as saved by the app. Safe to
 * run again after a failure: replies that already posted are skipped.
 */
export async function postApproved(sessionDir: string, github: GitHub): Promise<PostOutcome[]> {
  const files = sessionFiles(sessionDir);
  if (!existsSync(files.results)) throw new Error('This session has no results yet. Wait for the human to finish.');
  const results = readJson<Results>(files.results);
  if (results.status !== 'approved') {
    throw new Error(`The human has not approved this round (status "${results.status}"). Nothing was posted.`);
  }
  const drafts: Drafts = parseDrafts(readJson(files.drafts));
  const state: SessionState | undefined = readSavedState(sessionDir);
  if (!state) throw new Error('The session state is missing or unreadable. Nothing was posted.');

  const queue = [
    ...drafts.items.map((item) => ({ id: item.id, thread: item.kind === 'thread', commentId: item.commentId })),
    { id: SUMMARY_ID, thread: false, commentId: null },
  ];
  const outcomes: PostOutcome[] = [];

  for (const { id, thread, commentId } of queue) {
    const itemState = state.items[id];
    if (!itemState || itemState.action !== 'send') continue;
    if (!itemState.postedUrl) {
      try {
        itemState.postedUrl = thread
          ? await github.replyToThread(drafts.pr, commentId!, itemState.body)
          : await github.createComment(drafts.pr, itemState.body);
        itemState.error = null;
      } catch (error) {
        itemState.error = error instanceof Error ? error.message : String(error);
      }
      writeJson(files.state, state);
    }
    outcomes.push({ id, postedUrl: itemState.postedUrl, error: itemState.error });
  }

  writeJson(files.results, {
    ...results,
    items: results.items.map((item) => ({
      ...item,
      postedUrl: state.items[item.id]?.postedUrl ?? item.postedUrl,
      error: state.items[item.id]?.error ?? null,
    })),
  } satisfies Results);
  return outcomes;
}
