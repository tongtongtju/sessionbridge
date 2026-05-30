// ============================================================
// claude-reader.ts - 解析 Claude Code JSONL 会话
// ============================================================

import fs from "fs";
import readline from "readline";
import path from "path";
import os from "os";
import type {
  ParsedSession,
  ParsedTurn,
  ParsedToolCall,
} from "./types.js";

/**
 * 解析 Claude Code JSONL 文件为结构化会话
 *
 * Claude Code 的特点：
 * - assistant 可能拆成多条记录（thinking / text / tool_use 分别独立）
 * - tool_result 在 user 记录的 content 数组里
 * - 每条记录有 parentUuid 形成 DAG 链
 */
export async function parseClaudeSession(
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

  // 收集所有记录
  const records: Record<string, unknown>[] = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, "utf-8"),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      continue;
    }
  }

  // 提取 sessionId 和元数据
  for (const rec of records) {
    const r = rec as Record<string, unknown>;
    if (r.sessionId && !session.sessionId) {
      session.sessionId = r.sessionId as string;
    }
    if (r.cwd && !session.cwd) {
      session.cwd = r.cwd as string;
    }
    if (r.gitBranch && !session.gitBranch) {
      session.gitBranch = r.gitBranch as string;
    }
    if (r.timestamp) {
      if (!session.startTime || r.timestamp < session.startTime) {
        session.startTime = r.timestamp as string;
      }
      if (!session.endTime || r.timestamp > session.endTime) {
        session.endTime = r.timestamp as string;
      }
    }
  }

  // 按 type 分类处理
  // 策略：找到 user(text) 记录作为 turn 起点，收集后续的 assistant 记录
  let currentTurn: ParsedTurn | null = null;
  // tool_use_id → ParsedToolCall（用于配对 tool_result）
  const toolCallMap = new Map<string, ParsedToolCall>();
  let turnIndex = 0;

  for (let i = 0; i < records.length; i++) {
    const rec = records[i] as Record<string, unknown>;
    const type = rec.type as string;

    if (type === "user") {
      const msg = rec.message as Record<string, unknown> | undefined;
      if (!msg) continue;

      const content = msg.content;

      // 判断是纯文本 user 还是 tool_result
      if (typeof content === "string") {
        // 新 turn：纯文本用户消息
        if (currentTurn) {
          session.turns.push(currentTurn);
        }
        currentTurn = {
          index: turnIndex++,
          userMessage: content,
          timestamp: (rec.timestamp as string) || "",
          assistantMessages: [],
          toolCalls: [],
          reasoningCount: 0,
        };
      } else if (Array.isArray(content)) {
        // tool_result 记录
        for (const block of content) {
          if (
            typeof block === "object" &&
            block !== null &&
            (block as Record<string, unknown>).type === "tool_result"
          ) {
            const b = block as Record<string, unknown>;
            const toolUseId = b.tool_use_id as string;
            if (toolUseId && toolCallMap.has(toolUseId) && currentTurn) {
              const tc = toolCallMap.get(toolUseId)!;
              tc.output = (b.content as string) || "";
              // 不重复 push，已经在 function_call 时 push 过了
            }
          }
        }
      }
    } else if (type === "assistant") {
      if (!currentTurn) continue;

      const msg = rec.message as Record<string, unknown> | undefined;
      if (!msg) continue;

      // 提取 model
      if (msg.model && !session.model) {
        session.model = msg.model as string;
      }

      const content = msg.content;
      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (typeof block !== "object" || block === null) continue;
        const b = block as Record<string, unknown>;

        switch (b.type) {
          case "text": {
            if (b.text && currentTurn) {
              currentTurn.assistantMessages.push(b.text as string);
            }
            break;
          }
          case "thinking": {
            if (currentTurn) {
              currentTurn.reasoningCount++;
            }
            break;
          }
          case "tool_use": {
            if (!currentTurn) break;
            const tc: ParsedToolCall = {
              toolName: (b.name as string) || "unknown",
              arguments: JSON.stringify(b.input || {}),
              timestamp: (rec.timestamp as string) || "",
            };
            if (b.id) {
              toolCallMap.set(b.id as string, tc);
            }
            currentTurn.toolCalls.push(tc);
            break;
          }
        }
      }
    }
  }

  // flush 最后一个 turn
  if (currentTurn) {
    session.turns.push(currentTurn);
  }

  // 从工具调用中提取变更文件
  extractChangedFilesFromClaude(session);

  return session;
}

function extractChangedFilesFromClaude(session: ParsedSession): void {
  const fileSet = new Set<string>();

  for (const turn of session.turns) {
    for (const tc of turn.toolCalls) {
      try {
        const input = JSON.parse(tc.arguments);

        // Edit / Write tools
        if (tc.toolName === "Edit" || tc.toolName === "Write") {
          if (input.file_path) fileSet.add(input.file_path as string);
        }

        // Bash commands with file operations
        if (tc.toolName === "Bash" && input.command) {
          const cmd = input.command as string;
          // Simple heuristic for file writes in bash
          const patterns = [/>\s*([^\s&|;"]+)/g, /tee\s+([^\s]+)/g];
          for (const pat of patterns) {
            for (const m of cmd.matchAll(pat)) {
              const f = m[1];
              if (!f.startsWith("-") && f.includes(".")) {
                fileSet.add(f);
              }
            }
          }
        }
      } catch {
        // skip
      }
    }
  }

  session.filesChanged = Array.from(fileSet);
}

/**
 * 发现 Claude Code 会话
 * 扫描 ~/.claude/projects/<slug>/<uuid>.jsonl
 */
export function findClaudeSessionById(
  sessionId: string
): { filePath: string; cwd: string } | null {
  const projectsDir = path.join(
    process.env.CLAUDE_HOME || path.join(os.homedir(), ".claude"),
    "projects"
  );

  if (!fs.existsSync(projectsDir)) return null;

  const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(projectsDir, entry.name, `${sessionId}.jsonl`);
    if (fs.existsSync(candidate)) {
      // 从 slug 还原 cwd
      const cwd = entry.name.replace(/^-/, "/").replace(/-/g, "/");
      return { filePath: candidate, cwd };
    }
  }
  return null;
}

/**
 * 列出最近的 Claude Code 会话
 */
export function listRecentClaudeSessions(
  limit = 20
): Array<{
  id: string;
  filePath: string;
  cwd: string;
  updatedAt: number;
  model?: string;
  gitBranch?: string;
}> {
  const projectsDir = path.join(
    process.env.CLAUDE_HOME || path.join(os.homedir(), ".claude"),
    "projects"
  );
  if (!fs.existsSync(projectsDir)) return [];

  const sessions: Array<{
    id: string;
    filePath: string;
    cwd: string;
    updatedAt: number;
    model?: string;
    gitBranch?: string;
  }> = [];

  const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(projectsDir, entry.name);
    const files = fs.readdirSync(dir);
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const fp = path.join(dir, f);
      try {
        const stat = fs.statSync(fp);
        const id = f.replace(".jsonl", "");
        const slug = entry.name;
        // 从 slug 还原 cwd: -Users-foo-bar → /Users/foo/bar
        const cwd = slug.replace(/^-/, "/").replace(/-/g, "/");

        // 快速提取 model 和 gitBranch
        let model: string | undefined;
        let gitBranch: string | undefined;
        const content = fs.readFileSync(fp, "utf-8");
        const lines = content.split("\n");
        for (const line of lines.slice(0, 30)) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.gitBranch && !gitBranch) gitBranch = obj.gitBranch;
            if (obj.message?.model && !model) model = obj.message.model;
          } catch {
            break;
          }
        }

        sessions.push({
          id,
          filePath: fp,
          cwd,
          updatedAt: stat.mtimeMs,
          model,
          gitBranch,
        });
      } catch {
        // skip
      }
    }
  }

  return sessions.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}
