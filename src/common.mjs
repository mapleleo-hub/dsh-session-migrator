/**
 * Small shared CLI helpers (argument parsing + safety notices).
 */

/**
 * Minimal argv parser.
 *   --flag            → true
 *   --key value       → "value"  (when `key` is listed in valueFlags)
 *   --key=value       → "value"
 *   positional        → o._ array
 */
export function parseArgs(argv, valueFlags = []) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > -1) {
        o[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        if (valueFlags.includes(key)) o[key] = argv[++i];
        else o[key] = true;
      }
    } else {
      o._.push(a);
    }
  }
  return o;
}

/** Parse a comma-separated list value into an array. */
export function csv(value) {
  if (value == null || value === true) return [];
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Print the "force restart DSH" warning that applies to every mutating command. */
export function warnForceRestart() {
  const lines = [
    '',
    '!! IMPORTANT — restart DSH before trusting the result:',
    '   A running DeepSeek Harness caches workspace.json in memory and writes it',
    '   back on a normal exit, which would overwrite your change. After writing,',
    '   fully force-quit DSH (on Windows: taskkill /F /IM "DeepSeek Harness.exe")',
    '   and reopen it. Do NOT create/rename/reorder workspaces before restarting.',
    '',
  ];
  console.log(lines.join('\n'));
}
