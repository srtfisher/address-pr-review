import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { Drafts, PullRequest, Results } from '../shared/schema';
import { FakeGit, FakeGitHub, loadFixture } from './fake-github';
import { GhGitHub, type GitHub } from './github';
import { CliGit } from './local-git';
import { postApproved } from './post';
import { startServer } from './server';
import { ensureDir, parseDrafts, readJson, sessionFiles, writeJson, type ServerInfo, type SessionMeta } from './session';

const USAGE = `Usage: cli.mjs <command> [options]

Commands:
  feedback [--pr <number|url>]         Print the PR's open review feedback as JSON
  open <drafts.json> [--session <dir>] [--fixture <dir>] [--no-browser]
                                       Start the review app and print { url, session }.
                                       --session reopens an earlier session, keeping the human's choices
  wait <session> [--timeout <seconds>] Wait for the human to finish a round; exit 3 if still waiting
  post <session>                       Post the replies the human approved, after the fixes are pushed
`;

const EXIT_WAITING = 3;
const here = dirname(fileURLToPath(import.meta.url));

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function githubFor(fixture: string | undefined): GitHub {
  return fixture ? new FakeGitHub(loadFixture(resolve(fixture))) : new GhGitHub();
}

function feedbackSummary(pr: PullRequest) {
  const person = (user: { login: string } | null) => user?.login ?? 'ghost';
  return {
    pr: { owner: pr.owner, repo: pr.repo, number: pr.number, title: pr.title, url: pr.url, author: person(pr.author) },
    threads: pr.threads
      .filter((thread) => !thread.isResolved)
      .map((thread) => ({
        kind: 'thread',
        commentId: thread.comments[0]?.id,
        lastSeenCommentId: Math.max(...thread.comments.map((comment) => comment.id)),
        path: thread.path,
        line: thread.line ?? thread.originalLine,
        isOutdated: thread.isOutdated,
        comments: thread.comments.map((comment) => ({ id: comment.id, author: person(comment.author), body: comment.body, url: comment.url })),
      })),
    comments: pr.comments.map((comment) => ({
      kind: 'comment',
      commentId: comment.id,
      author: person(comment.author),
      body: comment.body,
      url: comment.url,
    })),
    reviews: pr.reviews
      .filter((review) => review.body.trim() !== '')
      .map((review) => ({
        kind: 'review',
        commentId: review.id,
        author: person(review.author),
        state: review.state,
        body: review.body,
        url: review.url,
      })),
  };
}

function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

async function waitForFile(path: string, timeoutMs: number, alive: () => boolean): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return true;
    if (!alive()) return false;
    await new Promise((done) => setTimeout(done, 250));
  }
  return existsSync(path);
}

const isRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const logTail = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').slice(-20).join('\n') : '');

async function commandFeedback(values: { pr?: string; fixture?: string }): Promise<void> {
  const github = githubFor(values.fixture);
  await github.checkAuth();
  const ref = await github.resolvePr(values.pr);
  const pr = await github.loadPullRequest(ref);
  process.stdout.write(`${JSON.stringify(feedbackSummary(pr), null, 2)}\n`);
}

async function commandOpen(
  draftsPath: string | undefined,
  values: { fixture?: string; session?: string; 'no-browser'?: boolean },
): Promise<void> {
  if (!draftsPath) fail(USAGE);
  const drafts = parseDrafts(readJson(resolve(draftsPath)));
  const github = githubFor(values.fixture);
  await github.checkAuth();

  const { owner, repo, number } = drafts.pr;
  const session = values.session
    ? resolve(values.session)
    : join(tmpdir(), 'code-review-feedback', `${owner}-${repo}-${number}-${randomBytes(4).toString('hex')}`);
  const files = sessionFiles(session);
  if (values.session) {
    if (!existsSync(files.drafts)) fail(`${session} is not a review session.`);
    const previous = parseDrafts(readJson(files.drafts)).pr;
    if (previous.owner !== owner || previous.repo !== repo || previous.number !== number) {
      fail(`${session} belongs to ${previous.owner}/${previous.repo}#${previous.number}, not this pull request.`);
    }
    if (existsSync(files.server)) {
      const { pid } = readJson<ServerInfo>(files.server);
      if (isRunning(pid)) process.kill(pid);
    }
    rmSync(files.server, { force: true });
    rmSync(files.results, { force: true });
  } else {
    ensureDir(session);
    writeJson(files.meta, { repoDir: process.cwd() } satisfies SessionMeta);
  }
  writeJson(files.drafts, drafts);

  const log = openSync(files.log, 'a');
  const args = [fileURLToPath(import.meta.url), 'serve', session];
  if (values.fixture) args.push('--fixture', resolve(values.fixture));
  const child = spawn(process.execPath, args, { detached: true, stdio: ['ignore', log, log] });
  child.unref();

  const started = await waitForFile(files.server, 30_000, () => child.exitCode === null);
  if (!started) fail(`The review app did not start.\n${logTail(files.log)}`);

  const { url } = readJson<ServerInfo>(files.server);
  if (!values['no-browser']) openBrowser(url);
  process.stdout.write(`${JSON.stringify({ url, session }, null, 2)}\n`);
}

async function commandServe(session: string | undefined, values: { fixture?: string }): Promise<void> {
  if (!session) fail(USAGE);
  const files = sessionFiles(session);
  const drafts: Drafts = parseDrafts(readJson(files.drafts));
  const git = values.fixture
    ? new FakeGit(loadFixture(resolve(values.fixture)))
    : new CliGit(existsSync(files.meta) ? readJson<SessionMeta>(files.meta).repoDir : process.cwd());
  const running = await startServer({
    sessionDir: session,
    drafts,
    git,
    github: githubFor(values.fixture),
    webDir: join(here, 'web'),
    fixture: Boolean(values.fixture),
    onFinish: () => {
      void running.close().then(() => process.exit(0));
    },
  });
  writeJson(files.server, { url: running.url, pid: process.pid } satisfies ServerInfo);
  process.stdout.write(`listening at ${running.url}\n`);
}

async function commandWait(session: string | undefined, values: { timeout?: string }): Promise<void> {
  if (!session) fail(USAGE);
  const files = sessionFiles(resolve(session));
  const timeoutSeconds = Number(values.timeout ?? 540);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) fail('--timeout must be a positive number of seconds');
  if (!existsSync(files.server)) fail(`No review app was started for ${session}.`);
  const { pid, url } = readJson<ServerInfo>(files.server);

  const finished = await waitForFile(files.results, timeoutSeconds * 1000, () => isRunning(pid));
  if (finished) {
    process.stdout.write(`${JSON.stringify(readJson<Results>(files.results), null, 2)}\n`);
    return;
  }
  if (!isRunning(pid)) fail(`The review app stopped without finishing.\n${logTail(files.log)}`);
  process.stdout.write(`Still waiting on the human at ${url}\n`);
  process.exit(EXIT_WAITING);
}

async function commandPost(session: string | undefined, values: { fixture?: string }): Promise<void> {
  if (!session) fail(USAGE);
  const outcomes = await postApproved(resolve(session), githubFor(values.fixture));
  process.stdout.write(`${JSON.stringify(outcomes, null, 2)}\n`);
  if (outcomes.some((outcome) => outcome.error)) process.exit(1);
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      pr: { type: 'string' },
      fixture: { type: 'string' },
      session: { type: 'string' },
      timeout: { type: 'string' },
      'no-browser': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, target] = positionals;
  if (values.help || !command) {
    process.stdout.write(USAGE);
    return;
  }
  switch (command) {
    case 'feedback':
      return commandFeedback(values);
    case 'open':
      return commandOpen(target, values);
    case 'serve':
      return commandServe(target, values);
    case 'wait':
      return commandWait(target, values);
    case 'post':
      return commandPost(target, values);
    default:
      fail(USAGE);
  }
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
