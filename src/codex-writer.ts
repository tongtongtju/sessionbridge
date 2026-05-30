// ============================================================
// codex-writer.ts - 写入 Codex JSONL 会话文件
// ============================================================

import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import Database from "better-sqlite3";
import type { ParsedSession, ParsedTurn, ParsedToolCall } from "./types.js";
import { TOOL_NAME_MAP_REVERSE } from "./types.js";

function uuidV7(): string {
  // 简易 UUID v7: 时间戳前48bit + 随机后80bit
  const now = Date.now();
  const hex = now.toString(16).padStart(12, "0");
  const random = crypto.randomBytes(10).toString("hex");
  // 设置版本 (0111) 和变体 (10)
  const bytes = Buffer.from(hex + random, "hex");
  bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const result = bytes.toString("hex");
  return `${result.slice(0, 8)}-${result.slice(8, 12)}-${result.slice(12, 16)}-${result.slice(16, 20)}-${result.slice(20)}`;
}

/**
 * 将解析后的 Claude 会话写入 Codex JSONL 格式
 */
export function writeCodexSession(
  session: ParsedSession
): { sessionId: string; filePath: string } {
  const codexSessionId = uuidV7();
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");

  // 生成目标路径
  const now = new Date();
  const dateDir = path.join(
    codexHome,
    "sessions",
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  );

  if (!fs.existsSync(dateDir)) {
    fs.mkdirSync(dateDir, { recursive: true });
  }

  const timestamp = now.toISOString().replace(/:/g, "-").replace(/\..+/, "");
  const fileName = `rollout-${timestamp}-${codexSessionId}.jsonl`;
  const filePath = path.join(dateDir, fileName);

  // 写入 JSONL
  const ws = fs.createWriteStream(filePath, "utf-8");

  // 1. session_meta
  const sessionMeta = {
    timestamp: now.toISOString(),
    type: "session_meta",
    payload: {
      id: codexSessionId,
      timestamp: now.toISOString(),
      cwd: session.cwd,
      originator: "codex2claude_import",
      cli_version: "0.80.0",
      source: "cli",
      model_provider: "imported",
      git: session.gitBranch
        ? {
            commit_hash: session.gitCommitHash || "",
            branch: session.gitBranch,
            repository_url: "",
          }
        : undefined,
    },
  };
  ws.write(JSON.stringify(sessionMeta) + "\n");

  // 2. 写入每个 turn
  for (const turn of session.turns) {
    writeTurn(ws, turn, session, codexSessionId);
  }

  ws.end();

  // 3. 注册到 SQLite
  registerInSQLite(codexHome, codexSessionId, filePath, session);

  // 4. 追加到 session_index.jsonl
  const indexPath = path.join(codexHome, "session_index.jsonl");
  const indexEntry = {
    session_id: codexSessionId,
    path: filePath,
    timestamp: now.toISOString(),
  };
  fs.appendFileSync(indexPath, JSON.stringify(indexEntry) + "\n");

  return { sessionId: codexSessionId, filePath };
}

function writeTurn(
  ws: fs.WriteStream,
  turn: ParsedTurn,
  session: ParsedSession,
  _codexSessionId: string
): void {
  const ts = turn.timestamp || new Date().toISOString();

  // turn_context
  const turnContext = {
    timestamp: ts,
    type: "turn_context",
    payload: {
      cwd: session.cwd,
      approval_policy: "on-request",
      sandbox_policy: {
        type: "workspace-write",
        network_access: false,
      },
      model: session.model || "unknown",
      summary: "auto",
    },
  };
  ws.write(JSON.stringify(turnContext) + "\n");

  // task_started
  ws.write(
    JSON.stringify({
      timestamp: ts,
      type: "event_msg",
      payload: { type: "task_started" },
    }) + "\n"
  );

  // user_message
  ws.write(
    JSON.stringify({
      timestamp: ts,
      type: "event_msg",
      payload: {
        type: "user_message",
        message: turn.userMessage,
        images: [],
      },
    }) + "\n"
  );

  // response_item: user message
  ws.write(
    JSON.stringify({
      timestamp: ts,
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: turn.userMessage }],
      },
    }) + "\n"
  );

  // reasoning (如果有)
  if (turn.reasoningCount > 0) {
    ws.write(
      JSON.stringify({
        timestamp: ts,
        type: "response_item",
        payload: {
          type: "reasoning",
          encrypted_content: `[${turn.reasoningCount} reasoning steps imported from Claude Code]`,
        },
      }) + "\n"
    );
  }

  // assistant messages
  for (const msg of turn.assistantMessages) {
    ws.write(
      JSON.stringify({
        timestamp: ts,
        type: "event_msg",
        payload: { type: "agent_message", message: msg },
      }) + "\n"
    );

    ws.write(
      JSON.stringify({
        timestamp: ts,
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: msg }],
        },
      }) + "\n"
    );
  }

  // tool calls + results
  for (const tc of turn.toolCalls) {
    const codexToolName = TOOL_NAME_MAP_REVERSE[tc.toolName] || tc.toolName;

    // 转换参数格式
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(tc.arguments);
    } catch {
      args = { raw: tc.arguments };
    }

    // 反向转换参数
    if (codexToolName === "exec_command") {
      // Claude Bash → Codex exec_command
      const cmd = args.command || args.raw || "";
      args = {
        cmd: typeof cmd === "string" ? cmd : JSON.stringify(cmd),
        workdir: session.cwd,
        yield_time_ms: 1000,
        max_output_tokens: 10000,
      };
    }

    const callId = `call_${crypto.randomBytes(12).toString("hex")}`;

    // function_call
    ws.write(
      JSON.stringify({
        timestamp: ts,
        type: "response_item",
        payload: {
          type: "function_call",
          name: codexToolName,
          arguments: JSON.stringify(args),
          call_id: callId,
        },
      }) + "\n"
    );

    // function_call_output
    if (tc.output !== undefined) {
      ws.write(
        JSON.stringify({
          timestamp: ts,
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: callId,
            output: tc.output,
          },
        }) + "\n"
      );
    }
  }

  // task_complete
  ws.write(
    JSON.stringify({
      timestamp: ts,
      type: "event_msg",
      payload: { type: "task_complete" },
    }) + "\n"
  );
}

function registerInSQLite(
  codexHome: string,
  sessionId: string,
  rolloutPath: string,
  session: ParsedSession
): void {
  const dbPath = path.join(codexHome, "state_5.sqlite");
  if (!fs.existsSync(dbPath)) return;

  try {
    const db = new Database(dbPath);
    const now = Date.now();

    db.prepare(
      `INSERT OR REPLACE INTO threads
       (id, rollout_path, created_at, updated_at, source, model_provider, cwd,
        title, sandbox_policy, approval_mode, tokens_used, has_user_event, archived,
        git_branch, cli_version, model)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      sessionId,
      rolloutPath,
      now,
      now,
      "cli",
      "imported",
      session.cwd,
      truncate(session.turns[0]?.userMessage || "Imported from Claude Code", 200),
      "workspace-write",
      "on-request",
      0,
      1,
      0,
      session.gitBranch || "",
      "0.80.0",
      session.model || "unknown"
    );

    db.close();
  } catch {
    // SQLite 注册失败不影响文件写入
  }
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}
