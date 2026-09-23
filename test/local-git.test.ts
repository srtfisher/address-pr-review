import { describe, expect, it } from 'vitest';
import { parseCommitPatch } from '../src/server/local-git';

describe('parseCommitPatch', () => {
  it('splits git show output into file patches', () => {
    const output = [
      'diff --git a/app/Rule.php b/app/Rule.php',
      'index 1111111..2222222 100644',
      '--- a/app/Rule.php',
      '+++ b/app/Rule.php',
      '@@ -1,2 +1,2 @@',
      ' keep',
      "-$fail('old');",
      "+$fail('new');",
      'diff --git a/tests/NewTest.php b/tests/NewTest.php',
      'new file mode 100644',
      'index 0000000..3333333',
      '--- /dev/null',
      '+++ b/tests/NewTest.php',
      '@@ -0,0 +1 @@',
      '+<?php',
      '',
    ].join('\n');
    expect(parseCommitPatch(output)).toEqual([
      { path: 'app/Rule.php', status: 'modified', additions: 1, deletions: 1, patch: "@@ -1,2 +1,2 @@\n keep\n-$fail('old');\n+$fail('new');" },
      { path: 'tests/NewTest.php', status: 'added', additions: 1, deletions: 0, patch: '@@ -0,0 +1 @@\n+<?php' },
    ]);
  });
});
