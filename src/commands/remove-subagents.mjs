/**
 * remove-subagents — delete imported WorkBuddy *subagent* conversations.
 *
 * WorkBuddy stores delegated sub-agent transcripts under
 *   <workbuddyProjects>/<proj>/<sessionId>/subagents/agent-<uuid>.jsonl
 * These were imported as wb-<uuid> sessions; users usually want only the
 * top-level sessions they personally spoke in.
 *
 * Deletes: DSH session dirs, projection cache rows, and every workspace
 * reference (sessionIds + archivedSessionIds).
 */
import fs from 'node:fs';
import path from 'node:path';
import config from '../config.mjs';
import { loadDoc, saveDoc } from '../workspace.mjs';
import { parseArgs, warnForceRestart } from '../common.mjs';

export function help() {
  return `dsh-session-migrator remove-subagents [--apply] [--purge]

Deletes imported WorkBuddy sub-agent sessions (wb-<uuid>) from DSH:
  - session dirs under <sessionsRoot>/*/wb-<uuid>/
  - projection cache files under the proj-cache dir
  - their ids in every workspace sessionIds / archivedSessionIds

Dry-run by default; --apply acts and backs workspace.json up first.
By default removed session dirs / cache rows are MOVED to
  <DSH_HOME>/.session-migrator-trash/<timestamp>/
so the operation is recoverable; pass --purge to delete permanently.

Usage:
  dsh-session-migrator remove-subagents
  dsh-session-migrator remove-subagents --apply
  dsh-session-migrator remove-subagents --apply --purge`;
}

function walkSubagents(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'binaries' || e.name === 'logs') continue;
      if (e.name === 'subagents') {
        for (const f of fs.readdirSync(p)) if (f.endsWith('.jsonl')) out.push(path.join(p, f));
        continue;
      }
      walkSubagents(p, out);
    }
  }
}

function findDshDir(id) {
  const root = config.sessionsRoot;
  if (!fs.existsSync(root)) return undefined;
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const p = path.join(root, d.name, 'wb-' + id);
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

export function run(argv) {
  const opts = parseArgs(argv, []);
  const apply = Boolean(opts.apply);
  const purge = Boolean(opts.purge || opts['purge-deleted']);

  const subFiles = [];
  walkSubagents(config.workbuddyProjects, subFiles);
  const ids = new Set();
  for (const f of subFiles) {
    const stem = path.basename(f).replace(/\.jsonl$/, '');
    ids.add(stem.replace(/^agent-/, ''));
  }
  console.log('subagent transcripts found:', subFiles.length, 'unique ids:', ids.size);

  const plan = [];
  for (const id of ids) {
    const dir = findDshDir(id);
    const cache = fs.existsSync(path.join(config.projCacheDir, 'wb-' + id + '.json'));
    plan.push({ id, dir, cache });
  }
  const withDir = plan.filter((p) => p.dir);
  console.log('to delete — DSH dirs:', withDir.length, 'cache rows:', plan.filter((p) => p.cache).length);

  const doc = loadDoc();
  let refsRemoved = 0;
  const changedWs = [];
  for (const [wsid, rec] of Object.entries(doc.tables.workspaces)) {
    const before = (rec.sessionIds || []).length;
    const kept = (rec.sessionIds || []).filter((x) => !(x.startsWith('wb-') && ids.has(x.slice(3))));
    if (kept.length !== before) {
      refsRemoved += before - kept.length;
      rec.sessionIds = kept;
      changedWs.push([wsid, rec.title, before, kept.length]);
    }
    if (Array.isArray(rec.archivedSessionIds)) {
      rec.archivedSessionIds = rec.archivedSessionIds.filter(
        (x) => !(x.startsWith('wb-') && ids.has(x.slice(3)))
      );
    }
  }
  console.log('workspace refs to remove:', refsRemoved, 'in', changedWs.length, 'workspaces');
  console.log('changed workspaces:', changedWs.slice(0, 40));

  if (!apply) {
    console.log('\n[dry-run] pass --apply to delete.');
    return;
  }

  const dshHome = path.dirname(path.dirname(config.workspaceJson));
  const tag = new Date().toISOString().replace(/[:.]/g, '-');
  const trash = path.join(dshHome, '.session-migrator-trash', tag);
  let delDir = 0;
  let delCache = 0;
  let trashedDir = 0;
  let trashedCache = 0;
  const moveOrDelete = (src, destRel, isDir) => {
    if (purge) {
      if (isDir) fs.rmSync(src, { recursive: true, force: true });
      else fs.unlinkSync(src);
      return isDir ? 'delDir' : 'delCache';
    }
    const dest = path.join(trash, destRel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
      fs.renameSync(src, dest);
      return isDir ? 'trashedDir' : 'trashedCache';
    } catch {
      if (isDir) fs.rmSync(src, { recursive: true, force: true });
      else fs.unlinkSync(src);
      return isDir ? 'delDir' : 'delCache';
    }
  };
  for (const p of plan) {
    if (p.dir) {
      const r = moveOrDelete(p.dir, path.join('sessions', path.basename(path.dirname(p.dir)), path.basename(p.dir)), true);
      if (r === 'delDir') delDir++;
      else trashedDir++;
    }
    const c = path.join(config.projCacheDir, 'wb-' + p.id + '.json');
    if (fs.existsSync(c)) {
      const r = moveOrDelete(c, path.join('cache', path.basename(c)), false);
      if (r === 'delCache') delCache++;
      else trashedCache++;
    }
  }
  const backup = saveDoc(doc, config.workspaceJson, 'subagent');
  console.log(
    `[applied] trashed dirs: ${trashedDir}, cache: ${trashedCache}; purged dirs: ${delDir}, cache: ${delCache}; refs: ${refsRemoved}`
  );
  if (!purge) console.log('[applied] trash dir (delete later if you are sure):', trash);
  console.log('[applied] workspace backup:', backup);
  warnForceRestart();
}
