---
name: code-review-feedback
description: Work through a pull request's code review feedback. Reads every unresolved review thread and PR comment, makes the fixes you judge right, drafts a reply to each, then opens a local GitHub-style app where the human edits, sends, or skips every reply. The app posts only what the human sends. Use when asked to handle, address, respond to, or work through review feedback or PR comments.
---

# Code review feedback

Review the current pull request's feedback, implement the fixes you judge should be made, and draft a reply to every item. Then hand the drafts to the human in the review app. **You never post to a reviewer.** The fixes are yours to make; the words that go to a named colleague are the human's to write or send, and the app posts them, not you.

The app lives next to this file. Below, `APP` means `node <this skill's directory>/app/cli.mjs`. It needs Node 20+ and an authenticated `gh`; if either is missing, stop and say so.

## Steps

1. **Gather the feedback.** Run `APP feedback` (add `--pr <number|url>` if the PR isn't the current branch's). It prints JSON with the PR, its unresolved inline `threads`, top-level `comments`, and `reviews` that have a body, each with the `commentId` and `lastSeenCommentId` the drafts file needs. If there is no PR, stop and tell the human. Skip bot output (CI, coverage, deploy previews) unless it asks for something a person would.

2. **Evaluate each item with rigor, not performed agreement.** If a `receiving-code-review` skill is available, use it. For each item decide: implement, decline with a clear technical reason, needs clarification, or just acknowledge. A suggestion can be wrong or rest on a misunderstanding; check it against the actual code before acting.

3. **Implement the fixes you decided to make.** Make the minimal, root-cause change for each and keep edits scoped to what the feedback asks for. Run the relevant tests and linters and confirm they pass before calling anything fixed. Don't commit or push unless the human asks, but if your drafts say "fixed", tell the human the fixes aren't pushed yet so they can push before sending.

4. **Write the drafts file** to a temporary path, one item per piece of feedback you're answering:

   ```json
   {
     "version": 1,
     "pr": { "owner": "o", "repo": "r", "number": 12 },
     "items": [
       {
         "id": "thread-123",
         "kind": "thread",
         "commentId": 123,
         "lastSeenCommentId": 130,
         "decision": "implemented",
         "rationale": "For the human: what you checked and why you decided this.",
         "commits": ["abc1234"],
         "draft": "Good catch, fixed."
       }
     ],
     "summary": { "draft": "Optional top-level comment, or omit" }
   }
   ```

   - `kind` is `thread`, `comment`, or `review`, and `commentId` is copied from the feedback JSON. `lastSeenCommentId` lets the app warn when someone replied after you read the thread.
   - `decision` is `implemented`, `declined`, `clarify`, or `acknowledged`. `rationale` is shown to the human, not posted, so be plain and specific. `commits` is optional.
   - Include a `summary` only when the thread replies leave something unsaid.

5. **Draft the replies the way a human developer talks in a PR.** They post under the human's account. If a `humanizer` skill is available, apply it to every draft.
   - **Short by default.** One or two sentences: "Fixed." / "Good catch, done." / "Yeah, leftover from the refactor. Removed." Longer than three sentences needs a reason.
   - **Friendly, like a teammate.** Casual and warm, not formal or defensive. Contractions are fine.
   - **Skip the technical tour.** They can read the diff. When declining, give the plain reason in a sentence ("this path can't be null, it's validated upstream").
   - **Don't perform.** No "Great point!", no thanking them for the review, no restating their comment, no lists unless there really are several things.
   - **No AI tells.** No em-dash pile-ups, rule-of-three phrasing, hedging preambles, or headers in a two-line reply.
   - Top-level comments and review bodies can't be threaded, so those replies post as new PR comments. Start them with an `@mention` of the person you're answering.
   - Where tone depends on the reviewer or the team's history, say so in the `rationale` rather than guessing. The human has context you don't.

6. **Open the app.** Run `APP open <drafts.json>`. It validates the file, starts a local server, opens the browser, and prints `{ url, session }`. If validation fails, fix the file and run it again. Tell the human the URL in case the browser didn't open, and that you'll wait.

7. **Wait for the human.** Run `APP wait <session>`. It blocks for up to nine minutes. Exit code 3 means they're still working, so run it again; keep going until it exits 0 with the results JSON. Don't do anything else with the PR meanwhile.

8. **Report back** from the results: what you changed, which replies were posted (with their links), which were skipped, anything that failed to post, and open questions. If the status is `canceled`, say that nothing more was posted. Never post, re-post, or edit a reply yourself, and don't resolve threads; resolving is a reply too.

## Notes

- Be honest in drafts and rationale: if a test failed or a fix was skipped, say so.
- The human can edit any draft fully in the app. What they send is posted byte for byte; don't second-guess it afterward.
- For development there is a fixture mode: `APP open <drafts.json> --fixture <dir>` serves saved data and posts nothing.
