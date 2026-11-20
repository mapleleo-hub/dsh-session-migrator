/**
 * DSH projectKey algorithm — a byte-for-byte copy of
 * @deepseek-ai/dsh-session-persistence-jsonl's projectKey().
 *
 * Rules:
 *   - '/' '\' ':' are path separators; a run of them collapses to a single '-'.
 *   - [A-Za-z0-9._-] are kept verbatim.
 *   - any other UTF-16 code unit becomes "~XXXX" (uppercase hex, 4+ digits).
 *   - leading '-' are stripped; empty becomes "root"; capped at 251 chars.
 *   - the on-disk directory name wraps the result as "--<key>--".
 */
import path from 'node:path';
import config from './config.mjs';

const SLASH = '/';
const BACKSLASH = String.fromCharCode(92); // avoid escaping a literal backslash here
const COLON = ':';

export function normalizeCwdForDir(cwd) {
  let readable = '';
  let separatorRun = false;
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch === SLASH || ch === BACKSLASH || ch === COLON) {
      if (!separatorRun) readable += '-';
      separatorRun = true;
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0');
      separatorRun = false;
    }
  }
  return (readable.replace(/^-+/, '') || 'root').slice(0, 251);
}

/** The on-disk directory name for a project path, e.g. "--E-01-project--". */
export function projectKey(cwd) {
  return `--${normalizeCwdForDir(cwd)}--`;
}

/** Absolute path of the project directory under the sessions root. */
export function projectDir(cwd, root = config.sessionsRoot) {
  return path.join(root, projectKey(cwd));
}
