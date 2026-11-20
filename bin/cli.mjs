#!/usr/bin/env node
/**
 * dsh-session-migrator — CLI dispatcher.
 *
 * Zero third-party dependencies; Node >= 22 (for node:sqlite + zlib zstd).
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { checkNodeVersion } from '../src/config.mjs';

import * as importCmd from '../src/commands/import.mjs';
import * as regroupCmd from '../src/commands/regroup.mjs';
import * as fixTurnEndCmd from '../src/commands/fix-turn-end.mjs';
import * as fixProjectKeyCmd from '../src/commands/fix-project-key.mjs';
import * as mountCmd from '../src/commands/mount.mjs';
import * as removeSubagentsCmd from '../src/commands/remove-subagents.mjs';
import * as scanCmd from '../src/commands/scan.mjs';
import * as doctorCmd from '../src/commands/doctor.mjs';

const COMMANDS = {
  import: { mod: importCmd, desc: 'Import conversations from local agents into DSH (dry-run default).' },
  regroup: { mod: regroupCmd, desc: 'Regroup WorkBuddy/pi imports by original project directory.' },
  'fix-turn-end': { mod: fixTurnEndCmd, desc: "Rewrite bare turn/end error reasons to completed (fixes projection crash)." },
  'fix-project-key': { mod: fixProjectKeyCmd, desc: 'Rename mis-encoded session project directories.' },
  mount: { mod: mountCmd, desc: 'Register imported session ids into a workspace.' },
  'remove-subagents': { mod: removeSubagentsCmd, desc: 'Delete imported WorkBuddy subagent sessions.' },
  scan: { mod: scanCmd, desc: 'Read-only validation of all session files (ok/bad counts).' },
  doctor: { mod: doctorCmd, desc: 'Read-only environment self-check.' },
};

function readVersion() {
  try {
    const p = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    return JSON.parse(fs.readFileSync(p, 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function generalHelp() {
  const lines = [];
  lines.push('dsh-session-migrator — import AI-agent chat sessions into DeepSeek Harness (DSH)');
  lines.push('');
  lines.push('Usage:');
  lines.push('  dsh-session-migrator <command> [options]');
  lines.push('  dsh-session-migrator <command> --help');
  lines.push('');
  lines.push('Commands:');
  const width = Math.max(...Object.keys(COMMANDS).map((k) => k.length));
  for (const [name, { desc }] of Object.entries(COMMANDS)) {
    lines.push(`  ${name.padEnd(width)}  ${desc}`);
  }
  lines.push('');
  lines.push('Global:');
  lines.push('  --help, -h     Show this help');
  lines.push('  --version, -v  Show version');
  lines.push('');
  lines.push('Environment:');
  lines.push('  DSH_HOME       DSH root (default ~/.dsh)');
  lines.push('  CSR_SCRIPT     chat-share-reader sessions.mjs path (auto-detected by default)');
  lines.push('');
  lines.push('Safety: every mutating command is dry-run by default; pass --apply to write.');
  lines.push('After rewriting workspace.json, fully force-restart DSH so its in-memory copy');
  lines.push('does not overwrite your change on exit.');
  return lines.join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(generalHelp());
    return;
  }
  if (cmd === '--version' || cmd === '-v' || cmd === 'version') {
    console.log(readVersion());
    return;
  }

  const entry = COMMANDS[cmd];
  if (!entry) {
    console.error(`Unknown command: ${cmd}\n`);
    console.log(generalHelp());
    process.exitCode = 1;
    return;
  }

  const rest = argv.slice(1);
  if (rest.includes('--help') || rest.includes('-h')) {
    console.log(entry.mod.help());
    return;
  }

  // Node version gate (doctor can still report it).
  const node = checkNodeVersion();
  if (!node.ok && cmd !== 'doctor') {
    console.error(`Node >= 22 is required (current ${node.version}). node:sqlite + zlib zstd are needed.`);
    process.exitCode = 1;
    return;
  }

  try {
    entry.mod.run(rest);
  } catch (e) {
    console.error(`[error] ${e && e.message ? e.message : e}`);
    process.exitCode = 1;
  }
}

main();
