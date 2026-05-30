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
