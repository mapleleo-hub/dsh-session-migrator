/**
 * DSH v4 session format: build, write, read and verify.
 *
 * Storage layout (one directory per session):
 *   <sessionsRoot>/--<projectKey>--/<sessionId>/session.v4.jsonl.zstd
 *
 * The file is a concatenation of independent zstd frames. Frame 0 is the
 * session header; every following frame is one JSON event. Each frame is
 * compressed with the zstd checksum flag enabled.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { randomUUID } from 'node:crypto';

export const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** Compress one JSON line into a single zstd frame (checksum on). */
export function compressFrame(str) {
  return zlib.zstdCompressSync(Buffer.from(str, 'utf8'), {
    params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 },
  });
}

/** Split a concatenated zstd byte stream into frames and decompress each. */
export function decompressAllFrames(buf) {
  const idx = [];
  for (let i = 0; i < buf.length - 3; i++) {
    if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) {
      idx.push(i);
    }
  }
  if (idx.length === 0) {
    // Not multi-frame / no magic — fall back to a single-stream decompress.
    return zlib.zstdDecompressSync(buf).toString('utf8');
  }
  idx.push(buf.length);
  let out = '';
  for (let k = 0; k < idx.length - 1; k++) {
    out += zlib.zstdDecompressSync(buf.subarray(idx[k], idx[k + 1])).toString('utf8');
  }
  return out;
}

/** Decode a session file into raw non-empty JSON line strings. */
export function decodeLines(file) {
  const text = decompressAllFrames(fs.readFileSync(file));
  return text.split('\n').filter((line) => line.trim() !== '');
}

/**
 * Read a session file back into { header, events, lines }.
 * Throws if any line is not valid JSON.
 */
export function readSession(file) {
  const lines = decodeLines(file);
  if (lines.length === 0) throw new Error('empty session file');
  const parsed = lines.map((line, i) => {
    try {
      return JSON.parse(line);
    } catch (e) {
      throw new Error(`line ${i} is not valid JSON: ${e.message}`);
    }
  });
  return { header: parsed[0], events: parsed.slice(1), lines };
}

/* ------------------------------------------------------------------ */
/* Turn building                                                       */
/* ------------------------------------------------------------------ */

export function buildMessages(exported) {
  return (exported.messages || [])
    .filter(
      (m) =>
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.body === 'string' &&
        m.body.trim() !== ''
    )
    .map((m) => ({ role: m.role, text: m.body }));
}

export function groupTurns(messages) {
  const turns = [];
  for (const m of messages) {
    if (m.role === 'user') {
      turns.push({ user: m.text, assistants: [] });
    } else if (m.role === 'assistant') {
      if (turns.length === 0) turns.push({ user: null, assistants: [m.text] });
      else turns[turns.length - 1].assistants.push(m.text);
    }
  }
  return turns;
}

export function titleFor(exported, fallback = '') {
  let title = (exported.title || '').trim();
  if (!title) {
    const firstUser = (exported.messages || []).find(
      (m) => m.role === 'user' && m.body && m.body.trim()
    );
    title = firstUser
      ? firstUser.body.trim().replace(/\s+/g, ' ')
      : String(exported.session || fallback || '');
  }
  return title.replace(/^#+\s*/, '').slice(0, 200);
}

/**
 * Build the header + event list for one exported conversation.
 *
 * Every message carries a producer-owned `source.kind` (user / model /
 * system-prompt); every turn is turn/start → step/start → … → step/end →
 * turn/end with reason `completed`. This is the shape DSH expects and opens.
 */
export function buildEvents(exported, opts = {}) {
  const {
    newId,
    cwd,
    modelProvider = 'dsh-session-migrator',
    model = 'imported',
    tsFallback = 0,
    titleFallback = '',
  } = opts;

  const turns = groupTurns(buildMessages(exported));
  const createdAt = Number(exported.ts) || Number(tsFallback) || Date.now();
  const header = {
    type: 'session',
    version: 4,
    id: newId,
    createdAt,
    cwd,
    isSeeded: false,
    delegationDepth: 0,
    agentPreset: 'standard',
  };

  const events = [];
  let seq = 0;
  let t = createdAt;
  const push = (type, data, extra) => {
    t += 1;
    const ev = { type, seq: seq++, time: t, data };
    if (extra) Object.assign(ev, extra);
    events.push(ev);
  };

  push('session/title', {
    title: titleFor(exported, titleFallback),
    messageSeqs: [],
    source: { kind: 'user' },
  });

  let turnNo = 0;
  for (const tn of turns) {
    turnNo++;
    let step = 1;
    push('turn/start', { turn: turnNo });
    push('step/start', { turn: turnNo, step });
    if (turnNo === 1) {
      push(
        'system/message',
        {
          turn: turnNo,
          step,
          message: {
            id: randomUUID(),
            role: 'system',
            content: [],
            source: { kind: 'system-prompt' },
          },
        },
        { surfaceOp: 'append' }
      );
    }
    if (tn.user != null) {
      push(
        'user/message',
        {
          id: randomUUID(),
          role: 'user',
          content: [{ type: 'text', text: tn.user }],
          source: { kind: 'user' },
        },
        { surfaceOp: 'append' }
      );
    }
    for (let i = 0; i < tn.assistants.length; i++) {
      if (i > 0) {
        push('step/end', { turn: turnNo, step });
        step++;
        push('step/start', { turn: turnNo, step });
      }
      push(
        'assistant/message',
        {
          turn: turnNo,
          step,
          message: {
            id: randomUUID(),
            role: 'assistant',
            content: [{ type: 'text', text: tn.assistants[i] }],
            source: { kind: 'model', provider: modelProvider, model },
          },
          stream: [],
        },
        { surfaceOp: 'append' }
      );
    }
    push('step/end', { turn: turnNo, step });
    push('turn/end', { turn: turnNo, reason: { kind: 'completed' } });
  }

  return { header, events, newId, createdAt };
}

/** Write a session file into <projectDir>/<newId>/session.v4.jsonl.zstd. */
export function writeSession(projectDirectory, newId, header, events) {
  const dir = path.join(projectDirectory, newId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'session.v4.jsonl.zstd');
  const chunks = [compressFrame(JSON.stringify(header) + '\n')];
  for (const ev of events) chunks.push(compressFrame(JSON.stringify(ev) + '\n'));
  fs.writeFileSync(file, Buffer.concat(chunks));
  return file;
}

/** Rewrite a session file from an array of raw JSON line strings. */
export function writeLines(file, lines) {
  const chunks = lines.map((line) => compressFrame(String(line) + '\n'));
  fs.writeFileSync(file, Buffer.concat(chunks));
}

/**
 * Verify structural integrity: header id/version, contiguous seq, message
 * source kinds, and no bare `turn/end {reason:{kind:'error'}}`.
 */
export function verify(file, expectId) {
  const { header, events } = readSession(file);
  if (header.type !== 'session') throw new Error('first line is not a session header');
  if (header.version !== 4) throw new Error('header.version !== 4');
  if (!header.id) throw new Error('header.id missing');
  if (expectId && header.id !== expectId) {
    throw new Error(`header.id mismatch: ${header.id} != ${expectId}`);
  }

  let seq = 0;
  let u = 0;
  let a = 0;
  for (const ev of events) {
    if (ev.seq !== seq++) throw new Error(`seq discontinuity: got ${ev.seq} expected ${seq - 1}`);
    if (ev.type === 'user/message') {
      if (!ev.data || !ev.data.source || !ev.data.source.kind) throw new Error('user/message missing source.kind');
      u++;
    } else if (ev.type === 'assistant/message') {
      if (!ev.data || !ev.data.message || !ev.data.message.source || !ev.data.message.source.kind) {
        throw new Error('assistant/message missing source.kind');
      }
      a++;
    } else if (ev.type === 'turn/end') {
      const reason = ev.data && ev.data.reason;
      if (reason && reason.kind === 'error') {
        const hasErr = reason.error && typeof reason.error.code === 'string';
        if (!hasErr) throw new Error('bare turn/end error reason (missing error.code)');
      }
    }
  }
  return { events: events.length, u, a };
}
