/**
 * scan — read-only validator over every DSH session file.
 *
 * Prints one line per problem and a final `ok N bad M` tally. Never writes.
 */
import fs from 'node:fs';
import path from 'node:path';
import config from '../config.mjs';
import { normalizeCwdForDir } from '../project-key.mjs';
import { readSession } from '../v4.mjs';
import { parseArgs } from '../common.mjs';

export function help() {
  return `dsh-session-migrator scan [--verbose]

Read-only validation of every session file under the DSH sessions root:
  - decodes each zstd frame stream
  - checks header type/version/id and contiguous seq
  - checks every message carries source.kind
  - checks the directory name equals projectKey(header.cwd)

Prints "ok N bad M". Exit code is 1 when any bad session is found.

Usage:
  dsh-session-migrator scan
  dsh-session-migrator scan --verbose`;
}

function expectedDir(cwd) {
  return `--${normalizeCwdForDir(cwd == null ? '' : String(cwd))}--`;
}

export function run(argv) {
  const opts = parseArgs(argv, []);
  const verbose = Boolean(opts.verbose);

  const root = config.sessionsRoot;
  if (!fs.existsSync(root)) {
    console.error(`sessions root not found: ${root}`);
    process.exitCode = 2;
    return;
  }

  let ok = 0;
  let bad = 0;
  const reasons = {};

  const bump = (reason) => {
    bad++;
    reasons[reason] = (reasons[reason] || 0) + 1;
  };

  for (const dirName of fs.readdirSync(root)) {
    const dirPath = path.join(root, dirName);
    let st;
    try {
      st = fs.statSync(dirPath);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;

    for (const sub of fs.readdirSync(dirPath)) {
      const file = path.join(dirPath, sub, 'session.v4.jsonl.zstd');
      if (!fs.existsSync(file)) {
        if (verbose) console.log('NO LOG', dirName, sub);
        bump('no-log');
        continue;
      }
      try {
        const { header, events } = readSession(file);
        if (!header || header.type !== 'session') throw new Error('header.type != session');
        if (header.version !== 4) throw new Error(`header.version=${header.version}`);
        if (!header.id) throw new Error('header.id missing');

        let seq = 0;
        for (const ev of events) {
          if (ev.seq !== seq++) throw new Error(`seq gap at ${ev.type}`);
          if (ev.type === 'user/message' && !(ev.data && ev.data.source && ev.data.source.kind)) {
            throw new Error('user/message missing source.kind');
          }
          if (
            ev.type === 'assistant/message' &&
            !(ev.data && ev.data.message && ev.data.message.source && ev.data.message.source.kind)
          ) {
            throw new Error('assistant/message missing source.kind');
          }
        }

        if (header.cwd === undefined) throw new Error('header.cwd missing');
        const want = expectedDir(header.cwd);
        if (want !== dirName) throw new Error(`dir mismatch: dir=${dirName} expected=${want}`);

        ok++;
      } catch (e) {
        const msg = String(e.message || e).split('\n')[0];
        if (verbose) console.log(`BAD ${dirName}/${sub}: ${msg}`);
        bump(msg.split(':')[0]);
      }
    }
  }

  console.log(`ok ${ok} bad ${bad}`);
  if (bad > 0) {
    console.log('reasons:');
    for (const [k, v] of Object.entries(reasons)) console.log(`  ${v}  ${k}`);
    process.exitCode = 1;
  }
}
