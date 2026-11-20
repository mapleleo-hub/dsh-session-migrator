/**
 * regroup — regroup WorkBuddy/pi imports by their ORIGINAL project directory.
 *
 * Produces one DSH workspace per original project (mirroring how WorkBuddy/pi
 * grouped chats), rewrites each session header.cwd to that group path, and
 * removes the old "WorkBuddy 导入" / "pi 导入" buckets.
 *
 * Dry-run by default; --apply writes.
 */
import fs from 'node:fs';
import path from 'node:path';
import config from '../config.mjs';
import { projectDir } from '../project-key.mjs';
import { buildEvents, writeSession, verify } from '../v4.mjs';
import { listSource, exportSession } from '../csr.mjs';
import { cwdOf } from '../cwd.mjs';
import { loadDoc, saveDoc, mergeIntoWorkspace, stripIdsFromAll, removeWorkspace } from '../workspace.mjs';
import { parseArgs, warnForceRestart } from '../common.mjs';

const OLD_IMPORT_TITLES = new Set(['WorkBuddy 导入', 'pi 导入']);
const WF_PREFIX = /^(wb-|pi-)/;

export function help() {
  return `dsh-session-migrator regroup [--sources workbuddy,pi] [--apply]

Regroups WorkBuddy/pi imports by each conversation's ORIGINAL cwd into one DSH
workspace per original project, and drops the old "WorkBuddy 导入"/"pi 导入"
buckets. Headers are rewritten so header.cwd matches the group path.

Dry-run by default.

Usage:
  dsh-session-migrator regroup
  dsh-session-migrator regroup --apply`;
}

export function run(argv) {
  const opts = parseArgs(argv, []);
  const apply = Boolean(opts.apply);

  const sessions = [];
  for (const src of ['workbuddy', 'pi']) {
    const arr = listSource(src, { limit: 1000000 });
    let n = 0;
    for (const it of arr) {
      const cwd = cwdOf(it.ref);
      if (!cwd) {
        console.warn('[warn] no cwd', src, it.id);
        continue;
      }
      sessions.push({ src, id: it.id, cwd, title: it.title || '', ts: it.ts || 0 });
      n++;
    }
    console.log(`[list] ${src}: ${n} sessions with cwd`);
  }

  const groups = new Map();
  for (const s of sessions) {
    let canonical;
    try {
      if (!fs.existsSync(s.cwd) && apply) fs.mkdirSync(s.cwd, { recursive: true });
      canonical = fs.existsSync(s.cwd) ? fs.realpathSync.native(s.cwd) : s.cwd;
    } catch {
      canonical = s.cwd;
    }
    const key = canonical.toLowerCase();
    let g = groups.get(key);
    if (!g) {
      g = { path: canonical, title: path.basename(canonical) || canonical, sessions: [] };
      groups.set(key, g);
    }
    g.sessions.push({ ...s, newId: (s.src === 'workbuddy' ? 'wb-' : 'pi-') + s.id });
  }
  const sortedGroups = [...groups.values()].sort((a, b) => b.sessions.length - a.sessions.length);
  console.log(`[group] ${sortedGroups.length} original project groups`);
  for (const g of sortedGroups) console.log('   ', String(g.sessions.length).padStart(4), g.title, '|', g.path);

  let ok = 0;
  let fail = 0;
  for (const g of sortedGroups) {
    const pdir = projectDir(g.path);
    if (apply) fs.mkdirSync(pdir, { recursive: true });
    for (const s of g.sessions) {
      try {
        if (!apply) {
          ok++;
          continue;
        }
        const exported = exportSession(s.id, s.src);
        if (!exported.title && s.title) exported.title = s.title;
        const { header, events, newId } = buildEvents(exported, {
          newId: s.newId,
          cwd: g.path,
          modelProvider: `${s.src}-chat-import`,
          tsFallback: s.ts,
          titleFallback: s.title,
        });
        const file = writeSession(pdir, newId, header, events);
        verify(file, newId);
        ok++;
      } catch (e) {
        fail++;
        console.error('[fail]', s.src, s.id, String(e.message).split('\n')[0]);
      }
    }
    console.log(`[write] ${g.title} <- ${g.sessions.length} (ok so far ${ok})`);
  }

  if (!apply) {
    console.log(`\n[dry-run] groups=${sortedGroups.length} sessions=${sessions.length}. Pass --apply to write.`);
    return;
  }

  const doc = loadDoc();

  // Remove old import buckets (record + their project dir on disk).
  const table = doc.tables.workspaces;
  for (const id of Object.keys(table)) {
    if (OLD_IMPORT_TITLES.has(table[id].title)) {
      const oldDir = projectDir(table[id].path);
      if (fs.existsSync(oldDir)) {
        fs.rmSync(oldDir, { recursive: true, force: true });
        console.log('[cleanup] removed', oldDir);
      }
      removeWorkspace(doc, id);
    }
  }
  // Strip any lingering wb-/pi- ids from other workspaces.
  stripIdsFromAll(doc, (id) => WF_PREFIX.test(id));

  for (const g of sortedGroups) {
    const ids = g.sessions
      .slice()
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .map((s) => s.newId);
    mergeIntoWorkspace(doc, { path: g.path, title: g.title, ids });
  }

  const backup = saveDoc(doc, config.workspaceJson, 'regroup');
  console.log('[workspace] backup', backup);
  console.log(`TOTAL ok=${ok} fail=${fail} groups=${sortedGroups.length}`);
  warnForceRestart();
}
