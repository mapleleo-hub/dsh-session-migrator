import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/cli.mjs', import.meta.url));

test('cli --help lists core commands', () => {
  const out = execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.match(out, /dsh-session-migrator/);
  for (const cmd of ['import', 'regroup', 'fix-turn-end', 'fix-project-key', 'mount', 'remove-subagents', 'scan', 'doctor']) {
    assert.match(out, new RegExp(cmd));
  }
});

test('cli --version prints a semver', () => {
  const out = execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim();
  assert.match(out, /\d+\.\d+\.\d+/);
});
