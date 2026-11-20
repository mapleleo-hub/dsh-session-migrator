/**
 * doctor — read-only environment self-check.
 */
import fs from 'node:fs';
import config, { checkNodeVersion } from '../config.mjs';

export function help() {
  return `dsh-session-migrator doctor

Read-only check of the local environment:
  - Node.js version (>= 22 required)
  - DSH_HOME / sessions root / workspace.json existence
  - chat-share-reader CLI (CSR_SCRIPT) resolution

Usage:
  dsh-session-migrator doctor`;
}

export function run() {
  const node = checkNodeVersion();
  const out = [];
  out.push('dsh-session-migrator doctor');
  out.push('----------------------------------------');
  out.push(`Node.js          : ${node.version}  ${node.ok ? '(ok, >=22)' : '(TOO OLD, need >=22)'}`);
  out.push(`DSH_HOME         : ${config.dshHome}`);
  out.push(`sessions root    : ${config.sessionsRoot}  ${fs.existsSync(config.sessionsRoot) ? '[exists]' : '[MISSING]'}`);
  out.push(`workspace.json   : ${config.workspaceJson}  ${fs.existsSync(config.workspaceJson) ? '[exists]' : '[MISSING]'}`);
  out.push(`proj-cache dir   : ${config.projCacheDir}  ${fs.existsSync(config.projCacheDir) ? '[exists]' : '[missing]'}`);
  out.push(`csrScript        : ${config.csrScript || '[NOT FOUND — set CSR_SCRIPT]'}`);
  out.push(`opencode db      : ${config.opencodeDb}  ${fs.existsSync(config.opencodeDb) ? '[exists]' : '[missing]'}`);
  out.push(`zcode db         : ${config.zcodeDb}  ${fs.existsSync(config.zcodeDb) ? '[exists]' : '[missing]'}`);
  out.push(`workbuddy store  : ${config.workbuddyProjects}  ${fs.existsSync(config.workbuddyProjects) ? '[exists]' : '[missing]'}`);
  out.push('----------------------------------------');

  const problems = [];
  if (!node.ok) problems.push('Node >= 22 is required (node:sqlite + zlib zstd).');
  if (!fs.existsSync(config.sessionsRoot)) problems.push('DSH sessions root not found.');
  if (!fs.existsSync(config.workspaceJson)) problems.push('workspace.json not found.');
  if (!config.csrScript) problems.push('chat-share-reader CLI not found — set CSR_SCRIPT.');

  if (problems.length) {
    out.push('Result: NOT READY');
    for (const p of problems) out.push(`  - ${p}`);
  } else {
    out.push('Result: OK — environment looks usable.');
  }
  out.push('');
  out.push('Reminder: after any command that rewrites workspace.json, fully force-restart DSH');
  out.push('(Windows: taskkill /F /IM "DeepSeek Harness.exe") so it does not write its stale');
  out.push('in-memory list back over the file on exit.');

  console.log(out.join('\n'));
  process.exitCode = problems.length ? 1 : 0;
}
