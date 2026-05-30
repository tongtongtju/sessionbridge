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

# Session Bridge — Bidirectional Session Migration

Migrate development sessions between OpenAI Codex CLI and Claude Code, preserving conversations, tool calls, and file changes.

## Prerequisites

Before first use, ensure dependencies are installed:

```bash
cd "$SKILL_DIR/../.." && npm install
```

## Commands

### Codex → Claude (`cx2cl`)
Import a Codex session into Claude Code.

### Claude → Codex (`cl2cx`)
Export a Claude Code session to Codex format.

## Instructions

### Direction 1: Codex → Claude

**List available Codex sessions:**
```bash
cd "$SKILL_DIR/../.." && npx tsx src/index.ts cx2cl --list
```

**Inject into current session (default):**
```bash
cd "$SKILL_DIR/../.." && npx tsx src/index.ts cx2cl "<SESSION_ID>"
```

**Create new Claude session file:**
```bash
cd "$SKILL_DIR/../.." && npx tsx src/index.ts cx2cl "<SESSION_ID>" --new-session
```

### Direction 2: Claude → Codex

**List available Claude sessions:**
```bash
cd "$SKILL_DIR/../.." && npx tsx src/index.ts cl2cx --list
```

**Create new Codex session (default):**
```bash
cd "$SKILL_DIR/../.." && npx tsx src/index.ts cl2cx "<SESSION_ID>"
```

**Inject summary into current conversation:**
```bash
cd "$SKILL_DIR/../.." && npx tsx src/index.ts cl2cx "<SESSION_ID>" --inject
```

### After execution

**For inject mode:** Read the output Markdown summary, then tell the user the context has been loaded and they can continue.

**For new session mode:** Tell the user the new session ID and how to resume it (`claude -r <id>` for Claude sessions, `codex resume` for Codex sessions).
