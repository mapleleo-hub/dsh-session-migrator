/**
 * workspace.json helpers.
 *
 * DSH lists a workspace's sessions from tables.workspaces[id].sessionIds
 * (array order = sidebar order). Writing to this file must be atomic and must
 * leave a timestamped backup first.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import config from './config.mjs';

/** Read and parse workspace.json. */
export function loadDoc(file = config.workspaceJson) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Back up workspace.json to workspace.json.bak-<tag>-<iso> then write the new
 * document atomically (temp file + rename, preserving the trailing newline).
 * Returns the backup path.
 */
export function saveDoc(doc, file = config.workspaceJson, tag = '') {
  const backup = `${file}.bak-${tag ? tag + '-' : ''}${stamp()}`;
  fs.copyFileSync(file, backup);
  const raw = fs.readFileSync(file, 'utf8');
  const nl = raw.endsWith('\n') ? '\n' : '';
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + nl, 'utf8');
  fs.renameSync(tmp, file);
  return backup;
}

function ensureGlobals(doc) {
  if (!doc.global) doc.global = {};
  if (!Array.isArray(doc.global.workspaceIds)) doc.global.workspaceIds = [];
  return doc;
}

/** Find a workspace id whose path matches `wsPath` (case-insensitive). */
export function findWorkspaceByPath(doc, wsPath) {
  const table = doc.tables.workspaces;
  const lower = String(wsPath).toLowerCase();
  for (const id of Object.keys(table)) {
    if (String(table[id].path || '').toLowerCase() === lower) return id;
  }
  return undefined;
}

/**
 * Merge `ids` into the workspace at `wsPath`, creating the workspace if it does
 * not exist. Duplicate ids are skipped. New-workspace ids are unshifted onto
 * doc.global.workspaceIds. Returns the workspace id.
 */
export function mergeIntoWorkspace(doc, { path: wsPath, title, ids, prepend = false }) {
  ensureGlobals(doc);
  const table = doc.tables.workspaces;
  const now = new Date().toISOString();
  let id = findWorkspaceByPath(doc, wsPath);

  if (id) {
    const rec = table[id];
    const existing = Array.isArray(rec.sessionIds) ? rec.sessionIds : [];
    const add = ids.filter((x) => !existing.includes(x));
    const merged = prepend ? [...add, ...existing] : [...existing, ...add];
    table[id] = { ...rec, path: rec.path || wsPath, sessionIds: merged, updatedAt: now };
  } else {
    id = randomUUID();
    table[id] = {
      path: wsPath,
      title: title || path.basename(String(wsPath).replace(/[\\/]+$/, '')) || wsPath,
      sessionIds: [...ids],
      createdAt: now,
      updatedAt: now,
    };
    doc.global.workspaceIds.unshift(id);
  }
  return id;
}

/** Remove every id matching `predicate(id)` from all workspaces. */
export function stripIdsFromAll(doc, predicate) {
  const table = doc.tables.workspaces;
  let removed = 0;
  for (const id of Object.keys(table)) {
    const rec = table[id];
    const before = Array.isArray(rec.sessionIds) ? rec.sessionIds.length : 0;
    const kept = (rec.sessionIds || []).filter((x) => !predicate(x));
    if (kept.length !== before) {
      removed += before - kept.length;
      rec.sessionIds = kept;
    }
    if (Array.isArray(rec.archivedSessionIds)) {
      rec.archivedSessionIds = rec.archivedSessionIds.filter((x) => !predicate(x));
    }
  }
  return removed;
}

/** Delete a workspace record and drop it from global.workspaceIds. */
export function removeWorkspace(doc, id) {
  const table = doc.tables.workspaces;
  if (!table[id]) return false;
  delete table[id];
  if (doc.global && Array.isArray(doc.global.workspaceIds)) {
    doc.global.workspaceIds = doc.global.workspaceIds.filter((x) => x !== id);
  }
  return true;
}
