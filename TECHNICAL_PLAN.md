# sessionbridge - 技术方案

## 一、背景与目标

### 1.1 问题
OpenAI Codex CLI 和 Claude Code 的会话格式完全不互通：
- 存储路径不同（`~/.codex/sessions/` vs `~/.claude/projects/`）
- JSONL 记录类型不同（`response_item` vs `user/assistant`）
- Session ID 版本不同（UUID v7 vs UUID v4）
- 索引方式不同（SQLite vs 纯文件）

### 1.2 目标
构建一个 Claude Code 插件 `sessionbridge`，实现**双向会话迁移**：

| 方向 | 命令 | 默认模式 |
|------|------|----------|
| Codex → Claude | `cx2cl` | 注入当前会话 |
| Claude → Codex | `cl2cx` | 生成新会话文件 |

每个方向都支持注入模式和文件生成模式。

---

## 二、会话格式对比

### 2.1 Codex JSONL

**路径：** `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`
**索引：** `~/.codex/state_5.sqlite` (threads 表)
**ID：** UUID v7

| 记录类型 | 作用 |
|----------|------|
| `session_meta` | 会话元数据 (id, cwd, model, git) |
| `turn_context` | turn 级配置 (model, sandbox) |
| `event_msg/user_message` | 用户消息 |
| `event_msg/agent_message` | 助手中间消息 |
| `response_item/message` | 用户/助手消息 (input_text/output_text) |
| `response_item/function_call` | 工具调用 (name, arguments, call_id) |
| `response_item/function_call_output` | 工具结果 (call_id, output) |
| `response_item/custom_tool_call` | 自定义工具 (apply_patch) |
| `response_item/reasoning` | 推理过程 (加密) |

### 2.2 Claude Code JSONL

**路径：** `~/.claude/projects/<slug>/<uuid>.jsonl`
**索引：** 无 SQLite，纯文件
**ID：** UUID v4
**结构：** parentUuid DAG 链

| 记录类型 | 作用 |
|----------|------|
| `user` (string content) | 用户消息 |
| `user` (tool_result array) | 工具结果 |
| `assistant` (text block) | 助手文本回复 |
| `assistant` (thinking block) | 思考过程 |
| `assistant` (tool_use block) | 工具调用 |
| `system` | 系统事件 |
| `progress` | Hook 进度 |
| `file-history-snapshot` | 文件快照 |

---

## 三、核心映射

### 3.1 消息映射

| Codex | Claude |
|-------|--------|
| `event_msg/user_message` | `user` (string content) |
| `response_item/message/assistant` (output_text) | `assistant` (text block) |
| `response_item/reasoning` | `assistant` (thinking block) — 加密，用占位符 |
| `response_item/function_call` | `assistant` (tool_use block) |
| `response_item/function_call_output` | `user` (tool_result array) |

### 3.2 工具名映射

| Codex → Claude | Claude → Codex |
|----------------|----------------|
| `exec_command` → `Bash` | `Bash` → `exec_command` |
| `apply_patch` → `Edit` | `Edit` → `apply_patch` |
| `read_file` → `Read` | `Read` → `read_file` |
| `write_file` → `Write` | `Write` → `write_file` |
| `list_directory` → `Glob` | `Grep` → `exec_command` |

---

## 四、项目结构

```
sessionbridge/
├── .claude-plugin/plugin.json
├── skills/import-session/SKILL.md
├── src/
│   ├── index.ts                # 主入口，CLI 命令分发 (cx2cl / cl2cx)
│   ├── types.ts                # 双向类型定义 + 工具名映射
│   ├── codex-parser.ts         # Codex → ParsedSession
│   ├── claude-reader.ts        # Claude → ParsedSession
│   ├── context-builder.ts      # ParsedSession → Markdown 摘要 (注入模式)
│   ├── claude-writer.ts        # ParsedSession → Claude JSONL (cx2cl 新会话)
│   ├── codex-writer.ts         # ParsedSession → Codex JSONL (cl2cx 新会话)
│   └── session-discovery.ts    # Codex 会话发现 (SQLite + 文件)
├── docs/index.html             # 项目介绍页
├── TECHNICAL_PLAN.md           # 本文件
├── package.json
└── tsconfig.json
```

### 模块职责

| 文件 | 方向 | 职责 |
|------|------|------|
| `codex-parser.ts` | Codex→Claude | 流式读取 Codex JSONL，提取 turns/toolCalls/files |
| `claude-reader.ts` | Claude→Codex | 读取 Claude JSONL，合并拆分的 assistant 记录，配对 tool_result |
| `context-builder.ts` | 双向 | ParsedSession → 结构化 Markdown 摘要 |
| `claude-writer.ts` | Codex→Claude | ParsedSession → Claude JSONL + DAG 链 + UUID v4 |
| `codex-writer.ts` | Claude→Codex | ParsedSession → Codex JSONL + session_meta + SQLite 注册 |

---

## 五、命令设计

```
npx tsx src/index.ts <command> <session-id> [options]

# cx2cl (Codex → Claude)
cx2cl --list                    # 列出 Codex 会话
cx2cl <id>                      # 注入当前会话 (默认)
cx2cl <id> --new-session        # 生成 Claude JSONL

# cl2cx (Claude → Codex)
cl2cx --list                  # 列出 Claude 会话
cl2cx <id>                    # 生成 Codex JSONL (默认)
cl2cx <id> --inject           # 注入当前会话
```

---

## 六、已知限制

| 限制 | 原因 |
|------|------|
| 推理内容丢失 | Codex 加密 reasoning；Claude thinking 可保留文本 |
| 工具映射不完美 | apply_patch ↔ Edit 格式差异 |
| Web 搜索缺失 | Codex JSONL 不含搜索结果 |
| 子代理结构 | 两者子代理体系不同 |
| Claude slug 还原 | `claude-reader.ts` 中 slug→cwd 的还原可能不完全准确 |
