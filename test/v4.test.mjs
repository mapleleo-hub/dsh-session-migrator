import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildEvents, writeSession, readSession, verify } from '../src/v4.mjs';

const exported = {
  title: 'Demo',
  ts: 1700000000000,
  messages: [
    { role: 'user', body: '你好' },
    { role: 'assistant', body: '你好，有什么可以帮你？' },
    { role: 'user', body: '讲个笑话' },
    { role: 'assistant', body: '从前有座山…' },
    { role: 'assistant', body: '（补充）' },
  ],
};

test('buildEvents: header, contiguous seq, completed turns, producer-owned sources', () => {
  const { header, events } = buildEvents(exported, { newId: 't-1', cwd: 'E:\\work\\proj' });
  assert.equal(header.type, 'session');
  assert.equal(header.version, 4);
  assert.equal(header.id, 't-1');
  assert.equal(header.cwd, 'E:\\work\\proj');
  events.forEach((e, i) => assert.equal(e.seq, i, 'seq must be contiguous'));

  assert.equal(events[0].type, 'session/title');
  assert.equal(events[0].data.source.kind, 'user');

  const turnEnds = events.filter((e) => e.type === 'turn/end');
  assert.equal(turnEnds.length, 2);
  for (const e of turnEnds) assert.equal(e.data.reason.kind, 'completed');

  for (const e of events.filter((x) => x.type === 'user/message')) {
    assert.equal(e.data.source.kind, 'user');
  }
  for (const e of events.filter((x) => x.type === 'assistant/message')) {
    assert.equal(e.data.message.source.kind, 'model');
    assert.ok(e.data.message.source.provider, 'assistant needs provider');
  }
  // second turn has two assistant messages -> at least two steps
  assert.ok(events.filter((e) => e.type === 'step/start').length >= 3);
});

test('buildEvents: title falls back to first user message', () => {
  const { events } = buildEvents(
    { messages: [{ role: 'user', body: '  第一句话  ' }, { role: 'assistant', body: 'ok' }] },
    { newId: 'x' }
  );
  assert.equal(events[0].data.title, '第一句话');
});

test('writeSession -> readSession roundtrip and verify()', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsm-v4-'));
  const { header, events, newId } = buildEvents(exported, { newId: 'rt-1', cwd: 'C:\\x' });
  const file = writeSession(path.join(tmp, 'proj'), newId, header, events);
  assert.ok(fs.existsSync(file));

  const back = readSession(file);
  assert.equal(back.header.id, 'rt-1');
  assert.equal(back.events.length, events.length);

  const res = verify(file, 'rt-1');
  assert.equal(res.u, 2);
  assert.equal(res.a, 3);
});
