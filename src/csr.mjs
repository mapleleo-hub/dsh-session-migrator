/**
 * Thin wrappers around the external chat-share-reader CLI.
 *
 * All calls invoke `node <CSR_SCRIPT> ...` via execFileSync. Outputs may be
 * preceded by warning lines, so JSON is extracted by locating the first '['/ '{' through the last matching bracket.
 */
import { execFileSync } from 'node:child_process';
import { requireCsr } from './config.mjs';

const MAX_BUFFER = 512 * 1024 * 1024;

function run(args) {
  const script = requireCsr();
  return execFileSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  });
}

function extractArray(out) {
  const start = out.indexOf('[');
  const end = out.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('chat-share-reader returned no JSON array');
  return JSON.parse(out.slice(start, end + 1));
}

function extractObject(out) {
  const start = out.indexOf('{');
  const end = out.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('chat-share-reader returned no JSON object');
  return JSON.parse(out.slice(start, end + 1));
}

/** list --json → array of {source,id,ts,time,title,ref}. */
export function listSource(src, { limit = 1000000 } = {}) {
  return extractArray(run(['list', '--source', src, '--limit', String(limit), '--json']));
}

/** export <id> --json --redact off → one conversation object. */
export function exportSession(id, src) {
  return extractObject(run(['export', id, '--source', src, '--json', '--redact', 'off']));
}

/**
 * dump --source <src> --json → array of one-record-per-session objects.
 * `dump --json` emits one session per line (JSONL); tolerate a JSON array too.
 */
export function dumpSource(src) {
  const out = run(['dump', '--source', src, '--json']);
  const trimmed = out.trim();
  if (trimmed.startsWith('[')) return extractArray(out);
  const records = [];
  for (const line of trimmed.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('[')) {
      records.push(...JSON.parse(t));
      continue;
    }
    if (!t.startsWith('{')) continue;
    try {
      records.push(JSON.parse(t));
    } catch {
      /* skip non-record line */
    }
  }
  return records;
}
