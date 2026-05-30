// ============================================================
// context-builder.ts - 构建 Codex 会话上下文摘要（注入模式）
// ============================================================

import type { ParsedSession, ParsedTurn, ParsedToolCall } from "./types.js";

/**
 * 将解析后的 Codex 会话生成结构化 Markdown 摘要
 */
export function buildContextSummary(session: ParsedSession): string {
  const lines: string[] = [];

  // 标题
  lines.push("# Codex Session Context Import");
  lines.push("");
  lines.push("以下是之前在 **OpenAI Codex CLI** 中的会话上下文，请理解并继续开发。");
  lines.push("");

  // 会话信息
  lines.push("## Session Info");
  lines.push(`- **Session ID**: ${session.sessionId}`);
  lines.push(`- **Project**: \`${session.cwd}\``);
  lines.push(`- **Model**: ${session.model}`);
  if (session.gitBranch) {
    lines.push(`- **Git Branch**: ${session.gitBranch}`);
  }
  if (session.gitCommitHash) {
    lines.push(`- **Git Commit**: ${session.gitCommitHash.slice(0, 8)}`);
  }
  lines.push(
    `- **Time**: ${formatTime(session.startTime)} ~ ${formatTime(session.endTime)}`
  );
  lines.push(`- **Total Turns**: ${session.turns.length}`);
  lines.push("");

  // 对话摘要
  lines.push("## Conversation History");
  lines.push("");

  for (const turn of session.turns) {
    lines.push(`### Turn ${turn.index + 1}`);
    lines.push("");

    // 用户消息
    const userMsg = truncate(turn.userMessage, 500);
    lines.push(`**User**: ${userMsg}`);
    lines.push("");

    // 助手回复
    if (turn.assistantMessages.length > 0) {
      const assistantText = turn.assistantMessages
        .map((m) => truncate(m, 1000))
        .join("\n\n");
      lines.push(`**Assistant**: ${assistantText}`);
      lines.push("");
    }

    // 工具调用
    if (turn.toolCalls.length > 0) {
      lines.push("**Tool Calls**:");
      for (const tc of turn.toolCalls) {
        lines.push(formatToolCall(tc));
      }
      lines.push("");
    }

    if (turn.reasoningCount > 0) {
      lines.push(
        `> (${turn.reasoningCount} reasoning step${turn.reasoningCount > 1 ? "s" : ""} - encrypted, skipped)`
      );
      lines.push("");
    }
  }

  // 变更的文件
  if (session.filesChanged.length > 0) {
    lines.push("## Files Changed");
    lines.push("");
    for (const f of session.filesChanged) {
      lines.push(`- \`${f}\``);
    }
    lines.push("");
  }

  // 当前状态
  lines.push("## Current State");
  lines.push("");
  const lastTurn = session.turns[session.turns.length - 1];
  if (lastTurn) {
    const lastAssistant = lastTurn.assistantMessages
      .filter((m) => m.trim())
      .pop();
    if (lastAssistant) {
      lines.push(
        `最后的工作是：${truncate(lastAssistant, 300)}`
      );
    } else if (lastTurn.toolCalls.length > 0) {
      const lastTool = lastTurn.toolCalls[lastTurn.toolCalls.length - 1];
      lines.push(
        `最后的操作是调用 \`${lastTool.toolName}\``
      );
    }
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(
    "以上是 Codex 会话的完整上下文。请基于这些信息继续开发。"
  );

  return lines.join("\n");
}

function formatToolCall(tc: ParsedToolCall): string {
  const lines: string[] = [];
  lines.push(`- **${tc.toolName}**`);

  // 解析参数，提取关键信息
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(tc.arguments);
  } catch {
    // apply_patch 的 input 不是 JSON
    if (tc.toolName === "apply_patch") {
      // 提取文件名
      const fileMatches = tc.arguments.matchAll(
        /\*\*\s*(?:Add|Delete|Update)\s*File:\s*(.+)/g
      );
      const files = Array.from(fileMatches).map((m) => m[1].trim());
      if (files.length > 0) {
        lines.push(`  - Files: ${files.map((f) => `\`${f}\``).join(", ")}`);
      }
      lines.push(`  - Patch preview: ${truncate(tc.arguments, 300)}`);
      if (tc.output !== undefined) {
        lines.push(`  - Result: ${truncate(tc.output, 200)}`);
      }
      return lines.join("\n");
    }
    lines.push(`  - Args: ${truncate(tc.arguments, 200)}`);
    if (tc.output !== undefined) {
      lines.push(`  - Result: ${truncate(tc.output, 200)}`);
    }
    return lines.join("\n");
  }

  // 格式化参数
  if (tc.toolName === "exec_command") {
    lines.push(`  - Command: \`${truncate(String(args.cmd || ""), 200)}\``);
    if (tc.output !== undefined) {
      lines.push(`  - Result: ${truncate(tc.output, 300)}`);
    }
  } else {
    // 通用格式
    const keys = Object.keys(args).slice(0, 3);
    for (const key of keys) {
      const val = String(args[key]);
      lines.push(`  - ${key}: \`${truncate(val, 150)}\``);
    }
    if (tc.output !== undefined) {
      lines.push(`  - Result: ${truncate(tc.output, 200)}`);
    }
  }

  return lines.join("\n");
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...(truncated)";
}

function formatTime(iso: string): string {
  if (!iso) return "unknown";
  try {
    const d = new Date(iso);
    return d.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
