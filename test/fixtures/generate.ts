// Builds the synthetic "large PR" fixture. Run with: node test/fixtures/generate.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Drafts, FilePatch, PullRequest, Thread, User } from '../../src/shared/schema.ts';

const out = join(dirname(fileURLToPath(import.meta.url)), 'large-pr');
const owner = 'acme';
const repo = 'storefront';
const number = 482;
const prUrl = `https://github.com/${owner}/${repo}/pull/${number}`;

const avatar = (seed: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="hsl(${
      [...seed].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 360
    } 55% 55%)"/><text x="20" y="26" font-size="18" text-anchor="middle" fill="white" font-family="sans-serif">${seed[0]!.toUpperCase()}</text></svg>`,
  )}`;
const user = (login: string, name: string): User => ({ login, name, avatarUrl: avatar(login) });

const me = user('maya-dev', 'Maya Chen');
const reviewers = [user('jordan-k', 'Jordan Kim'), user('priya-s', 'Priya Shah'), user('sam-oyelaran', 'Sam Oyelaran')];
const others = [user('alex-rivera', 'Alex Rivera'), user('jamie-l', 'Jamie Lee'), user('taylor-b', 'Taylor Brooks')];

const sourceFile = (index: number, lines: number): string[] =>
  Array.from({ length: lines }, (_, i) => {
    const n = i + 1;
    if (n === 1) return `import { formatPrice } from '../lib/money';`;
    if (n % 9 === 0) return '';
    if (n % 7 === 0) return `  // step ${n}: keep totals in cents until the very end`;
    if (n % 5 === 0) return `  const subtotal${n} = items.reduce((sum, item) => sum + item.price * item.qty, 0);`;
    if (n % 3 === 0) return `  if (!cart${index}.items.length) return null;`;
    return `  const value${n} = computeLine(${index}, ${n});`;
  });

interface FileSpec {
  path: string;
  lines: number;
  status: string;
}

const specs: FileSpec[] = [
  { path: 'src/checkout/cart-summary.tsx', lines: 120, status: 'modified' },
  { path: 'src/checkout/use-cart.ts', lines: 90, status: 'modified' },
  { path: 'src/checkout/shipping-options.tsx', lines: 140, status: 'added' },
  { path: 'src/lib/money.ts', lines: 60, status: 'modified' },
  { path: 'src/lib/tax/rates.ts', lines: 80, status: 'added' },
  { path: 'src/api/orders/create.ts', lines: 110, status: 'modified' },
  { path: 'src/api/orders/validate.ts', lines: 70, status: 'added' },
  { path: 'src/components/price-tag.tsx', lines: 45, status: 'modified' },
  { path: 'tests/checkout/cart-summary.test.tsx', lines: 100, status: 'added' },
  { path: 'docs/checkout.md', lines: 40, status: 'modified' },
];

// Every file is one hunk that adds lines 1..N, which keeps thread hunks easy to cut.
const files: FilePatch[] = specs.map((spec, index) => {
  const body = sourceFile(index, spec.lines);
  const kept = spec.status === 'added' ? [] : ['  const legacyTotal = sumAll(items);', '  return legacyTotal;'];
  const patch = [`@@ -1,${kept.length} +1,${body.length} @@`, ...kept.map((l) => `-${l}`), ...body.map((l) => `+${l}`)].join('\n');
  return { path: spec.path, status: spec.status, additions: body.length, deletions: kept.length, patch };
});

const hunkUpTo = (file: FilePatch, line: number): string => {
  const rows = file.patch!.split('\n');
  const header = rows[0]!;
  const deletions = rows.filter((row) => row.startsWith('-'));
  const additions = rows.filter((row) => row.startsWith('+')).slice(0, line);
  return [header, ...deletions, ...additions].join('\n');
};

let nextId = 7000100;
const at = (minutes: number) => new Date(Date.UTC(2026, 8, 21, 14, 0) + minutes * 60_000).toISOString();

const html = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\n/g, '<br>')}</p>`)
    .join('');

const comment = (author: User, body: string, minutes: number, anchor: string) => {
  const id = nextId++;
  return { id, author, body, bodyHTML: html(body), createdAt: at(minutes), url: `${prUrl}#${anchor}${id}` };
};

const threadSeeds: Array<[number, number, string, number, string]> = [
  [0, 12, 'Should this stay in cents here? `formatPrice` expects a number of cents, not dollars.', 0, 'implemented'],
  [0, 35, 'Nit: `subtotal35` is unused now.', 1, 'implemented'],
  [0, 64, 'This recomputes the subtotal on every render. Can we memo it?', 2, 'declined'],
  [0, 98, "What happens when the cart is empty and a coupon is applied? I don't see a guard.", 0, 'clarify'],
  [1, 7, 'Can we keep the hook name matching the file? `useCart` vs `useCartState`.', 1, 'implemented'],
  [1, 45, 'This effect has no cleanup, so the subscription leaks when the drawer closes.', 2, 'implemented'],
  [1, 81, 'Why is this `any`?', 0, 'implemented'],
  [2, 20, 'Could we sort shipping options by price by default?', 1, 'declined'],
  [2, 60, 'The label should come from the carrier, not be hardcoded.', 2, 'implemented'],
  [2, 110, 'Missing an aria-label on the radio group.', 0, 'implemented'],
  [2, 133, 'I think this can be a plain function instead of a component.', 1, 'acknowledged'],
  [3, 15, 'Rounding: this will be off by a cent for 0.5 values. Use banker’s rounding?', 2, 'declined'],
  [3, 40, 'Please add a test for negative amounts.', 0, 'implemented'],
  [4, 10, 'Where do these rates come from? A link in a comment would help.', 1, 'clarify'],
  [4, 55, 'Typo in the region code: `CA-QB` should be `CA-QC`.', 2, 'implemented'],
  [5, 22, 'We should validate before creating the order, not after.', 0, 'implemented'],
  [5, 77, 'This swallows the error. Log it at least?', 1, 'implemented'],
  [6, 30, 'Can the schema live next to the route?', 2, 'declined'],
  [7, 18, 'Screen readers will read "$" and the number separately here.', 0, 'implemented'],
  [8, 40, 'This test depends on the system timezone.', 1, 'implemented'],
  [8, 88, 'Can we add a case for multiple currencies?', 2, 'declined'],
  [9, 12, 'The doc still mentions the old endpoint.', 0, 'implemented'],
];

const draftsFor: Record<string, string> = {
  implemented: 'Good catch, fixed.',
  declined: "I'd rather leave this one as is for now.",
  clarify: 'Can you say a bit more about the case you have in mind?',
  acknowledged: 'Fair, will keep that in mind.',
};

const threads: Thread[] = [];
const draftItems: Drafts['items'] = [];

threadSeeds.forEach(([fileIndex, line, text, reviewerIndex, decision], index) => {
  const file = files[fileIndex]!;
  const reviewer = reviewers[reviewerIndex]!;
  const first = comment(reviewer, text, index * 3, 'discussion_r');
  const conversation = [first];
  if (index % 5 === 1) conversation.push(comment(me, 'Hmm, let me look.', index * 3 + 1, 'discussion_r'));
  const lastSeen = conversation.at(-1)!.id;
  if (index === 3) conversation.push(comment(reviewer, 'Also, the same thing happens on the mini cart.', index * 3 + 2, 'discussion_r'));
  const outdated = index === 6;
  const multiline = index === 9;
  threads.push({
    id: `PRRT_fixture${index}`,
    path: file.path,
    line: outdated ? null : line,
    startLine: multiline ? line - 3 : null,
    originalLine: line,
    isOutdated: outdated,
    isResolved: false,
    diffHunk: hunkUpTo(file, line),
    comments: conversation,
  });
  draftItems.push({
    id: `thread-${first.id}`,
    kind: 'thread',
    commentId: first.id,
    lastSeenCommentId: lastSeen,
    decision: decision as Drafts['items'][number]['decision'],
    rationale:
      decision === 'implemented'
        ? `Checked ${file.path}:${line} and the reviewer is right. Changed it and ran the checkout tests.`
        : decision === 'declined'
          ? 'Verified against the code: the suggestion would change behavior other callers depend on.'
          : decision === 'clarify'
            ? 'Could not tell which case they mean from the comment alone.'
            : 'A reasonable style note that does not need a change here.',
    commits: decision === 'implemented' ? [`${(0xa1b2c3d + index).toString(16)}`] : [],
    draft: draftsFor[decision]!,
  });
});

const resolved = comment(reviewers[0]!, 'Old nit, already handled.', 200, 'discussion_r');
threads.push({
  id: 'PRRT_fixture_resolved',
  path: files[0]!.path,
  line: 5,
  startLine: null,
  originalLine: 5,
  isOutdated: false,
  isResolved: true,
  diffHunk: hunkUpTo(files[0]!, 5),
  comments: [resolved],
});

const issueComments = [
  comment(reviewers[1]!, 'Overall this looks good. Could you split the tax rates into their own PR next time? It was a lot to review at once.', 300, 'issuecomment-'),
  comment(reviewers[2]!, 'Did you test this on Safari? The shipping radios looked off for me.', 310, 'issuecomment-'),
];
const reviewId = nextId++;
const reviews = [
  {
    id: reviewId,
    author: reviewers[0]!,
    state: 'CHANGES_REQUESTED',
    body: 'A few things on money handling, mostly the rounding and cents vs dollars. Happy to pair on it.',
    bodyHTML: html('A few things on money handling, mostly the rounding and cents vs dollars. Happy to pair on it.'),
    submittedAt: at(90),
    url: `${prUrl}#pullrequestreview-${reviewId}`,
  },
];

draftItems.push(
  {
    id: `comment-${issueComments[0]!.id}`,
    kind: 'comment',
    commentId: issueComments[0]!.id,
    lastSeenCommentId: issueComments[1]!.id,
    decision: 'acknowledged',
    rationale: 'Process feedback, nothing to change in this PR.',
    commits: [],
    draft: '@priya-s yeah, fair. I will split things like that up next time.',
  },
  {
    id: `comment-${issueComments[1]!.id}`,
    kind: 'comment',
    commentId: issueComments[1]!.id,
    lastSeenCommentId: issueComments[1]!.id,
    decision: 'implemented',
    rationale: 'Reproduced in Safari: the radio inputs had no explicit size. Fixed in the shipping options styles.',
    commits: ['b7e91f0'],
    draft: '@sam-oyelaran good call, Safari was sizing the radios differently. Fixed.',
  },
  {
    id: `review-${reviewId}`,
    kind: 'review',
    commentId: reviewId,
    decision: 'implemented',
    rationale: 'Covered by the inline threads on money.ts and cart-summary.tsx.',
    commits: [],
    draft: '@jordan-k thanks, the cents fix is in. I left the rounding as is, reasoning is in the thread.',
  },
);

const pr: PullRequest = {
  owner,
  repo,
  number,
  title: 'Rework checkout totals and add shipping options',
  url: prUrl,
  headRefName: 'checkout-totals',
  baseRefName: 'main',
  author: me,
  threads,
  comments: issueComments,
  reviews,
  participants: [me, ...reviewers],
};

const drafts: Drafts = {
  version: 1,
  pr: { owner, repo, number },
  items: draftItems,
  summary: { draft: 'Thanks all. Most of this is fixed; I pushed back on the rounding and the schema location, details in the threads.' },
};

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'fixture.json'), `${JSON.stringify({ pr, files, users: [...reviewers, ...others, me], failOnce: [threads[2]!.comments[0]!.id] }, null, 2)}\n`);
writeFileSync(join(out, 'drafts.json'), `${JSON.stringify(drafts, null, 2)}\n`);
console.log(`wrote ${threads.length} threads, ${files.length} files to ${out}`);
