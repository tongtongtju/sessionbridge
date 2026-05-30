# Claude Code 插件开发与分发指南

这份文档记录 `sessionbridge` 项目在实现 Claude Code 插件市场安装、斜杠命令注册、技能加载和开源分发时的完整经验。内容基于 Claude Code 官方插件文档、官方 marketplace 文档，以及本项目实际排查过程中遇到的问题。

适用目标：

- 希望把本项目做成可开源分发的 Claude Code 插件
- 希望用户可以通过 `/plugin marketplace add owner/repo` 和 `/plugin install plugin@marketplace` 安装
- 希望安装后可以直接使用 `/plugin-name:command-name` 形式的斜杠命令
- 希望理解 `commands`、`skills`、`marketplace.json`、`plugin.json` 的关系

---

## 1. Claude Code 插件是什么

Claude Code 插件是一个可安装的扩展包，可以包含以下组件：

| 组件 | 用途 | 用户如何触发 |
|---|---|---|
| `commands` | 用户可直接输入的斜杠命令 | `/plugin-name:command-name` |
| `skills` | 给 Claude 注入任务知识、工作流、说明 | 可以被模型按需调用，也可能出现在 Skill 工具中 |
| `agents` | 子代理定义 | Claude Code 调用 Agent |
| `hooks` | 工具调用、会话生命周期等事件回调 | 自动触发 |
| `mcpServers` | 插件内置 MCP 服务 | Claude Code 工具系统调用 |
| `lspServers` | 语言服务 | 编辑/代码辅助能力 |

本项目最需要的是：

1. 一个用户可直接执行的斜杠命令：`/sessionbridge:import-session`
2. 一个说明性 skill：告诉 Claude 如何执行迁移逻辑
3. marketplace 支持：让别人可以从 GitHub 安装

---

## 2. 插件市场与插件的关系

Claude Code 有两个层级：

```text
Marketplace 仓库
└── Plugin 插件
    ├── commands
    ├── skills
    ├── hooks
    └── ...
```

一个 marketplace 可以包含多个 plugin，也可以像 `sessionbridge` 这样，一个仓库既是 marketplace，也是唯一 plugin。

### 2.1 GitHub 安装流程

用户侧安装命令：

```text
/plugin marketplace add tongtongtju/sessionbridge
/plugin install sessionbridge@sessionbridge
/reload-plugins
```

含义：

| 命令 | 说明 |
|---|---|
| `/plugin marketplace add tongtongtju/sessionbridge` | 把 GitHub 仓库作为插件市场添加到本地 |
| `/plugin install sessionbridge@sessionbridge` | 从 `sessionbridge` 市场安装名为 `sessionbridge` 的插件 |
| `/reload-plugins` | 重新加载已启用插件 |

`plugin@marketplace` 中：

- `sessionbridge` before `@` 是插件名
- `sessionbridge` after `@` 是 marketplace 名

---

## 3. 推荐目录结构

本项目当前采用“单仓库同时作为 marketplace 和 plugin”的结构：

```text
sessionbridge/
├── .claude-plugin/
│   ├── marketplace.json          # 插件市场清单
│   └── plugin.json               # 插件自身清单
├── commands/
│   └── import-session.md         # 用户可直接输入的斜杠命令
├── skills/
│   └── import-session/
│       └── SKILL.md              # Claude 可加载的任务说明
├── src/                          # 插件实际执行逻辑
├── package.json
├── package-lock.json
├── README.md
└── CLAUDE_CODE_PLUGIN_GUIDE.md
```

官方文档中 marketplace 文件位置是：

```text
.claude-plugin/marketplace.json
```

不要放在仓库根目录的 `marketplace.json`，除非你确认当前 Claude Code 版本支持该布局。官方文档示例使用 `.claude-plugin/marketplace.json`。

---

## 4. marketplace.json 写法

`marketplace.json` 描述“这个仓库提供哪些插件，以及插件从哪里获取”。

本项目推荐格式：

```json
{
  "name": "sessionbridge",
  "id": "sessionbridge",
  "owner": {
    "name": "tongtongtju"
  },
  "metadata": {
    "description": "Bidirectional session migration between OpenAI Codex CLI and Claude Code",
    "version": "1.4.0"
  },
  "plugins": [
    {
      "name": "sessionbridge",
      "source": "./",
      "description": "Bidirectional session migration between OpenAI Codex CLI and Claude Code. Preserve conversations, tool calls, and file changes.",
      "version": "1.4.0",
      "author": {
        "name": "tongtongtju"
      },
      "keywords": [
        "codex",
        "claude-code",
        "session",
        "migration",
        "plugin"
      ],
      "category": "workflow",
      "commands": ["./commands"],
      "skills": ["./skills/import-session"]
    }
  ]
}
```

### 4.1 关键字段

| 字段 | 含义 |
|---|---|
| `name` | marketplace 名称，用户安装时 `@` 后面的名字 |
| `owner.name` | 维护者 |
| `plugins` | marketplace 暴露的插件列表 |
| `plugins[].name` | 插件名，用户安装时 `@` 前面的名字 |
| `plugins[].source` | 插件来源，`./` 表示当前仓库根目录就是插件根目录 |
| `plugins[].version` | 插件版本，强烈建议每次发布安装结构变更时递增 |
| `plugins[].commands` | command 目录路径 |
| `plugins[].skills` | skill 目录路径 |

### 4.2 source 的写法

常见写法：

```json
"source": "./"
```

表示 plugin 就在 marketplace 仓库根目录。

如果是多插件市场：

```json
"source": "./plugins/my-plugin"
```

如果插件来自另一个 GitHub 仓库：

```json
"source": {
  "source": "github",
  "repo": "owner/plugin-repo"
}
```

---

## 5. plugin.json 写法

`plugin.json` 描述插件自身的能力，是 Claude Code 加载插件组件的核心 manifest。

本项目推荐格式：

```json
{
  "name": "sessionbridge",
  "description": "Bidirectional session migration between OpenAI Codex CLI and Claude Code",
  "version": "1.4.0",
  "author": { "name": "songyuntong1" },
  "license": "MIT",
  "keywords": ["codex", "claude-code", "session", "migration"],
  "commands": ["./commands"],
  "skills": ["./skills/import-session"]
}
```

### 5.1 commands 与 skills 要同时声明吗？

对于本项目，建议同时声明：

- `commands`：保证用户可以输入 `/sessionbridge:import-session`
- `skills`：让 Claude 拥有迁移任务的背景知识和工作流说明

如果只依赖 `skills` 来生成用户可调用 slash command，旧版本 Claude Code 中存在注册不稳定问题。`commands` 是更直接、更可靠的斜杠命令机制。

---

## 6. commands：用户可直接输入的斜杠命令

### 6.1 command 文件位置

```text
commands/import-session.md
```

安装后命令名会自动带插件命名空间：

```text
/sessionbridge:import-session
```

其中：

- `sessionbridge` 来自 `plugin.json` 的 `name`
- `import-session` 来自文件名 `import-session.md`

### 6.2 command 文件示例

```markdown
---
allowed-tools: Bash, Read
description: Bidirectional session migration between Codex CLI and Claude Code
argument-hint: "<direction> <session-id> [options]"
---

# Session Bridge

Run the sessionbridge CLI from the installed plugin directory.

Arguments provided by the user: `$ARGUMENTS`

## Usage

- `cx2cl --list`: list recent Codex sessions
- `cx2cl <session-id>`: inject a Codex session summary into the current Claude conversation
- `cx2cl <session-id> --new-session`: create a new Claude Code JSONL session file
- `cl2cx --list`: list recent Claude Code sessions
- `cl2cx <session-id>`: create a new Codex JSONL session file
- `cl2cx <session-id> --inject`: inject a Claude session summary into the current conversation

## Task

Execute:

```bash
cd "${CLAUDE_PLUGIN_ROOT}" && npm install && npx tsx src/index.ts $ARGUMENTS
```

Then report the result to the user.
```

### 6.3 `$ARGUMENTS`

用户输入：

```text
/sessionbridge:import-session cx2cl --list
```

在 command 文件中，`$ARGUMENTS` 会被替换为：

```text
cx2cl --list
```

### 6.4 `${CLAUDE_PLUGIN_ROOT}`

插件安装后会被复制到 Claude Code 的缓存目录，不会直接在 GitHub 仓库目录运行。

因此 command 里不要写死本地路径，例如：

```bash
cd /Users/xxx/sessionbridge
```

应该使用：

```bash
cd "${CLAUDE_PLUGIN_ROOT}"
```

---

## 7. skills：Claude 可加载的能力说明

### 7.1 skill 文件位置

```text
skills/import-session/SKILL.md
```

### 7.2 skill frontmatter 示例

```markdown
---
name: import-session
description: Bidirectional session migration between Codex CLI and Claude Code
user-invocable: true
argument-hint: "<direction> <session-id> [options]"
allowed-tools:
  - Bash
  - Read
license: MIT
---
```

### 7.3 注意：不要把 skill 目录命名成双重命名空间

旧版本 Claude Code 存在一个已知问题：plugin skill 可能无法注册成用户可输入的 slash command。网上有人提到 workaround：

```text
skills/sessionbridge:import-session/SKILL.md
```

这个 workaround 会造成新版本里出现双重命名空间：

```text
sessionbridge:sessionbridge:import-session
```

所以在新版本中应恢复标准目录：

```text
skills/import-session/SKILL.md
```

并用 `commands/import-session.md` 来注册用户可调用斜杠命令。

---

## 8. 用户安装与使用流程

### 8.1 安装 marketplace

```text
/plugin marketplace add tongtongtju/sessionbridge
```

### 8.2 安装插件

```text
/plugin install sessionbridge@sessionbridge
```

### 8.3 重载插件

```text
/reload-plugins
```

期望结果应类似：

```text
Reloaded: 1 plugin · ...
```

如果使用 `commands`，不一定要关注 `skills` 数量；关键是 slash command 是否出现并可执行。

### 8.4 使用命令

```text
/sessionbridge:import-session cx2cl --list
/sessionbridge:import-session cx2cl <codex-session-id>
/sessionbridge:import-session cx2cl <codex-session-id> --new-session
/sessionbridge:import-session cl2cx --list
/sessionbridge:import-session cl2cx <claude-session-id>
/sessionbridge:import-session cl2cx <claude-session-id> --inject
```

---

## 9. 本项目踩过的坑与解决方案

### 9.1 `Unknown skill: sessionbridge:import-session`

#### 现象

用户输入：

```text
/sessionbridge:import-session cx2cl --list
```

返回：

```text
Unknown skill: sessionbridge:import-session
```

#### 原因

最开始只定义了 `skills/import-session/SKILL.md`，期望 skill 自动注册为用户可输入命令。

但旧版本 Claude Code 中存在 plugin skill slash command 注册问题：skill 能出现在系统上下文或 Skill 工具里，却不一定能通过 `/plugin-name:skill-name` 触发。

#### 解决方案

新增官方 `commands` 组件：

```text
commands/import-session.md
```

并在 `plugin.json` 中声明：

```json
"commands": ["./commands"]
```

### 9.2 双重命名空间：`sessionbridge:sessionbridge:import-session`

#### 现象

系统里出现：

```text
sessionbridge:sessionbridge:import-session
```

#### 原因

为了绕过旧 bug，曾经把目录命名为：

```text
skills/sessionbridge:import-session/
```

Claude Code 又自动添加 plugin namespace，导致双重命名空间。

#### 解决方案

恢复标准目录：

```text
skills/import-session/
```

不要把 plugin 名写进 skill 目录名。

### 9.3 `/reload-plugins` 后仍然加载旧版本

#### 现象

已经改了 GitHub 代码，但本地安装仍然使用旧 `plugin.json`。

#### 原因

Claude Code 会缓存 plugin：

```text
~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/
```

如果 `version` 不变，Claude Code 可能认为不需要更新。

#### 解决方案

插件结构变更时递增版本号：

```json
"version": "1.4.0"
```

同时建议执行：

```text
/plugin marketplace update sessionbridge
/plugin update sessionbridge@sessionbridge
/reload-plugins
```

如果本地测试阶段仍然异常，可以删除本地缓存后重装：

```bash
rm -rf ~/.claude/plugins/cache/sessionbridge
rm -rf ~/.claude/plugins/marketplaces/sessionbridge
```

### 9.4 插件显示 Disabled，但 enable 时报 already enabled

#### 现象

Claude Code 插件 UI 显示：

```text
Status: Disabled
Failed to enable: Plugin "sessionbridge@sessionbridge" is already enabled at user scope
```

#### 原因

不同 settings scope 之间有冲突，例如：

```text
~/.claude/settings.json
project/.claude/settings.json
project/.claude/settings.local.json
```

其中某个 scope 启用，另一个 scope 禁用，导致 UI 状态和实际状态冲突。

#### 解决方案

检查所有 settings：

```bash
grep -R "sessionbridge@sessionbridge" ~/.claude/settings.json .claude/settings.json .claude/settings.local.json
```

删除冲突项，只保留一个 scope。

开源仓库里不要提交 `.claude/settings.json` 或 `.claude/settings.local.json`，否则可能影响用户项目。

### 9.5 `Plugin sessionbridge not found in marketplace sessionbridge`

#### 现象

`/doctor` 显示：

```text
Plugin sessionbridge not found in marketplace sessionbridge
```

#### 原因

本地 marketplace clone 不完整、缓存损坏，或者 `marketplace.json` 中 `plugins[].name` 与安装命令不一致。

#### 检查点

安装命令：

```text
/plugin install sessionbridge@sessionbridge
```

需要对应：

```json
{
  "name": "sessionbridge",
  "plugins": [
    {
      "name": "sessionbridge"
    }
  ]
}
```

如果 marketplace 目录不存在，说明 add 没有真正 clone 成功：

```bash
ls ~/.claude/plugins/marketplaces/sessionbridge
```

### 9.6 `npm install` 不会自动执行

#### 现象

插件安装成功，但运行 command 时依赖缺失。

#### 原因

Marketplace 安装 GitHub 插件时只是复制/缓存插件文件，不会自动执行 `npm install`，除非 source 类型是 npm package。

#### 当前方案

在 command 中执行：

```bash
cd "${CLAUDE_PLUGIN_ROOT}" && npm install && npx tsx src/index.ts $ARGUMENTS
```

优点：用户不需要手动安装依赖。

缺点：第一次运行会慢一点。

未来优化方向：把插件发布成 npm package，marketplace source 改为：

```json
"source": {
  "source": "npm",
  "package": "sessionbridge"
}
```

---

## 10. 调试命令清单

### 10.1 查看 Claude Code 版本

```bash
claude --version
```

建议使用较新的 Claude Code。旧版本的 plugin marketplace 和 skill slash command 行为不稳定。

### 10.2 查看 marketplace clone

```bash
find ~/.claude/plugins/marketplaces/sessionbridge -maxdepth 4 -type f
```

### 10.3 查看 plugin cache

```bash
find ~/.claude/plugins/cache/sessionbridge -maxdepth 6 -type f
```

### 10.4 查看安装注册表

```bash
cat ~/.claude/plugins/installed_plugins.json
```

### 10.5 查看 settings 冲突

```bash
grep -R "sessionbridge@sessionbridge" \
  ~/.claude/settings.json \
  .claude/settings.json \
  .claude/settings.local.json
```

### 10.6 插件诊断

在 Claude Code 内执行：

```text
/doctor
```

### 10.7 重载插件

```text
/reload-plugins
```

### 10.8 更新 marketplace 和 plugin

```text
/plugin marketplace update sessionbridge
/plugin update sessionbridge@sessionbridge
/reload-plugins
```

---

## 11. 发布流程建议

每次改动插件结构时：

1. 修改 `plugin.json`
2. 修改 `marketplace.json`
3. 确保两边 version 一致
4. 递增版本号
5. 提交并推送 GitHub
6. 本地清理旧缓存或执行 update
7. 重新安装测试

推荐版本策略：

| 改动类型 | 版本变更 |
|---|---|
| 文档或页面 | 不一定需要改 plugin version |
| command/skill 路径变化 | 必须改 plugin version |
| marketplace source 变化 | 必须改 plugin version |
| CLI 运行逻辑变化 | 建议改 plugin version |
| 依赖变化 | 建议改 plugin version |

---

## 12. sessionbridge 当前推荐配置

### 12.1 `.claude-plugin/plugin.json`

```json
{
  "name": "sessionbridge",
  "description": "Bidirectional session migration between OpenAI Codex CLI and Claude Code",
  "version": "1.4.0",
  "author": { "name": "songyuntong1" },
  "license": "MIT",
  "keywords": ["codex", "claude-code", "session", "migration"],
  "commands": ["./commands"],
  "skills": ["./skills/import-session"]
}
```

### 12.2 `.claude-plugin/marketplace.json`

```json
{
  "name": "sessionbridge",
  "id": "sessionbridge",
  "owner": {
    "name": "tongtongtju"
  },
  "metadata": {
    "description": "Bidirectional session migration between OpenAI Codex CLI and Claude Code",
    "version": "1.4.0"
  },
  "plugins": [
    {
      "name": "sessionbridge",
      "source": "./",
      "description": "Bidirectional session migration between OpenAI Codex CLI and Claude Code. Preserve conversations, tool calls, and file changes.",
      "version": "1.4.0",
      "author": {
        "name": "tongtongtju"
      },
      "keywords": [
        "codex",
        "claude-code",
        "session",
        "migration",
        "plugin"
      ],
      "category": "workflow",
      "commands": ["./commands"],
      "skills": ["./skills/import-session"]
    }
  ]
}
```

### 12.3 `commands/import-session.md`

```markdown
---
allowed-tools: Bash, Read
description: Bidirectional session migration between Codex CLI and Claude Code
argument-hint: "<direction> <session-id> [options]"
---

# Session Bridge

Arguments provided by the user: `$ARGUMENTS`

Execute:

```bash
cd "${CLAUDE_PLUGIN_ROOT}" && npm install && npx tsx src/index.ts $ARGUMENTS
```
```

---

## 13. Sources

- Claude Code plugin marketplace docs: https://code.claude.com/docs/en/plugin-marketplaces
- Claude Code plugin reference docs: https://code.claude.com/docs/en/plugins-reference
- Claude Code skills docs: https://code.claude.com/docs/en/skills
- Known issue: plugin skills may not register as user-invocable slash commands in older versions: https://github.com/anthropics/claude-code/issues/38501
