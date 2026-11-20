# DSH v4 session format

This document describes the on-disk format this tool writes, so you can verify
or re-implement it. It is the contract that makes DSH open an imported session.

## 1. Location

```
<DSH_HOME>/sessions/--<projectKey>--/<sessionId>/session.v4.jsonl.zstd
```

- `<DSH_HOME>` is usually `~/.dsh`.
- `--<projectKey>--` is derived from the session's original cwd (see §3).
- `<sessionId>` is the session's `header.id` and **must** equal the directory name.

## 2. Frame encoding

`session.v4.jsonl.zstd` is **not** one zstd stream. It is a concatenation of
**independent zstd frames**:

- **Frame 0** = the session header, `JSON.stringify(header) + "\n"`.
- **Each following frame** = exactly one event, `JSON.stringify(event) + "\n"`.

Each frame is produced by `zlib.zstdCompressSync(bytes, { params: { [ZSTD_c_checksumFlag]: 1 } })`,
i.e. **the zstd checksum flag is ON**. The magic bytes `28 B5 2F FD` begin every
frame, so a reader can slice the file into frames by scanning for that magic.

To decode: scan for magic offsets, decompress each slice, concatenate the text,
split on `\n`, JSON-parse each non-empty line. Line 0 is the header; the rest are
events in order.

## 3. projectKey algorithm

A byte-for-byte copy of `@deepseek-ai/dsh-session-persistence-jsonl`'s
`projectKey()`:

For each UTF-16 code unit `ch` of the cwd (iterate `charCodeAt`):

1. `/`, `\`, `:` are separators → emit a single `-`; a **run** of separators
   collapses to one `-`.
2. `[A-Za-z0-9._-]` → emit `ch` verbatim.
3. Anything else → emit `~` + `code.toString(16).toUpperCase().padStart(4, '0')`.

Then: strip leading `-`; if empty use `root`; truncate to 251 chars; wrap as
`--<result>--` for the directory name.

Example: `E:\work\项目` → `--E-work-~9879~76EE--`.

> Getting this wrong (e.g. writing raw UTF-8 bytes) makes DSH throw
> `corrupt session log ... header id ... and cwd identify ...` at activation and
> leaves its workspace services pending. Use `fix-project-key` to repair.

## 4. Header fields (frame 0)

```json
{
  "type": "session",
  "version": 4,
  "id": "wb-<originalId>",
  "createdAt": 1795146705796,
  "cwd": "E:\\work\\proj",
  "isSeeded": false,
  "delegationDepth": 0,
  "agentPreset": "standard"
}
```

- `id` — unique; also the directory name.
- `createdAt` — epoch milliseconds.
- `cwd` — original project path; `projectKey(cwd)` must equal the parent dir.
- `agentPreset: "standard"` — imported sessions behave like normal ones.

## 5. Event sequence (frames 1..N)

Every event is `{ type, seq, time, data }` with `seq` starting at `0` and
increasing by exactly 1, and `time` in epoch ms.

Per conversation:

```
session/title            { title, messageSeqs: [], source: { kind: 'user' } }

for each turn N:
  turn/start             { turn: N }
  step/start             { turn: N, step: 1 }
  system/message         { turn: N, step: 1, message: { id, role:'system',
                           content: [], source: { kind:'system-prompt' } } }   // first turn only
  user/message           { id, role:'user', content:[{type:'text',text}],
                           source: { kind:'user' } }                          // if the turn has a user msg
  assistant/message      { turn: N, step, message: { id, role:'assistant',
                           content:[{type:'text',text}],
                           source:{ kind:'model', provider, model } }, stream: [] }
  ... (each extra assistant message becomes its own step:
       step/end, step++, step/start, assistant/message)
  step/end               { turn: N, step }
  turn/end               { turn: N, reason: { kind: 'completed' } }
```

`session/title`, `user/message`, `system/message`, `assistant/message` carry
`surfaceOp: "append"`.

### `source.kind` (critical)

Every message must have a **producer-owned** `source.kind`, otherwise DSH
reports *"format v4 message requires a producer-owned source kind"*:

- `user/message` → `data.source = { kind: 'user' }`
- `assistant/message` → `data.message.source = { kind: 'model', provider, model }`
- `system/message` → `data.message.source = { kind: 'system-prompt' }`
- `session/title` → `data.source = { kind: 'user' }`

### `turn/end` reason (critical)

`reason.kind` must be `"completed"` (or `"error"` **with** `error.code`).
A bare `{ kind: 'error' }` makes DSH's projection throw
`Cannot read properties of undefined (reading 'code')`. This importer always
writes `completed`; legacy files can be repaired with `fix-turn-end`.

## 6. workspace.json registration

DSH never auto-adopts stray session directories once the workspace domain is
initialised; it lists a workspace's sessions purely from
`tables.workspaces[id].sessionIds` (array order = sidebar order).

```json
{
  "tables": {
    "workspaces": {
      "<workspaceId>": {
        "path": "E:\\work\\proj",
        "title": "proj",
        "sessionIds": ["wb-...", "codex-..."],
        "createdAt": "...",
        "updatedAt": "..."
      }
    }
  },
  "global": { "workspaceIds": ["<workspaceId>", "..."] }
}
```

To register imported sessions:

1. Remove your imported ids from every workspace (avoid duplicates when re-running).
2. Find the workspace whose `path` equals the group path (case-insensitive) or
   create a new one (`path`, `title = basename`, `sessionIds`, timestamps) and
   `unshift` its id into `global.workspaceIds`.
3. Set `sessionIds` to the group's ids, newest first.

Always back up `workspace.json` before writing and write atomically
(temp file + rename), preserving the trailing newline.

## 7. Force-restart gotcha

A running DSH caches `workspace.json` in memory and **writes it back on a normal
exit**. If you edit the file while DSH is running, your change is silently
reverted when the app quits. After any command that writes `workspace.json`, you
must:

```
taskkill /F /IM "DeepSeek Harness.exe"
```

and then reopen. Do **not** create/rename/reorder workspaces before restarting —
that flushes the stale in-memory copy over your edit.

## 8. Quick verify

```bash
dsh-session-migrator scan          # ok N bad M over all sessions
dsh-session-migrator doctor        # environment check
```

`scan` decodes every frame, checks header type/version/id, contiguous `seq`,
message `source.kind`, and that the directory name equals `projectKey(cwd)`.
