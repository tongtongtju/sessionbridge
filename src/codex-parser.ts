// ============================================================
// codex-parser.ts - 解析 Codex JSONL 会话
// ============================================================

import fs from "fs";
import readline from "readline";
import type {
  CodexRecord,
  CodexResponseItem,
  CodexEventMsg,
  CodexTurnContext,
  ParsedSession,
  ParsedTurn,
  ParsedToolCall,
} from "./types.js";

/**
 * 解析 Codex JSONL 文件为结构化会话
 */
export async function parseCodexSession(
  filePath: string
): Promise<ParsedSession> {
  const session: ParsedSession = {
    sessionId: "",
    cwd: "",
    model: "",
    startTime: "",
    endTime: "",
    turns: [],
    filesChanged: [],
  };

  let currentTurn: ParsedTurn | null = null;
  let pendingToolCallMap = new Map<string, ParsedToolCall>();
  const fileSet = new Set<string>();

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, "utf-8"),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let record: CodexRecord;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    switch (record.type) {
      case "session_meta": {
        session.sessionId = record.payload.id;
        session.cwd = record.payload.cwd;
        session.startTime = record.timestamp;
        if (record.payload.git) {
          session.gitBranch = record.payload.git.branch;
          session.gitCommitHash = record.payload.git.commit_hash;
        }
        break;
      }

      case "turn_context": {
        const tc = record as CodexTurnContext;
        if (tc.payload.model) {
          session.model = tc.payload.model;
        }
        break;
      }

      case "event_msg": {
        const em = record as CodexEventMsg;
        const pType = em.payload.type;

        if (pType === "user_message") {
          // 新 turn 开始
          if (currentTurn) {
            flushTurn(currentTurn, session, pendingToolCallMap);
          }
          currentTurn = {
            index: session.turns.length,
            userMessage: em.payload.message || "",
            timestamp: em.timestamp,
            assistantMessages: [],
            toolCalls: [],
            reasoningCount: 0,
          };
          session.endTime = em.timestamp;
        }
        break;
      }

      case "response_item": {
        const ri = record as CodexResponseItem;
        if (!currentTurn) break;

        switch (ri.payload.type) {
          case "message": {
            if (ri.payload.role === "assistant" && ri.payload.content) {
              const text = ri.payload.content
                .filter((b) => b.type === "output_text" && b.text)
                .map((b) => b.text)
                .join("\n");
              if (text) {
                currentTurn.assistantMessages.push(text);
              }
            }
            break;
          }

          case "function_call": {
            const tc: ParsedToolCall = {
              toolName: ri.payload.name || "unknown",
              arguments: ri.payload.arguments || "{}",
              timestamp: ri.timestamp,
            };
            if (ri.payload.call_id) {
              pendingToolCallMap.set(ri.payload.call_id, tc);
            } else {
              currentTurn.toolCalls.push(tc);
            }
            break;
          }

          case "function_call_output": {
            if (ri.payload.call_id && pendingToolCallMap.has(ri.payload.call_id)) {
              const tc = pendingToolCallMap.get(ri.payload.call_id)!;
              tc.output = ri.payload.output || "";
              currentTurn.toolCalls.push(tc);
              pendingToolCallMap.delete(ri.payload.call_id);
            }
            break;
          }

          case "custom_tool_call": {
            const tc: ParsedToolCall = {
              toolName: ri.payload.name || "custom",
              arguments: ri.payload.input || "",
              timestamp: ri.timestamp,
            };
            if (ri.payload.call_id) {
              pendingToolCallMap.set(ri.payload.call_id, tc);
            } else {
              currentTurn.toolCalls.push(tc);
            }
            break;
          }

          case "custom_tool_call_output": {
            if (ri.payload.call_id && pendingToolCallMap.has(ri.payload.call_id)) {
              const tc = pendingToolCallMap.get(ri.payload.call_id)!;
              tc.output = ri.payload.output || "";
              currentTurn.toolCalls.push(tc);
              pendingToolCallMap.delete(ri.payload.call_id);
            }
            break;
          }

          case "reasoning": {
            currentTurn.reasoningCount++;
            break;
          }
        }
        break;
      }
    }
  }

  // flush 最后一个 turn
  if (currentTurn) {
    flushTurn(currentTurn, session, pendingToolCallMap);
  }

  // 从工具调用中提取变更的文件
  extractChangedFiles(session);

  return session;
}

function flushTurn(
  turn: ParsedTurn,
  session: ParsedSession,
  pendingToolCallMap: Map<string, ParsedToolCall>
) {
  // 把残留的未配对工具调用也加入
  for (const tc of pendingToolCallMap.values()) {
    turn.toolCalls.push(tc);
  }
  pendingToolCallMap.clear();
  session.turns.push(turn);
}

/**
 * 从工具调用参数和 apply_patch 内容中提取变更的文件
 */
function extractChangedFiles(session: ParsedSession): void {
  const fileSet = new Set<string>();

  for (const turn of session.turns) {
    for (const tc of turn.toolCalls) {
      // apply_patch 中包含文件路径
      if (tc.toolName === "apply_patch") {
        const patchContent = tc.arguments;
        const matches = patchContent.matchAll(
          /\*\*\s*(?:Add|Delete|Update|Move|Rename)\s*File:\s*(.+)/g
        );
        for (const m of matches) {
          fileSet.add(m[1].trim());
        }
      }

      // exec_command 中可能有文件路径
      if (tc.toolName === "exec_command") {
        try {
          const args = JSON.parse(tc.arguments);
          // 提取常见的文件操作命令中的文件名
          const cmd = args.cmd || "";
          const writePatterns = [
            />\s*([^\s&|;]+)/g,          // echo > file
            /tee\s+([^\s]+)/g,            // tee file
            /cat\s*>\s*([^\s]+)/g,        // cat > file
          ];
          for (const pat of writePatterns) {
            const m = cmd.matchAll(pat);
            for (const match of m) {
              const f = match[1];
              if (!f.startsWith("-") && f.includes(".")) {
                fileSet.add(f);
              }
            }
          }
        } catch {
          // skip
        }
      }
    }
  }

  session.filesChanged = Array.from(fileSet);
}
