#!/usr/bin/env node
// ============================================================
// index.ts - codex2claude 主入口（双向迁移）
// ============================================================

import { findSessionById, listRecentSessions } from "./session-discovery.js";
import { parseCodexSession } from "./codex-parser.js";
import { buildContextSummary } from "./context-builder.js";
import { writeClaudeSession } from "./claude-writer.js";
import {
  parseClaudeSession,
  findClaudeSessionById,
  listRecentClaudeSessions,
} from "./claude-reader.js";
import { writeCodexSession } from "./codex-writer.js";

const args = process.argv.slice(2);

async function main() {
  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  const command = args[0];

  // ─── codex → claude (默认方向) ───
  if (command === "cx2cl" || command === "codex2claude") {
    await handleCodex2Claude(args.slice(1));
  }
  // ─── claude → codex ───
  else if (command === "cl2cx" || command === "claude2codex") {
    await handleClaude2Codex(args.slice(1));
  }
  // ─── 兼容：直接传 session-id 默认走 codex2claude ───
  else if (command.startsWith("--")) {
    // --list-codex, --list-claude, --list
    if (command === "--list" || command === "--list-codex") {
      await listCodexSessions();
    } else if (command === "--list-claude") {
      await listClaudeSessions();
    } else {
      printUsage();
      process.exit(1);
    }
  } else {
    // 直接传了 session id，默认 codex2claude 注入模式
    await handleCodex2Claude(args);
  }
}

// ═══════════════════════════════════════════════════════════
//  Codex → Claude
// ═══════════════════════════════════════════════════════════

async function handleCodex2Claude(restArgs: string[]) {
  if (restArgs.length === 0 || restArgs[0] === "--list") {
    await listCodexSessions();
    return;
  }

  const sessionId = restArgs[0];
  const newSessionMode = restArgs.includes("--new-session");

  const session = findSessionById(sessionId);
  if (!session) {
    console.error(`Error: Codex session "${sessionId}" not found.`);
    console.error('Use "cx2cl --list" to see available sessions.');
    process.exit(1);
  }

  if (!session.rolloutPath) {
    console.error(
      `Error: Could not find rollout file for session "${sessionId}".`
    );
    process.exit(1);
  }

  const parsed = await parseCodexSession(session.rolloutPath);

  if (parsed.turns.length === 0) {
    console.error("Error: No conversation turns found in this session.");
    process.exit(1);
  }

  if (newSessionMode) {
    const result = writeClaudeSession(parsed);
    console.log("=== New Claude Session Created ===");
    console.log(`Session ID: ${result.sessionId}`);
    console.log(`File: ${result.filePath}`);
    console.log(`Project: ${parsed.cwd}`);
    console.log(`Turns: ${parsed.turns.length}`);
    console.log("");
    console.log("To continue, run:");
    console.log(`  cd ${parsed.cwd}`);
    console.log(`  claude -r ${result.sessionId}`);
  } else {
    const summary = buildContextSummary(parsed);
    console.log(summary);
  }
}

// ═══════════════════════════════════════════════════════════
//  Claude → Codex
// ═══════════════════════════════════════════════════════════

async function handleClaude2Codex(restArgs: string[]) {
  if (restArgs.length === 0 || restArgs[0] === "--list") {
    await listClaudeSessions();
    return;
  }

  const sessionId = restArgs[0];
  const injectMode = restArgs.includes("--inject");

  const found = findClaudeSessionById(sessionId);
  if (!found) {
    console.error(`Error: Claude session "${sessionId}" not found.`);
    console.error('Use "cl2cx --list" to see available sessions.');
    process.exit(1);
  }

  const parsed = await parseClaudeSession(found.filePath);

  if (parsed.turns.length === 0) {
    console.error("Error: No conversation turns found in this session.");
    process.exit(1);
  }

  if (injectMode) {
    // 注入模式：输出 Markdown 摘要
    const summary = buildContextSummary(parsed);
    console.log(summary);
  } else {
    // 默认：生成新的 Codex 会话
    const result = writeCodexSession(parsed);
    console.log("=== New Codex Session Created ===");
    console.log(`Session ID: ${result.sessionId}`);
    console.log(`File: ${result.filePath}`);
    console.log(`Project: ${parsed.cwd}`);
    console.log(`Turns: ${parsed.turns.length}`);
    console.log("");
    console.log("To continue, run:");
    console.log(`  cd ${parsed.cwd}`);
    console.log(`  codex resume ${result.sessionId}`);
  }
}

// ═══════════════════════════════════════════════════════════
//  列表
// ═══════════════════════════════════════════════════════════

async function listCodexSessions() {
  const sessions = listRecentSessions(20);
  if (sessions.length === 0) {
    console.log("No Codex sessions found.");
    return;
  }
  console.log("=== Recent Codex Sessions ===\n");
  for (const s of sessions) {
    const title = truncate(s.title || "(untitled)", 50);
    const project = truncate(s.cwd.split("/").pop() || s.cwd, 20);
    const time = formatTime(s.updatedAt);
    console.log(`  ${s.id}  ${title}  [${project}] (${time})`);
  }
  console.log(`\nTotal: ${sessions.length} sessions`);
}

async function listClaudeSessions() {
  const sessions = listRecentClaudeSessions(20);
  if (sessions.length === 0) {
    console.log("No Claude Code sessions found.");
    return;
  }
  console.log("=== Recent Claude Code Sessions ===\n");
  for (const s of sessions) {
    const project = truncate(s.cwd.split("/").pop() || s.cwd, 20);
    const time = formatTime(s.updatedAt);
    console.log(
      `  ${s.id}  [${project}] (${time})` +
        (s.model ? ` model=${s.model}` : "")
    );
  }
  console.log(`\nTotal: ${sessions.length} sessions`);
}

// ═══════════════════════════════════════════════════════════
//  工具
// ═══════════════════════════════════════════════════════════

function printUsage() {
  console.log("sessionbridge - Bidirectional session migration between Codex and Claude Code");
  console.log("");
  console.log("Usage:");
  console.log("  # Codex → Claude (default: inject | --new-session: create file)");
  console.log("  npx tsx src/index.ts cx2cl <codex-session-id> [--new-session]");
  console.log("  npx tsx src/index.ts cx2cl --list");
  console.log("");
  console.log("  # Claude → Codex (default: create file | --inject: output summary)");
  console.log("  npx tsx src/index.ts cl2cx <claude-session-id> [--inject]");
  console.log("  npx tsx src/index.ts cl2cx --list");
  console.log("");
  console.log("  # Shorthand: bare session-id defaults to codex2claude inject");
  console.log("  npx tsx src/index.ts <codex-session-id>");
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
