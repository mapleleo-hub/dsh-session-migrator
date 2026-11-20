/**
 * fix-turn-end — rewrite bare `turn/end {reason:{kind:'error'}}` to completed.
 *
 * DSH's projection reads reason.error.code; a bare error reason crashes with
 * "Cannot read properties of undefined (reading 'code')". Our importer always
 * writes `completed`, but legacy imports may still carry bare error reasons.
 */
import fs from 'node:fs';
import path from 'node:path';
import config from '../config.mjs';
import { decodeLines, writeLines } from '../v4.mjs';
import { parseArgs, csv } from '../common.mjs';

const DEFAULT_PREFIXES = ['wb-', 'pi-', 'codex-', 'opencode-', 'zcode-', 'claude-', 'cursor-'];

export function help() {
  return `dsh-session-migrator fix-turn-end [--prefix a,b] [--all] [--apply]

Rewrites <sessionsRoot>/*/<session>/session.v4.jsonl.zstd where a turn/end event
has reason {kind:"error"} but no error.code, to {kind:"completed"}.

By default only imported sessions (prefixes: ${DEFAULT_PREFIXES.join(', ')}) are
touched. Use --all to scan every session directory.

Dry-run by default. --apply rewrites, backing each changed file up to
"<file>.bak-turnfix" first.

Usage:
  dsh-session-migrator fix-turn-end
  dsh-session-migrator fix-turn-end --apply
  dsh-session-migrator fix-turn-end --all --apply`;
}

function listFiles(root, prefixes, all) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const sub = path.join(root, d.name);
    let ents;
    try {
      ents = fs.readdirSync(sub, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      if (!all && !prefixes.some((p) => e.name.startsWith(p))) continue;
      const f = path.join(sub, e.name, 'session.v4.jsonl.zstd');
      if (fs.existsSync(f)) files.push(f);
    }
  }
  return files;
}

export function run(argv) {
  const opts = parseArgs(argv, ['prefix']);
  const apply = Boolean(opts.apply);
  const all = Boolean(opts.all);
  const prefixes = opts.prefix ? csv(opts.prefix) : DEFAULT_PREFIXES;

  let scanned = 0;
  let changedFiles = 0;
  let changedEvents = 0;
  const samples = [];

  for (const file of listFiles(config.sessionsRoot, prefixes, all)) {
    scanned++;
    let lines;
    try {
      lines = decodeLines(file);
    } catch (e) {
      console.error('[decode-fail]', file, e.message);
      continue;
    }
    let touched = 0;
    const outLines = lines.map((line) => {
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        return line;
      }
      if (o.type === 'turn/end' && o.data && o.data.reason && o.data.reason.kind === 'error') {
        const hasErr = o.data.reason.error && typeof o.data.reason.error.code === 'string';
        if (!hasErr) {
          o.data.reason = { kind: 'completed' };
          touched++;
          return JSON.stringify(o);
        }
      }
      return line;
    });

    if (touched > 0) {
      changedFiles++;
      changedEvents += touched;
      if (samples.length < 10) samples.push([path.basename(path.dirname(file)), touched]);
      if (apply) {
        const bak = file + '.bak-turnfix';
        if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
        writeLines(file, outLines);
      }
    }
  }

  console.log(
    JSON.stringify({ scanned, changedFiles, changedEvents, applied: apply, samples }, null, 2)
  );
}
