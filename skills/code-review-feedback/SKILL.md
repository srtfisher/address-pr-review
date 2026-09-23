---
name: code-review-feedback
description: Work through a pull request's code review feedback. Reads every unresolved review thread and PR comment, makes the fixes you judge right as local commits, and drafts a reply to each. Then opens a local GitHub-style app where the human checks each fix against the comment, edits or approves replies, or sends items back for rework. Once approved, pushes the fixes and posts exactly the approved replies. Use when asked to handle, address, respond to, or work through review feedback or PR comments.
---

# Code review feedback

Work through a pull request's review feedback in rounds with the human. You decide what to fix and make the fixes locally. The human reviews your fixes and drafts in a local app, where they approve replies or send items back to you with a note. When they approve, you push the fixes, then post exactly the replies they approved.

**The replies are the human's.** You draft them, but only text the human approved in the app is posted, and `APP post` posts it from the app's saved state, byte for byte. Never write to a reviewer any other way, never edit approved text, and never resolve threads.

The app lives next to this file. Below, `APP` means `node <this skill's directory>/app/cli.mjs`. Run it from the repository root. It needs Node 20+ and an authenticated `gh`; if either is missing, stop and say so.

## Steps

1. **Gather the feedback.** Run `APP feedback` (add `--pr <number|url>` if the PR isn't the current branch's). It prints JSON with the PR, its unresolved inline `threads`, top-level `comments`, and `reviews` that have a body, each with the `commentId` and `lastSeenCommentId` the drafts file needs. If there is no PR, stop and tell the human. Skip bot output (CI, coverage, deploy previews) unless it asks for something a person would. Make sure the working tree is on the PR's branch and has no unrelated changes; if not, stop and ask.

2. **Evaluate each item with rigor, not performed agreement.** If a `receiving-code-review` skill is available, use it. For each item decide: implement, decline with a clear technical reason, needs clarification, or just acknowledge. A suggestion can be wrong or rest on a misunderstanding; check it against the actual code before acting. Ask the human up front only when you can't make a sound call without them, such as two reviewers asking for opposite things. Otherwise decide and let the app be where they disagree.

3. **Make the fixes locally.** Make the minimal, root-cause change for each item you're implementing, scoped to what the feedback asks for. Run the relevant tests and linters and confirm they pass. Commit each independent fix on its own in the repo's commit style; fixes that touch the same lines can share a commit. **Do not push.**

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
         "commits": ["<full sha>"],
         "draft": "Good catch, fixed."
       }
     ],
     "summary": { "draft": "Optional top-level comment, or omit" }
   }
   ```

   - `kind` is `thread`, `comment`, or `review`, and `commentId` is copied from the feedback JSON. `lastSeenCommentId` lets the app warn when someone replied after you read the thread.
   - `decision` is `implemented`, `declined`, `clarify`, or `acknowledged`. `rationale` is shown to the human, not posted, so be plain and specific.
   - `commits` lists the local commits for that item. The app shows their code diff under the comment so the human can check the fix.
   - Include a `summary` only when the thread replies leave something unsaid. The app always offers the human a general PR comment either way.

5. **Draft the replies the way a human developer talks in a PR.** They post under the human's account. If a `humanizer` skill is available, apply it to every draft.
   - **Short by default.** One or two sentences: "Fixed." / "Good catch, done." / "Yeah, leftover from the refactor. Removed." Longer than three sentences needs a reason.
   - **Friendly, like a teammate.** Casual and warm, not formal or defensive. Contractions are fine.
   - **Skip the technical tour.** They can read the diff. When declining, give the plain reason in a sentence ("this path can't be null, it's validated upstream").
   - **Don't perform.** No "Great point!", no thanking them for the review, no restating their comment, no lists unless there really are several things.
   - **No AI tells.** No em-dash pile-ups, rule-of-three phrasing, hedging preambles, or headers in a two-line reply.
   - Top-level comments and review bodies can't be threaded, so those replies post as new PR comments. Start them with an `@mention` of the person you're answering.
   - Where tone depends on the reviewer or the team's history, say so in the `rationale` rather than guessing. The human has context you don't.

6. **Open the app.** The first time, run `APP open <drafts.json>`. It validates the file, starts a local server, opens the browser, and prints `{ url, session }`. Keep the `session` path; every later round uses it. Tell the human the URL in case the browser didn't open.

7. **Wait for the round to end.** Run `APP wait <session>`. It blocks for up to nine minutes; exit code 3 means the human is still working, so run it again until it exits 0 with the results JSON. Then act on `status`:

   - **`revise`**: items with `action: "ask"` carry the human's `instructions`. For each one, do what they asked: change or revert the code, run the tests, and commit locally (add new commits rather than rewriting ones the human already reviewed), then update that item's `draft`, `rationale`, and `commits` in the drafts file. Don't touch other items; their state is the human's. Reopen with `APP open <drafts.json> --session <session>`, which keeps every approved or skipped reply whose draft you didn't change, and wait again.
   - **`approved`**: push the fixes to the PR's branch. Never force-push. If the push fails or the branch has moved on, stop and tell the human; post nothing. Once the push succeeds, run `APP post <session>`. It posts the replies marked to send, in order, exactly as saved, and prints each one's URL or error. If some failed, run it again; replies that already posted are skipped. If the PR is part of a stack, say that the branches above it need a rebase; don't do it yourself.
   - **`canceled`**: push nothing and post nothing. Leave the local commits in place and say so.

8. **Report back:** what you changed and pushed, which replies were posted (with their links), which were skipped, anything that failed to post, and open questions.

## Notes

- Be honest in drafts and rationale: if a test failed or a fix was skipped, say so.
- Don't edit the session's `state.json` or `results.json`; they hold the human's words.
- For development there is a fixture mode: `APP open <drafts.json> --fixture <dir>` serves saved data, and `APP post <session> --fixture <dir>` posts nothing real.
