/**
 * import — the main importer.
 *
 * Converts local agent conversations (WorkBuddy, pi, Codex, opencode, zcode,
 * Claude Code, Cursor) into DSH native v4 sessions, grouped by each session's
 * ORIGINAL project directory, and registers them in workspace.json.
 *
 * Dry-run by default; --apply writes session files and rewrites workspace.json
 * (with a timestamped backup).
 */
import fs from 'node:fs';
import path from 'node:path';
import config from '../config.mjs';
import { projectDir } from '../project-key.mjs';
import { buildEvents, writeSession, verify } from '../v4.mjs';
import { listSource, exportSession, dumpSource } from '../csr.mjs';
import { cwdOf, cwdForDump, toWin, existingAncestor } from '../cwd.mjs';
import { loadDoc, saveDoc, mergeIntoWorkspace, stripIdsFromAll } from '../workspace.mjs';
import { parseArgs, csv, warnForceRestart } from '../common.mjs';

const WORKBUDDY_LIKE = new Set(['workbuddy', 'pi']);
const PREFIX = {
  workbuddy: 'wb-',
  pi: 'pi-',
  codex: 'codex-',
  opencode: 'opencode-',
  zcode: 'zcode-',
  claude: 'claude-',
  cursor: 'cursor-',
};
const ALL_SOURCES = Object.keys(PREFIX);
const OWN_PREFIX = /^(wb-|pi-|codex-|opencode-|zcode-|claude-|cursor-)/;

export function help() {
  return `dsh-session-migrator import [options]

Import conversations from local agents into DSH as native v4 sessions, grouped
by their original project directory.

Sources: ${ALL_SOURCES.join(', ')}
  (WorkBuddy/pi come from the chat-share-reader transcript store; the others
   from its dump inventory, which merges Codex fork shards and skips approval
   subsessions.)

Options:
  --sources a,b    comma list of sources (default: all)
  --apply          write session files + workspace.json (default: dry-run)
  --pilot          import at most one conversation per source
  --only <id>      import only the conversation with this original id
  --limit <n>      max sessions listed per source (default 1000000)
  --force          overwrite existing session files instead of skipping
  --no-workspace   build session files but do not touch workspace.json

Examples:
  dsh-session-migrator import                       # dry-run, all sources
  dsh-session-migrator import --sources workbuddy,codex --apply
  dsh-session-migrator import --pilot --apply`;
}

function resolveAgentCwd(src, record) {
  const raw = cwdForDump(src, record);
  if (raw) {
    const win = toWin(raw);
    if (fs.existsSync(win)) return win;
    const anc = existingAncestor(win);
    if (anc && fs.statSync(anc).isDirectory()) return anc;
  }
  return path.join(config.importFallbackRoot, `${src}-import`);
}

function collect(sources, opts) {
  const sessions = [];
  const skipped = [];

  for (const src of sources) {
    if (WORKBUDDY_LIKE.has(src)) {
      let arr = listSource(src, { limit: opts.limit });
      let n = 0;
      for (const it of arr) {
        const cwd = cwdOf(it.ref);
        if (!cwd) {
          skipped.push([src, it.id, 'no cwd']);
          continue;
        }
        sessions.push({ src, id: it.id, cwd, ts: it.ts || 0, title: it.title || '' });
        n++;
      }
      console.log(`[list] ${src}: ${n} sessions with cwd (${skipped.length} skipped so far)`);
    } else {
      let dump = dumpSource(src);
      let n = 0;
      for (const o of dump) {
        const hasUser = (o.messages || []).some((m) => m.role === 'user' && m.body && m.body.trim());
        if (!hasUser) {
          skipped.push([src, o.session, 'no user message']);
          continue;
        }
        const cwd = resolveAgentCwd(src, o);
        sessions.push({
          src,
          id: o.session,
          cwd,
          ts: o.started_at ? Date.parse(o.started_at) || 0 : 0,
          title: '',
        });
        n++;
      }
      console.log(`[dump] ${src}: ${n} human sessions`);
    }
  }

  if (opts.pilot) {
    const bySrc = new Map();
    const kept = [];
    for (const s of sessions) {
      const c = bySrc.get(s.src) || 0;
      if (c >= 1) continue;
      bySrc.set(s.src, c + 1);
      kept.push(s);
    }
    return { sessions: kept, skipped };
  }
  if (opts.only) {
    return { sessions: sessions.filter((s) => s.id === opts.only), skipped };
  }
  return { sessions, skipped };
}

function groupByCwd(sessions, apply) {
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
      g = { path: canonical, title: path.basename(canonical.replace(/[\\/]+$/, '')) || canonical, sessions: [] };
      groups.set(key, g);
    }
    g.sessions.push({ ...s, newId: PREFIX[s.src] + s.id });
  }
  return [...groups.values()].sort((a, b) => b.sessions.length - a.sessions.length);
}

export function run(argv) {
  const opts0 = parseArgs(argv, ['sources', 'only', 'limit']);
  const apply = Boolean(opts0.apply);
  const force = Boolean(opts0.force);
  const noWorkspace = Boolean(opts0['no-workspace']);
  const opts = {
    apply,
    force,
    pilot: Boolean(opts0.pilot),
    only: opts0.only && opts0.only !== true ? opts0.only : null,
    limit: opts0.limit ? Number(opts0.limit) : 1000000,
  };
  const sources = opts0.sources ? csv(opts0.sources) : ALL_SOURCES;
  for (const s of sources) {
    if (!PREFIX[s]) {
      console.error(`import: unknown source "${s}". Known: ${ALL_SOURCES.join(', ')}`);
      process.exitCode = 2;
      return;
    }
  }

  console.log(`[info] apply=${apply} sources=${sources.join(',')} pilot=${opts.pilot} only=${opts.only || '-'}`);

  const { sessions, skipped } = collect(sources, opts);
  console.log(`[skip] ${skipped.length}`, skipped.slice(0, 6));

  const groups = groupByCwd(sessions, apply);
  console.log(`[group] ${groups.length} original project groups across ${sessions.length} sessions`);
  for (const g of groups) console.log('   ', String(g.sessions.length).padStart(4), g.title, '|', g.path);

  let ok = 0;
  let fail = 0;
  let skip = 0;
  let noMsg = 0;
  const perSource = {};

  for (const g of groups) {
    const pdir = projectDir(g.path);
    if (apply) fs.mkdirSync(pdir, { recursive: true });
    for (const s of g.sessions) {
      perSource[s.src] = perSource[s.src] || { total: 0, ok: 0, fail: 0, skip: 0 };
      perSource[s.src].total++;
      try {
        const target = path.join(pdir, s.newId, 'session.v4.jsonl.zstd');
        if (fs.existsSync(target) && !force) {
          skip++;
          perSource[s.src].skip++;
          continue;
        }
        if (!apply) {
          ok++;
          perSource[s.src].ok++;
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
        if (events.length <= 1) {
          noMsg++;
          continue;
        }
        const file = writeSession(pdir, newId, header, events);
        verify(file, newId);
        ok++;
        perSource[s.src].ok++;
      } catch (e) {
        fail++;
        perSource[s.src].fail++;
        console.error('[fail]', s.src, s.id, String(e.message).split('\n')[0]);
      }
    }
    console.log(`[write] ${g.title} <- ${g.sessions.length} (ok=${ok} fail=${fail} skip=${skip})`);
  }

  if (!apply) {
    console.log(`\n[dry-run] groups=${groups.length} sessions=${sessions.length} (would write). Pass --apply to write.`);
    return;
  }

  if (noWorkspace) {
    console.log(`[done] built sessions only (--no-workspace). ok=${ok} fail=${fail} skip=${skip} noMsg=${noMsg}`);
    return;
  }

  // Register in workspace.json: strip our own ids, then merge per group.
  const doc = loadDoc();
  stripIdsFromAll(doc, (id) => OWN_PREFIX.test(id));
  const created = [];
  for (const g of groups) {
    const ids = g.sessions
      .slice()
      .sort((a, b) => (b.ts || 0) - (a.ts || 0) || String(a.newId).localeCompare(String(b.newId)))
      .map((s) => s.newId);
    const id = mergeIntoWorkspace(doc, { path: g.path, title: g.title, ids });
    created.push({ title: g.title, path: g.path, count: ids.length, id });
  }
  const backup = saveDoc(doc, config.workspaceJson, 'import');
  console.log('[workspace] backup', backup);
  console.log('[workspace] groups:');
  for (const c of created) console.log('  ', String(c.count).padStart(4), c.title, '|', c.path);
  console.log(`TOTAL ok=${ok} fail=${fail} skip=${skip} noMsg=${noMsg} groups=${groups.length}`);
  for (const src of Object.keys(perSource)) {
    const p = perSource[src];
    console.log(`  ${src}: total=${p.total} ok=${p.ok} fail=${p.fail} skip=${p.skip}`);
  }
  warnForceRestart();
}
