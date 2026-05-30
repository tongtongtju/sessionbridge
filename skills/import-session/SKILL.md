---
name: import-session
description: Bidirectional session migration between Codex CLI and Claude Code
user-invocable: true
argument-hint: "<direction> <session-id> [options]"
allowed-tools:
  - Bash
  - Read
---

# Session Bridge - Bidirectional Migration

Migrate sessions between OpenAI Codex CLI and Claude Code, in both directions.

## Commands

### Codex → Claude (cx2cl)
Import a Codex session into Claude Code.

### Claude → Codex (cl2cx)
Export a Claude Code session to Codex format.

## Instructions

### Direction 1: Codex → Claude

**List available Codex sessions:**
```bash
cd /Users/songyuntong1/WebProjects/myself-thing/codexsession2cc && npx tsx src/index.ts cx2cl --list
```

**Inject into current session (default):**
```bash
cd /Users/songyuntong1/WebProjects/myself-thing/codexsession2cc && npx tsx src/index.ts cx2cl "<SESSION_ID>"
```

**Create new Claude session file:**
```bash
cd /Users/songyuntong1/WebProjects/myself-thing/codexsession2cc && npx tsx src/index.ts cx2cl "<SESSION_ID>" --new-session
```

### Direction 2: Claude → Codex

**List available Claude sessions:**
```bash
cd /Users/songyuntong1/WebProjects/myself-thing/codexsession2cc && npx tsx src/index.ts cl2cx --list
```

**Create new Codex session (default):**
```bash
cd /Users/songyuntong1/WebProjects/myself-thing/codexsession2cc && npx tsx src/index.ts cl2cx "<SESSION_ID>"
```

**Inject summary into current conversation:**
```bash
cd /Users/songyuntong1/WebProjects/myself-thing/codexsession2cc && npx tsx src/index.ts cl2cx "<SESSION_ID>" --inject
```

### After execution

**For inject mode:** Read the output Markdown summary, then tell the user the context has been loaded and they can continue.

**For new session mode:** Tell the user the new session ID and how to resume it.
