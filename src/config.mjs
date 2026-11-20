/**
 * Central configuration resolution.
 *
 * Nothing here may hardcode a user path. Every location is resolved from an
 * environment variable with a sane default derived from os.homedir().
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

/** DSH install root (~/.dsh). */
const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');

/** Where DSH keeps native v4 sessions: <DSH_HOME>/sessions */
const sessionsRoot = process.env.DSH_SESSIONS_ROOT || path.join(dshHome, 'sessions');

/** The workspace index DSH lists workspaces/sessions from. */
const workspaceJson =
  process.env.DSH_WORKSPACE_JSON || path.join(dshHome, 'storages', 'workspace.json');

/** Cached per-session projections (removed alongside a session when deleting). */
const projCacheDir =
  process.env.DSH_PROJCACHE ||
  path.join(dshHome, 'storages', 'session_projcache', 'sessions');

/**
 * Locate the chat-share-reader CLI (external dependency).
 * Order: CSR_SCRIPT env, then <DSH_HOME>/../.agents/..., then ~/.agents/...
 */
function resolveCsrScript() {
  if (process.env.CSR_SCRIPT) return process.env.CSR_SCRIPT;
  const candidates = [
    path.join(dshHome, '..', '.agents', 'skills', 'chat-share-reader', 'scripts', 'sessions.mjs'),
    path.join(os.homedir(), '.agents', 'skills', 'chat-share-reader', 'scripts', 'sessions.mjs'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return path.resolve(candidate);
    } catch {
      /* ignore */
    }
  }
  return null;
}

const config = {
  dshHome,
  sessionsRoot,
  workspaceJson,
  projCacheDir,
  csrScript: resolveCsrScript(),

  // Source-specific local stores used to recover a session's original cwd.
  opencodeDb:
    process.env.OPENCODE_DB ||
    path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db'),
  zcodeDb:
    process.env.ZCODE_DB || path.join(os.homedir(), '.zcode', 'cli', 'db', 'db.sqlite'),
  workbuddyProjects:
    process.env.WORKBUDDY_PROJECTS || path.join(os.homedir(), '.workbuddy', 'projects'),

  // Where agent sessions without a resolvable project dir are grouped.
  importFallbackRoot:
    process.env.IMPORT_FALLBACK_ROOT ||
    path.join(os.homedir(), '.dsh-session-migrator', 'imports'),
};

/** Return the csr script path or throw a clear, actionable error. */
export function requireCsr() {
  if (!config.csrScript) {
    throw new Error(
      'chat-share-reader CLI not found.\n' +
        '  Set CSR_SCRIPT to the full path of chat-share-reader/scripts/sessions.mjs.\n' +
        '  Expected default: ~/.agents/skills/chat-share-reader/scripts/sessions.mjs\n' +
        '  Install the skill first: https://github.com/ (chat-share-reader skill)'
    );
  }
  return config.csrScript;
}

/** Node >= 22 is required for node:sqlite and zlib zstd support. */
export function checkNodeVersion() {
  const version = process.versions.node;
  const major = Number(version.split('.')[0]);
  return { version, major, ok: major >= 22 };
}

export default config;
