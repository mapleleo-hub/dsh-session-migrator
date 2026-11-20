import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  mergeIntoWorkspace,
  stripIdsFromAll,
  saveDoc,
  loadDoc,
  findWorkspaceByPath,
} from '../src/workspace.mjs';

function freshDoc() {
  return {
    unit: { name: 'workspace', version: 2 },
    global: {
      initialized: true,
      defaultWorkspaceId: 'w1',
      workspaceIds: ['w1'],
      archivedSessionIds: [],
      pinnedSessionIds: [],
    },
    tables: {
      workspaces: {
        w1: { path: 'E:\\p', title: 'p', sessionIds: ['s1'], createdAt: 'x', updatedAt: 'x' },
      },
    },
  };
}

test('mergeIntoWorkspace: appends ids to existing workspace by path', () => {
  const doc = freshDoc();
  const id = mergeIntoWorkspace(doc, { path: 'E:\\p', title: 'p', ids: ['wb-1', 'wb-2'] });
  assert.equal(id, 'w1');
  assert.deepEqual(doc.tables.workspaces.w1.sessionIds, ['s1', 'wb-1', 'wb-2']);
});

test('mergeIntoWorkspace: creates a new workspace for a new path', () => {
  const doc = freshDoc();
  const id = mergeIntoWorkspace(doc, { path: 'E:\\q', title: 'q', ids: ['pi-1'] });
  assert.notEqual(id, 'w1');
  assert.ok(doc.tables.workspaces[id]);
  assert.deepEqual(doc.tables.workspaces[id].sessionIds, ['pi-1']);
  assert.ok(doc.global.workspaceIds.includes(id));
  assert.equal(findWorkspaceByPath(doc, 'e:\\q'), id); // case-insensitive
});

test('stripIdsFromAll: removes only ids matching the predicate', () => {
  const doc = freshDoc();
  mergeIntoWorkspace(doc, { path: 'E:\\p', title: 'p', ids: ['wb-1'] });
  const id2 = mergeIntoWorkspace(doc, { path: 'E:\\q', title: 'q', ids: ['pi-1', 'wb-2'] });
  stripIdsFromAll(doc, (x) => x.startsWith('wb-'));
  assert.deepEqual(doc.tables.workspaces.w1.sessionIds, ['s1']);
  assert.deepEqual(doc.tables.workspaces[id2].sessionIds, ['pi-1']);
});

test('saveDoc: writes atomically and creates a backup', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsm-ws-'));
  const file = path.join(tmp, 'workspace.json');
  fs.writeFileSync(file, JSON.stringify(freshDoc(), null, 2));
  const doc = loadDoc(file);
  doc.tables.workspaces.w1.sessionIds.push('s2');
  const backup = saveDoc(doc, file, 'test');
  assert.ok(fs.existsSync(backup));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).tables.workspaces.w1.sessionIds, ['s1', 's2']);
});
