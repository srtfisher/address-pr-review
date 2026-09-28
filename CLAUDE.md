# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

`@srtfisher/address-pr-review` is an agent skill (`skills/address-pr-review/SKILL.md`) plus a local web app. The agent drafts replies and commits fixes for a PR's review feedback, then the human approves each reply in the app, and only the approved text is posted. The skill's instructions are part of the product: changes to CLI commands, the drafts format, or round statuses usually need a matching SKILL.md and README update.

## Commands

```sh
npm test                          # vitest, test/**/*.test.ts
npx vitest run test/session.test.ts -t "keeps approved"   # one file / one test
npm run typecheck                 # tsc --noEmit
npm run build                     # UI (vite) + bundled CLI (esbuild) into skills/address-pr-review/app/
npm run dev                       # build, then open the app on the synthetic fixture (posts nothing)
node test/fixtures/generate.ts    # regenerate test/fixtures/large-pr/*.json
```

`skills/address-pr-review/app/` is build output and is committed so installs work without a build. After any change under `src/`, run `npm run build` and commit the result; CI and the release workflow fail if it's stale.

The tests cover the server, session, posting, GitHub, and parsing code only; there are no UI tests. Verify UI changes in the fixture app: `node skills/address-pr-review/app/cli.mjs open test/fixtures/large-pr/drafts.json --fixture test/fixtures/large-pr --no-browser` prints `{ url, session }`. To see a second round, finish with "send back", edit a copy of the drafts file, and reopen with `--session <session>`. The README screenshots (`docs/screenshots/`, 1440×1080) come from this fixture.

## Architecture

Three parts in `src/`, sharing types:

- `src/shared/schema.ts`: zod schemas and types for the drafts file the agent writes, the PR data, per-item state (`action` is `send` | `skip` | `ask` | null), and results. Start here for any data change.
- `src/server/`: the CLI (`cli.ts`) with `feedback`, `open`, `wait`, `post`, and a hidden `serve`. `open` validates the drafts, sets up a session directory in the OS temp dir, and starts `serve` as a detached background process, so `wait` and `post` run as separate invocations that talk to it only through files.
- `src/web/`: React 19 + Tailwind 4 UI, served by the server with a random port and a token (`x-crf-token` header, taken from the `?token=` URL). `App.tsx` owns state, saving, and the global keyboard shortcuts; `components/ItemView.tsx` renders one review item.

The session directory is the contract between rounds and processes: `drafts.json`, `state.json` (the human's choices and edited text, saved as they work), `results.json` (written when a round ends as `approved`, `revise`, or `canceled`), `server.json`, `session.json`. `session.ts` `initialState()` does the reopen merge: an item keeps its saved state unless the human sent it back (`ask`) or the agent changed its draft, and then it starts over with `lastAsk` set to the human's note. Posted replies never reset.

`post.ts` posts from `state.json` exactly as saved, in order, recording each `postedUrl` right away so a rerun skips what already posted. Inline threads get replies in the thread; everything else posts as a new PR comment, plus the synthetic `summary` item.

GitHub access goes through the `GitHub` interface (`github.ts`, which shells out to `gh`), and local unpushed commits through `LocalGit` (`local-git.ts`). `fake-github.ts` implements both from fixture JSON; `--fixture <dir>` swaps them in for `open`, `serve`, and `post`, and the tests use them too.

## Releasing

Rename the `## Unreleased` changelog heading to the new version and commit it (`npm version` refuses a dirty tree), then `npm version <patch|minor|major> -m "Release %s"` and `git push origin main --follow-tags`. The `v*` tag triggers `.github/workflows/release.yml`, which checks the build, publishes to npm with trusted publishing, and creates the GitHub release.
