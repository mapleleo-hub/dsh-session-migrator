/**
 * mount — append/prepend imported session ids to a workspace's sessionIds.
 *
 * DSH lists a workspace's sessions from tables.workspaces[id].sessionIds and
 * never auto-adopts stray session directories once the workspace domain is
 * initialised, so imported sessions must be registered explicitly.
 */
import fs from 'node:fs';
import path from 'node:path';
import config from '../config.mjs';
import { projectDir } from '../project-key.mjs';
import { readSession } from '../v4.mjs';
import { loadDoc, saveDoc, findWorkspaceByPath } from '../workspace.mjs';
import { parseArgs, csv, warnForceRestart } from '../common.mjs';

const DEFAULT_PREFIXES = ['wb-', 'pi-', 'codex-', 'opencode-', 'zcode-', 'claude-', 'cursor-'];

export function help() {
  return `dsh-session-migrator mount --path <cwd> [--prepend] [--prefix a,b] [--apply]

Registers imported session ids found under projectDir(<cwd>) into the workspace
whose path equals <cwd> in workspace.json.

  --path <cwd>     original project path (required; its project dir is derived)
  --prefix a,b     session-id prefixes to mount (default: ${DEFAULT_PREFIXES.join(', ')})
  --prepend        put imported ids at the top of the sidebar order
  --apply          write (backs workspace.json up first); default is dry-run

Usage:
  dsh-session-migrator mount --path "E:\\\\work\\\\proj"
  dsh-session-migrator mount --path "E:\\\\work\\\\proj" --apply --prepend`;
}

function readHeader(file) {
  const { header } = readSession(file);
  return header;
}

export function run(argv) {
  const opts = parseArgs(argv, ['path', 'prefix']);
  const wsPath = opts.path;
  if (!wsPath || wsPath === true) {
    console.error('mount: --path <cwd> is required. See --help.');
    process.exitCode = 2;
    return;
  }
  const apply = Boolean(opts.apply);
  const prepend = Boolean(opts.prepend);
  const prefixes = opts.prefix ? csv(opts.prefix) : DEFAULT_PREFIXES;

  const dir = projectDir(wsPath);
  if (!fs.existsSync(dir)) {
    console.error(`project dir not found: ${dir}`);
    process.exitCode = 2;
    return;
  }

  const rows = [];
  const skipped = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    if (!prefixes.some((p) => d.name.startsWith(p))) continue;
    const file = path.join(dir, d.name, 'session.v4.jsonl.zstd');
    if (!fs.existsSync(file)) {
      skipped.push([d.name, 'no session file']);
      continue;
    }
    try {
      const h = readHeader(file);
      if (h.id !== d.name) {
        skipped.push([d.name, `header id ${h.id}`]);
        continue;
      }
      if (String(h.cwd).toLowerCase() !== String(wsPath).toLowerCase()) {
        skipped.push([d.name, `cwd ${h.cwd}`]);
        continue;
      }
      rows.push({ id: d.name, createdAt: h.createdAt, title: h.title });
    } catch (e) {
      skipped.push([d.name, String(e.message)]);
    }
  }
  rows.sort((a, b) => b.createdAt - a.createdAt || String(a.id).localeCompare(String(b.id)));

  const doc = loadDoc();
  const wsId = findWorkspaceByPath(doc, wsPath);
  if (!wsId) {
    console.error(`workspace not found in workspace.json for path: ${wsPath}`);
    process.exitCode = 2;
    return;
  }
  const rec = doc.tables.workspaces[wsId];
  const existing = Array.isArray(rec.sessionIds) ? rec.sessionIds : [];
  const importedIds = rows.map((r) => r.id);
  const importedSet = new Set(importedIds);
  const remaining = existing.filter((id) => !importedSet.has(id));
  const newIds = prepend ? [...importedIds, ...remaining] : [...remaining, ...importedIds];
  const added = importedIds.filter((id) => !existing.includes(id));

  console.log('workspace:', wsId);
  console.log('existing sessionIds:', existing.length);
  console.log(
    'imported found (valid):',
    importedIds.length,
    `(by prefix: ${prefixes.join(' ')})`
  );
  console.log('skipped:', skipped.length, skipped.slice(0, 10));
  console.log('will add:', added.length, '=> new total:', newIds.length);
  console.log('mode:', prepend ? 'prepend imported' : 'append imported');

  if (!apply) {
    console.log('\n[dry-run] pass --apply to write.');
    return;
  }

  rec.sessionIds = newIds;
  rec.updatedAt = new Date().toISOString();
  const backup = saveDoc(doc, config.workspaceJson, 'mount');
  console.log('\n[applied] backup:', backup);
  console.log(`[applied] sessionIds now ${rec.sessionIds.length}`);
  warnForceRestart();
}
