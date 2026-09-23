# code-review-feedback design

## Goal

Turn the personal `/crfeedback` command into a shareable, agent-agnostic skill, `/code-review-feedback`. The agent still reads the PR's review feedback, decides what to fix, makes the fixes, and drafts a reply for every item. What changes is the approval step: instead of listing drafts in chat and posting what the human approves, the skill opens a local web app that looks like a continuation of the GitHub PR. The human edits, sends, or skips each reply there, and the app posts the approved text itself. The agent never writes to a reviewer.

Success looks like: a large PR's feedback can be worked through in one sitting, keyboard-first, with the diff and thread in view, and nothing reaches GitHub that the human did not see and send.

## Constraints

- Public repo, `srtfisher/code-review-feedback`. No fixtures from real (private) PRs are committed.
- Works with any agent that reads `SKILL.md` skills, not only Claude Code. Installed with `npx skills add srtfisher/code-review-feedback`, which places it in `~/.agents/skills/` and links it into each agent's skills directory.
- Nobody compiles anything on install. The built app is committed inside the skill folder so a copy of the folder is a working install. Runtime requirements: Node 20+ and an authenticated `gh`.
- All GitHub access goes through the `gh` CLI.
- UI mirrors GitHub's look in light and dark, built with Tailwind.

## Out of scope for v1

Steering the fix from the app (reply text only), pending reviews, syntax highlighting, resolving threads, npm publishing (`package.json` stays `private` until wanted), picking up comments that arrive while the app is open (they are flagged on existing threads, not added).

## Layout

```text
skills/code-review-feedback/
  SKILL.md             the workflow the agent follows
  app/cli.mjs          built server + CLI, single file, no runtime deps
  app/web/             built UI (index.html, JS, CSS)
src/
  shared/              drafts/state/results schemas and types
  server/              CLI, HTTP server, GitHub adapter (gh), session store
  web/                 React UI
test/                  vitest unit + integration tests, synthetic fixtures
```

Vite builds `src/web` into `app/web`; esbuild bundles `src/server` into `app/cli.mjs`. CI runs typecheck, tests, build, and fails if the committed build differs from a fresh one.

## CLI

All commands take `--pr <number|url>` or read the PR for the current branch.

- `cli.mjs feedback` prints the PR's unresolved inline threads, top-level comments, and non-empty review bodies as compact JSON, with the ids a drafts file needs. The agent uses this instead of hand-writing GraphQL.
- `cli.mjs open <drafts.json>` validates the drafts, creates a session directory, starts the server detached on `127.0.0.1` with a random port and token, opens the browser, prints `{ url, session }`, and exits.
- `cli.mjs wait <session> [--timeout 540]` blocks until the human finishes or the timeout passes. Exit 0 prints `results.json`; exit 3 means still waiting, call again. Polling keeps it portable across agent harnesses with tool timeouts.
- `--fixture <dir>` on `open` swaps the GitHub adapter for a fake one reading fixture JSON, for development and UI verification.

## Contract

`drafts.json`, written by the agent:

```json
{
  "version": 1,
  "pr": { "owner": "o", "repo": "r", "number": 12 },
  "items": [
    {
      "id": "c-123",
      "kind": "thread | comment | review",
      "commentId": 123,
      "lastSeenCommentId": 130,
      "decision": "implemented | declined | clarify | acknowledged",
      "rationale": "why, for the human",
      "commits": ["abc1234"],
      "draft": "Fixed."
    }
  ],
  "summary": { "draft": "optional top-level comment" }
}
```

`commentId` is the REST id of the thread's first comment (thread), the issue comment (comment), or the review (review). `lastSeenCommentId` is the newest comment the agent read; the app flags "new replies since draft" when the thread has something newer.

The session directory holds `drafts.json`, `state.json` (per item: `action` send/skip, current `body`, `posted` url, `error`), `results.json` (written on finish), and `server.log`. State is saved on every edit, so a reload or restart loses nothing and a retry never re-posts an item that already posted.

`results.json`: `{ status: "done" | "canceled", pr, items: [{ id, action, body, postedUrl, error }] }`.

## Server

`node:http`, no framework. Every API request must carry the session token. Endpoints: session bootstrap (PR, items joined with GitHub data, state), save state, mention search, markdown preview, full-file patch, post selected items, finish (done/cancel, writes results, exits).

The GitHub adapter is the only module that runs `gh`:

- One paginated GraphQL query for PR metadata, review threads (with `diffHunk`, `bodyHTML`, outdated/resolved flags), issue comments, reviews, and participants.
- `pulls/{n}/files` (paginated) for full-file patches.
- `mentionableUsers(query)` for autocomplete beyond the PR's participants.
- `POST /markdown` (gfm, repo context) for previews, so the preview matches GitHub.
- Posting: `pulls/{n}/comments/{id}/replies` for threads; `issues/{n}/comments` for top-level comments, review bodies, and the summary. Bodies go to `gh api --input -` on stdin as JSON, byte for byte.

## UI

GitHub "Files changed" layout with Primer colors as Tailwind v4 theme tokens, following `prefers-color-scheme`, with a manual toggle.

- Header: PR title, number, branches, progress ("4 of 12 decided"), theme toggle.
- Sidebar: items grouped by file, then "Conversation", then the summary. Each shows its state (undecided, send, skip, posted, failed). Filter to undecided. `j`/`k` move, `s` send, `x` skip, `e` focus the editor.
- Item view: file and line, the thread's diff hunk rendered GitHub-style with the commented line highlighted and an "outdated" badge, a toggle for the file's full patch, the thread comments (GitHub-rendered HTML, avatars), the agent's card (decision, rationale, commit links), and the reply editor with Write/Preview tabs and `@` autocomplete (PR participants first, then repo search).
- Submit bar: "Post N, skip M", a confirm step, then per-item status. Failed items show the error and a retry. Done finishes the session; Cancel finishes it without posting anything further.

## Errors

Missing or unauthenticated `gh` fails fast with the message. Invalid drafts fail `open` with the validation errors. Post failures are per item and retryable. Closing the tab leaves the server running; the agent has the URL.

## Testing

Vitest: schema validation, diff hunk parsing, mention ranking, post command construction (body passed untouched), and a server integration test driving the HTTP API against the fake adapter and asserting the posts made and `results.json`. A synthetic "large PR" fixture backs both the tests and `--fixture`, and the UI is checked with agent-browser in both themes.
