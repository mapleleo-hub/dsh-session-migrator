# dsh-session-migrator

> 把本机各种 AI Agent 的历史对话，导入成 **DeepSeek Harness (DSH)** 的原生会话。

DSH 把每个会话存成 zstd 分帧的 v4 JSONL（`~/.dsh/sessions/--<projectKey>--/<sessionId>/session.v4.jsonl.zstd`），
并从 `~/.dsh/storages/workspace.json` 的 `tables.workspaces[*].sessionIds` 列出侧边栏。
**DSH 官方没有提供把 WorkBuddy / pi / Codex / opencode / zcode / Claude Code / Cursor 的会话导入进来的工具**——
本项目就是我们自己用的一套脚本的整理版，开源出来给同样需要的人。

---

## 它做什么

- 读取本机各 Agent 的历史会话（正文、角色、时间、原始工作目录）；
- 按**原始项目目录**分组，转换成 DSH 的 v4 会话格式，写入 `~/.dsh/sessions`；
- 把会话 id 注册进 `workspace.json`，让它们在 DSH 侧边栏按项目正确出现；
- 附带几个修数据、清理、体检的小命令。

## 支持的来源

| 来源 | 读取方式 | 说明 |
|---|---|---|
| WorkBuddy | 本地 transcript（`.jsonl`） | 按原始 `cwd` 分组 |
| pi | 本地 transcript | 按 header `cwd` 分组 |
| **Codex** | `.jsonl` **和 `.jsonl.zst`** | 合并 fork 分片、跳过 approval 子会话 |
| opencode | SQLite (`opencode.db`) | 从 `session.directory` 取原始目录 |
| zcode | SQLite (`db.sqlite`) | 从 `session.directory` 取原始目录 |
| Claude Code | 本地 `.jsonl` | |
| Cursor | `state.vscdb` | |

> **差异点：** 很多流行的导入插件不支持 Codex 的 `.jsonl.zst`（新版 Codex 用的是 zstd 压缩的分片）。
> 本项目对 Codex `.jsonl` / `.jsonl.zst` 都能读，且会把同一 session 的多个 fork 分片合并成一场对话。

会话清单与正文都由外部依赖 **chat-share-reader** skill 的 CLI 提供，本项目只负责转换与落盘。

## 前置条件

- **Node.js >= 22**（依赖 `node:sqlite` 与 `node:zlib` 的 zstd 支持）
- 已在测试的 **DSH 0.2.2-rc.5** 上验证（其它版本理论兼容，但请先 `scan`）
- 安装 **chat-share-reader** skill，默认路径 `~/.agents/skills/chat-share-reader/scripts/sessions.mjs`
  （找不到时会提示你设 `CSR_SCRIPT`）

## 安装

```bash
git clone <repo> dsh-session-migrator
cd dsh-session-migrator
# 直接用，无需安装依赖（零第三方依赖）
node bin/cli.mjs --help
# 或全局链接
npm link          # 之后可用 dsh-session-migrator <cmd>
```

## 用法

所有命令**默认 dry-run（只打印计划，不写盘）**，加 `--apply` 才真正写入。

```bash
# 环境体检（只读）
dsh-session-migrator doctor

# 全量校验现有会话，打印 ok/bad 数量（只读）
dsh-session-migrator scan

# 干跑：看会把哪些来源、分到哪些项目
dsh-session-migrator import

# 只导 WorkBuddy + Codex，真正写入
dsh-session-migrator import --sources workbuddy,codex --apply

# 每条来源各取 1 条先试点
dsh-session-migrator import --pilot --apply

# 按原始项目目录重新归组 WorkBuddy/pi
dsh-session-migrator regroup --apply

# 修复裸 turn/end error（DSH 投影会崩 reading 'code'）
dsh-session-migrator fix-turn-end            # 先看
dsh-session-migrator fix-turn-end --apply

# 修复写错编码的项目目录名
dsh-session-migrator fix-project-key --apply

# 把某些会话 id 挂进指定工作区（默认追加，--prepend 置顶）
dsh-session-migrator mount --path "E:\\work\\proj" --apply

# 删除导入进来的 WorkBuddy 子代理会话
dsh-session-migrator remove-subagents --apply
```

每个子命令都有独立的 `--help`，例如 `dsh-session-migrator import --help`。

### 常用可选参数

- `import --sources a,b`：限定来源（默认全部）
- `import --pilot`：每条来源各试点 1 条
- `import --only <id>`：只导某一条原始会话
- `import --force`：覆盖已存在的同名会话文件（默认跳过）
- `import --no-workspace`：只生成会话文件，不动 workspace.json
- `mount --prepend`：把导入的会话放到侧边栏最前

## 安全模型

1. **默认 dry-run。** 所有会写盘/删文件的命令，不加 `--apply` 都只打印计划。
2. **备份。** 改写 `workspace.json` 前先复制为 `workspace.json.bak-<tag>-<iso>`；
   改写会话文件前复制为 `<file>.bak-<tag>`。
3. **删除需显式确认。** `remove-subagents` 要 `--apply` 才删；`fix-project-key` 合并时遇到冲突会拒绝覆盖。
4. **必须强制重启 DSH。** DSH 运行中会把 `workspace.json` 缓存在内存里，正常退出时会**写回内存副本**，
   冲掉你刚改的内容。所以写入后请**彻底强杀再重开**：
   ```bat
   taskkill /F /IM "DeepSeek Harness.exe"
   ```
   重开之前**不要**新建/重命名/拖动工作区。工具只做提醒，不会替你杀进程。

## 环境变量

| 变量 | 默认值 | 作用 |
|---|---|---|
| `DSH_HOME` | `~/.dsh` | DSH 根目录 |
| `DSH_SESSIONS_ROOT` | `$DSH_HOME/sessions` | 会话根目录 |
| `DSH_WORKSPACE_JSON` | `$DSH_HOME/storages/workspace.json` | 工作区索引 |
| `CSR_SCRIPT` | 自动探测 | chat-share-reader 的 `sessions.mjs` |
| `OPENCODE_DB` | `~/.local/share/opencode/opencode.db` | opencode 数据库 |
| `ZCODE_DB` | `~/.zcode/cli/db/db.sqlite` | zcode 数据库 |
| `WORKBUDDY_PROJECTS` | `~/.workbuddy/projects` | WorkBuddy 存储 |
| `IMPORT_FALLBACK_ROOT` | `~/.dsh-session-migrator/imports` | 无法定位原目录时的归置处 |

## 排障

- **打开会话报 `Cannot read properties of undefined (reading 'code')`**
  → 有 `turn/end {reason:{kind:'error'}}` 但没有 `error.code`。跑 `dsh-session-migrator fix-turn-end --apply`。
- **DSH 启动报 `corrupt session log ... header id ... and cwd identify ...`，服务一直 pending**
  → 项目目录名不是规范 `projectKey`（含非 ASCII 时被写成了原始字节）。跑 `fix-project-key --apply`。
- **导入的会话在侧边栏不出现**
  → 会话 id 没进 `workspace.json`。用 `mount --path <该项目路径> --apply` 手动挂载。
- **改了 workspace.json 但 DSH 里没变化 / 又变回去了**
  → DSH 没强杀重启，退出时把内存副本写回了。见「安全模型」第 4 条。
- **`chat-share-reader CLI not found`**
  → 设 `CSR_SCRIPT` 指向 `.../chat-share-reader/scripts/sessions.mjs`，或先安装该 skill。

## 目录结构

```
bin/cli.mjs              命令行入口（子命令分发、--help）
src/config.mjs           路径解析（全部来自环境变量）
src/project-key.mjs      projectKey / projectDir
src/v4.mjs               v4 构建/写入/读取/校验
src/workspace.mjs        workspace.json 读写（备份、合并）
src/csr.mjs              chat-share-reader CLI 封装
src/cwd.mjs              从各来源恢复原始 cwd
src/commands/*.mjs       各子命令
docs/DSH-FORMAT.md       v4 格式规范
```

## English (short)

`dsh-session-migrator` imports local AI-agent chat histories (WorkBuddy, pi,
Codex `.jsonl`/`.jsonl.zst`, opencode, zcode, Claude Code, Cursor) into
**DeepSeek Harness** as native v4 sessions. DSH ships no importer for these
sources; this tool fills that gap, preserves each conversation's original
project grouping, and registers sessions in `workspace.json`.

Highlights: Node ≥ 22, zero third-party deps; every mutating command is
**dry-run by default** (`--apply` to write) with timestamped backups; supports
**Codex `.jsonl.zst`** (a gap in many popular importers). After rewriting
`workspace.json` you must **force-restart DSH** so it doesn't persist its stale
in-memory copy on exit.

```bash
node bin/cli.mjs doctor
node bin/cli.mjs import --sources workbuddy,codex --apply
node bin/cli.mjs scan
```

## License

MIT © 2026 mapleleo-hub
