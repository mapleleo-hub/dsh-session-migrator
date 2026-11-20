/**
 * fix-project-key — rename session project directories that were written with a
 * raw path instead of the canonical projectKey (~XXXX escaping).
 *
 * A wrong directory name makes @deepseek-ai/dsh-workspace throw
 * "corrupt session log ... header id ... and cwd identify ..." at activation.
 */
import fs from 'node:fs';
import path from 'node:path';
import config from '../config.mjs';
import { projectKey } from '../project-key.mjs';
import { readSession } from '../v4.mjs';
import { parseArgs } from '../common.mjs';

export function help() {
  return `dsh-session-migrator fix-project-key [--apply]

Scans <sessionsRoot> and reports project directories whose name is not the
canonical projectKey(header.cwd). --apply renames them (merging into an existing
target directory when present, refusing per-session collisions).

Dry-run by default.

Usage:
  dsh-session-migrator fix-project-key
  dsh-session-migrator fix-project-key --apply`;
}

export function run(argv) {
  const opts = parseArgs(argv, []);
  const apply = Boolean(opts.apply);
  const root = config.sessionsRoot;

  if (!fs.existsSync(root)) {
    console.error(`sessions root not found: ${root}`);
    process.exitCode = 2;
    return;
  }

  const renames = [];
  const problems = [];

  for (const dir of fs.readdirSync(root)) {
    const dirPath = path.join(root, dir);
    let st;
    try {
      st = fs.statSync(dirPath);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;

    const cwds = new Set();
    const ids = [];
    for (const sub of fs.readdirSync(dirPath)) {
      const logFile = path.join(dirPath, sub, 'session.v4.jsonl.zstd');
      if (!fs.existsSync(logFile)) {
        problems.push(`no session log: ${dirPath}/${sub}`);
        continue;
      }
      try {
        const { header } = readSession(logFile);
        if (header.cwd !== undefined) cwds.add(header.cwd);
        ids.push(header.id);
      } catch (e) {
        problems.push(`unreadable header: ${logFile}: ${e.message}`);
      }
    }

    if (cwds.size === 0) continue;
    if (cwds.size > 1) {
      problems.push(`mixed cwd under ${dir}: ${[...cwds].join(' | ')}`);
      continue;
    }
    const cwd = [...cwds][0];
    if (cwd === undefined || cwd === '') {
      problems.push(`empty cwd under ${dir}`);
      continue;
    }
    const expected = projectKey(cwd);
    if (expected !== dir) renames.push({ from: dir, to: expected, cwd, count: ids.length });
  }

  if (problems.length) {
    console.log('--- unrelated problems');
    for (const p of problems) console.log('   ', p);
  }
  if (renames.length === 0) {
    console.log('all project directories already use the canonical key');
    return;
  }

  console.log(`--- ${renames.length} project director${renames.length === 1 ? 'y' : 'ies'} to rename`);
  for (const r of renames) {
    console.log(`    ${r.from}\n -> ${r.to}\n    (${r.count} session(s), cwd ${r.cwd})`);
  }

  if (!apply) {
    console.log('\ndry run; add --apply to rename');
    return;
  }

  for (const r of renames) {
    const from = path.join(root, r.from);
    const to = path.join(root, r.to);
    if (!fs.existsSync(to)) {
      fs.renameSync(from, to);
      console.log(`[renamed] ${r.from} -> ${r.to}`);
      continue;
    }
    for (const sub of fs.readdirSync(from)) {
      const target = path.join(to, sub);
      if (fs.existsSync(target)) throw new Error(`refusing to overwrite ${target}`);
      fs.renameSync(path.join(from, sub), target);
    }
    fs.rmdirSync(from);
    console.log(`[merged] ${r.from} -> ${r.to}`);
  }
}
