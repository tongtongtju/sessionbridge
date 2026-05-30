// ============================================================
// claude-writer.ts - 生成 Claude Code JSONL 会话文件（新会话模式）
// ============================================================

import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import type {
  ParsedSession,
  ParsedTurn,
  ParsedToolCall,
  ClaudeRecord,
  ClaudeContentBlock,
  ClaudeToolResultBlock,
} from "./types.js";
import { TOOL_NAME_MAP } from "./types.js";

function uuidV4(): string {
  return crypto.randomUUID();
}

/**
 * 将解析后的 Codex 会话写入 Claude Code JSONL 格式
 * 返回新 session ID 和文件路径
 */
export function writeClaudeSession(
  session: ParsedSession
): { sessionId: string; filePath: string } {
  const claudeSessionId = uuidV4();
  const slug = pathToSlug(session.cwd);
  const projectDir = path.join(os.homedir(), ".claude", "projects", slug);

  // 确保目录存在
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }

  const filePath = path.join(projectDir, `${claudeSessionId}.jsonl`);
  const records = convertToClaudeRecords(session, claudeSessionId);

  // 写入 JSONL
  const ws = fs.createWriteStream(filePath, "utf-8");
  for (const record of records) {
    ws.write(JSON.stringify(record) + "\n");
  }
  ws.end();

  return { sessionId: claudeSessionId, filePath };
}

interface ConversionState {
  previousUuid: string | null;
  sessionId: string;
  cwd: string;
  model: string;
  gitBranch: string | undefined;
  // call_id → assistant record uuid (用于配对 tool_result)
  toolCallToAssistantUuid: Map<string, string>;
}

/**
 * 将 ParsedSession 转换为 Claude JSONL 记录序列
 */
function convertToClaudeRecords(
  session: ParsedSession,
  claudeSessionId: string
): ClaudeRecord[] {
  const records: ClaudeRecord[] = [];
  const state: ConversionState = {
    previousUuid: null,
    sessionId: claudeSessionId,
    cwd: session.cwd,
    model: session.model,
    gitBranch: session.gitBranch,
    toolCallToAssistantUuid: new Map(),
  };

  for (const turn of session.turns) {
    processTurn(turn, state, records);
  }

  return records;
}

function processTurn(
  turn: ParsedTurn,
  state: ConversionState,
  records: ClaudeRecord[]
): void {
  const ts = turn.timestamp;

  // 1. User message
  const userUuid = uuidV4();
  const userRecord: ClaudeRecord = {
    parentUuid: state.previousUuid,
    isSidechain: false,
    type: "user",
    message: {
      role: "user",
      content: turn.userMessage,
    },
    uuid: userUuid,
    timestamp: ts,
    sessionId: state.sessionId,
    cwd: state.cwd,
    promptId: uuidV4(),
  };
  records.push(userRecord);
  state.previousUuid = userUuid;

  // 2. Assistant message (文本部分) + tool_use
  const contentBlocks: ClaudeContentBlock[] = [];

  // 助手文本回复
  for (const msg of turn.assistantMessages) {
    contentBlocks.push({ type: "text", text: msg });
  }

  // 工具调用
  for (const tc of turn.toolCalls) {
    const claudeToolName = TOOL_NAME_MAP[tc.toolName] || tc.toolName;
    const toolId = uuidV4();

    let input: Record<string, unknown>;
    try {
      const parsed = JSON.parse(tc.arguments);
      if (tc.toolName === "exec_command") {
        input = { command: parsed.cmd || "" };
      } else {
        input = parsed;
      }
    } catch {
      input = { raw: tc.arguments };
    }

    contentBlocks.push({
      type: "tool_use",
      id: toolId,
      name: claudeToolName,
      input,
    });

    state.toolCallToAssistantUuid.set(tc.toolName + tc.timestamp, toolId);
  }

  // 如果有内容才生成 assistant 记录
  if (contentBlocks.length > 0) {
    const assistantUuid = uuidV4();
    const assistantRecord: ClaudeRecord = {
      parentUuid: state.previousUuid,
      isSidechain: false,
      type: "assistant",
      message: {
        id: `msg_${Date.now()}${Math.random().toString(36).slice(2, 8)}`,
        type: "message",
        role: "assistant",
        model: state.model,
        content: contentBlocks,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
      uuid: assistantUuid,
      timestamp: ts,
      sessionId: state.sessionId,
      cwd: state.cwd,
    };
    records.push(assistantRecord);
    state.previousUuid = assistantUuid;

    // 3. Tool results (如果有工具调用且有输出)
    const toolResults: ClaudeToolResultBlock[] = [];
    for (const tc of turn.toolCalls) {
      if (tc.output !== undefined) {
        const toolKey = tc.toolName + tc.timestamp;
        const toolUseId =
          state.toolCallToAssistantUuid.get(toolKey) || uuidV4();

        toolResults.push({
          tool_use_id: toolUseId,
          type: "tool_result",
          content: tc.output,
        });
      }
    }

    if (toolResults.length > 0) {
      const resultUuid = uuidV4();
      const resultRecord: ClaudeRecord = {
        parentUuid: state.previousUuid,
        isSidechain: false,
        type: "user",
        message: {
          role: "user",
          content: toolResults,
        },
        uuid: resultUuid,
        timestamp: ts,
        sessionId: state.sessionId,
        cwd: state.cwd,
        sourceToolAssistantUUID: state.previousUuid,
        toolUseResult: {
          mode: "content",
          numFiles: 0,
          filenames: [],
          content: toolResults.map((r) => r.content).join("\n"),
          numLines: toolResults.reduce(
            (sum, r) => sum + r.content.split("\n").length,
            0
          ),
        },
      };
      records.push(resultRecord);
      state.previousUuid = resultUuid;
    }
  }
}

/**
 * 将文件路径转换为 Claude 的 slug 格式
 * /Users/foo/myproject → -Users-foo-myproject
 */
function pathToSlug(p: string): string {
  return p.replace(/\//g, "-").replace(/[^a-zA-Z0-9._-]/g, "-");
}
