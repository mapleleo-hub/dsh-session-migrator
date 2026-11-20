/**
 * Recover a session's ORIGINAL working directory from local agent stores.
 *
 * - WorkBuddy / pi: the transcript's first line (or first "cwd" field).
 * - codex / claude / cursor: the first shard file referenced by a dump record.
 * - opencode / zcode: a `directory` column in their SQLite session table.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import config from './config.mjs';

const require = createRequire(import.meta.url);
const dbs = {};

function openDb(p) {
  if (!fs.existsSync(p)) return null;
  if (!dbs[p]) {
    try {
      const { DatabaseSync } = require('node:sqlite');
      dbs[p] = new DatabaseSync(p, { readOnly: true });
    } catch {
      return null;
    }
  }
  return dbs[p];
}

/** Read the first JSON object line from a plain .jsonl file. */
function firstJsonLine(file) {
  const s = fs.readFileSync(file, 'utf8');
  const first = s.split('\n')[0];
  try {
    return JSON.parse(first);
  } catch {
    return null;
  }
}

/**
 * cwdOf(ref) — ref is a .jsonl path or a directory containing one.
 * Used for WorkBuddy / pi transcripts.
 */
export function cwdOf(ref) {
  try {
    let file = ref;
    let st = fs.statSync(ref);
    if (st.isDirectory()) {
      const j = fs.readdirSync(ref).filter((f) => f.endsWith('.jsonl'));
      if (!j.length) return null;
      file = path.join(ref, j[0]);
    }
    const obj = firstJsonLine(file);
    if (obj && obj.cwd) return obj.cwd;
    const s = fs.readFileSync(file, 'utf8');
    const m = s.match(/"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (m) {
      try {
        return JSON.parse('"' + m[1] + '"');
      } catch {
        return m[1];
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Normalise an MSYS/WSL path ("/mnt/c/...") or Unix path into a Windows path. */
export function toWin(p) {
  if (!p) return p;
  let x = p;
  const m = x.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (m) x = m[1].toUpperCase() + ':\\' + m[2];
  x = x.replace(/\//g, '\\').replace(/\\+$/, '');
  if (/^[a-zA-Z]:$/.test(x)) x += '\\';
  return x;
}

/** Walk up until an existing ancestor is found (returns null if none). */
export function existingAncestor(p) {
  let cur = p;
  for (let i = 0; i < 40 && cur; i++) {
    if (fs.existsSync(cur)) return cur;
    const parent = path.dirname(cur);
    if (!parent || parent === cur) break;
    cur = parent;
  }
  return null;
}

function readShardText(shard) {
  let buf = fs.readFileSync(shard);
  if (shard.endsWith('.zst')) {
    try {
      buf = zlib.zstdDecompressSync(buf);
    } catch {
      /* leave raw */
    }
  }
  return buf.toString('utf8');
}

/**
 * cwdForDump(src, record) — recover the original cwd for an agent-source dump
 * record. Returns the raw (possibly non-Windows) path or null.
 */
export function cwdForDump(src, record) {
  try {
    if (src === 'opencode') {
      const db = openDb(config.opencodeDb);
      if (db) {
        const row = db.prepare('select directory from session where id=?').get(record.session);
        if (row && row.directory) return row.directory;
      }
    }
    if (src === 'zcode') {
      const db = openDb(config.zcodeDb);
      if (db) {
        const row = db.prepare('select directory from session where id=?').get(record.session);
        if (row && row.directory) return row.directory;
      }
    }
    const shard = record.messages && record.messages[0] && record.messages[0].shard;
    if (shard && fs.existsSync(shard) && fs.statSync(shard).isFile()) {
      const s = readShardText(shard);
      const first = s.split('\n').find((l) => l.trim());
      try {
        const j = JSON.parse(first);
        const p = j.payload || j;
        if (p && p.cwd) return p.cwd;
      } catch {
        /* fall through to regex */
      }
      const m = s.match(/"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (m) {
        try {
          return JSON.parse('"' + m[1] + '"');
        } catch {
          return m[1];
        }
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}
