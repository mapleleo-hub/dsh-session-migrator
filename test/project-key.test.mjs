import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCwdForDir, projectKey } from '../src/project-key.mjs';

test('normalizeCwdForDir: separators collapse to single dash, leading dashes removed', () => {
  assert.equal(normalizeCwdForDir('E:\\work\\proj'), 'E-work-proj');
  assert.equal(normalizeCwdForDir('a//b::c'), 'a-b-c');
  assert.equal(normalizeCwdForDir('\\lead'), 'lead');
  assert.equal(normalizeCwdForDir('root'), 'root');
});

test('projectKey: wraps in --...-- and escapes non-ASCII code units as ~XXXX', () => {
  assert.equal(projectKey('E:\\work\\proj'), '--E-work-proj--');
  const k = projectKey('D:\\图片\\2026_中华器物');
  assert.ok(!/[^\x00-\x7f]/.test(k), 'key must be ASCII: ' + k);
  assert.ok(k.includes('~56FE'), k); // 图
  assert.ok(k.includes('~4E2D'), k); // 中
  assert.ok(k.startsWith('--') && k.endsWith('--'), k);
});

test('normalizeCwdForDir: length capped at 251', () => {
  const long = 'x'.repeat(400);
  assert.ok(normalizeCwdForDir(long).length <= 251);
});
