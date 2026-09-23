import { execFile } from 'node:child_process';
import type { FilePatch } from '../shared/schema';

/** Reads the agent's local, unpushed commits, which GitHub can't show yet. */
export interface LocalGit {
  commitFiles(sha: string): Promise<FilePatch[]>;
}

const SHA = /^[0-9a-f]{4,40}$/i;

export function parseCommitPatch(output: string): FilePatch[] {
  return output
    .split(/^diff --git /m)
    .slice(1)
    .map((section): FilePatch => {
      const newPath = /^\+\+\+ b\/(.+)$/m.exec(section)?.[1];
      const oldPath = /^--- a\/(.+)$/m.exec(section)?.[1];
      const header = /^a\/(.+?) b\/(.+)$/m.exec(section);
      const path = newPath ?? oldPath ?? header?.[2] ?? 'unknown';
      const hunkStart = section.search(/^@@ /m);
      const patch = hunkStart === -1 ? null : section.slice(hunkStart).replace(/\n$/, '');
      const lines = patch?.split('\n') ?? [];
      const status = /^new file/m.test(section) ? 'added' : /^deleted file/m.test(section) ? 'removed' : 'modified';
      return {
        path,
        status,
        additions: lines.filter((line) => line.startsWith('+')).length,
        deletions: lines.filter((line) => line.startsWith('-')).length,
        patch,
      };
    });
}

export class CliGit implements LocalGit {
  constructor(private readonly repoDir: string) {}

  commitFiles(sha: string): Promise<FilePatch[]> {
    if (!SHA.test(sha)) return Promise.reject(new Error(`"${sha}" is not a commit SHA`));
    return new Promise((resolve, reject) => {
      execFile(
        'git',
        ['-C', this.repoDir, 'show', '--format=', '--no-color', '--no-ext-diff', sha],
        { maxBuffer: 32 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) reject(new Error(stderr.trim() || error.message));
          else resolve(parseCommitPatch(stdout));
        },
      );
    });
  }
}
