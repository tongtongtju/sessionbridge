// ============================================================
// types.ts - Codex / Claude 会话记录的 TypeScript 接口
// ============================================================

// --- Codex JSONL 记录类型 ---

export interface CodexSessionMeta {
  timestamp: string;
  type: "session_meta";
  payload: {
    id: string;
    timestamp: string;
    cwd: string;
    originator: string;
    cli_version: string;
    source: string;
    model_provider: string;
    instructions?: string;
    git?: {
      commit_hash: string;
      branch: string;
      repository_url: string;
    };
  };
}

export interface CodexTurnContext {
  timestamp: string;
  type: "turn_context";
  payload: {
    cwd: string;
    approval_policy: string;
    sandbox_policy?: Record<string, unknown>;
    model: string;
    summary?: string;
    user_instructions?: string;
  };
}

export interface CodexEventMsg {
  timestamp: string;
  type: "event_msg";
  payload: {
    type: string; // user_message | agent_message | token_count | task_started | task_complete | ...
    message?: string;
    images?: string[];
    info?: unknown;
    rate_limits?: unknown;
  };
}

export interface CodexResponseItem {
  timestamp: string;
  type: "response_item";
  payload: {
    type: string; // message | function_call | function_call_output | reasoning | custom_tool_call | custom_tool_call_output | web_search_call
    role?: string; // user | assistant | developer
    content?: CodexContentBlock[];
    name?: string;
    arguments?: string;
    call_id?: string;
    output?: string;
    input?: string;
    status?: string;
    encrypted_content?: string;
    summary?: Array<{ type: string; text: string }>;
    action?: { queries?: string[] };
  };
}

export interface CodexCompacted {
  timestamp: string;
  type: "compacted";
  payload?: unknown;
}

export type CodexRecord =
  | CodexSessionMeta
  | CodexTurnContext
  | CodexEventMsg
  | CodexResponseItem
  | CodexCompacted
  | { timestamp: string; type: string; payload?: unknown };

export interface CodexContentBlock {
  type: string; // input_text | output_text | ...
  text?: string;
}

// --- 解析后的结构化 Turn ---

export interface ParsedTurn {
  index: number;
  userMessage: string;
  timestamp: string;
  assistantMessages: string[];
  toolCalls: ParsedToolCall[];
  reasoningCount: number;
}

export interface ParsedToolCall {
  toolName: string;
  arguments: string;
  output?: string;
  timestamp: string;
}

export interface ParsedSession {
  sessionId: string;
  cwd: string;
  model: string;
  gitBranch?: string;
  gitCommitHash?: string;
  startTime: string;
  endTime: string;
  turns: ParsedTurn[];
  filesChanged: string[];
  totalTokensUsed?: number;
}

// --- Claude Code JSONL 记录类型 (用于 --new-session 模式) ---

export interface ClaudeUserRecord {
  parentUuid: string | null;
  isSidechain: boolean;
  type: "user";
  message: {
    role: "user";
    content: string | ClaudeToolResultBlock[];
  };
  uuid: string;
  timestamp: string;
  sessionId: string;
  cwd: string;
  promptId?: string;
  sourceToolAssistantUUID?: string;
  toolUseResult?: {
    mode: string;
    numFiles: number;
    filenames: string[];
    content: string;
    numLines: number;
  };
}

export interface ClaudeAssistantRecord {
  parentUuid: string | null;
  isSidechain: boolean;
  type: "assistant";
  message: {
    id: string;
    type: "message";
    role: "assistant";
    model: string;
    content: ClaudeContentBlock[];
    stop_reason: string | null;
    stop_sequence: string | null;
    usage: {
      input_tokens: number;
      output_tokens: number;
    };
  };
  uuid: string;
  timestamp: string;
  sessionId: string;
  cwd: string;
}

export interface ClaudeToolResultBlock {
  tool_use_id: string;
  type: "tool_result";
  content: string;
}

export interface ClaudeContentBlock {
  type: string; // text | thinking | tool_use
  text?: string;
  thinking?: string;
  signature?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export type ClaudeRecord = ClaudeUserRecord | ClaudeAssistantRecord;

// --- 会话发现 ---

export interface DiscoveredSession {
  id: string;
  rolloutPath: string;
  cwd: string;
  title: string;
  updatedAt: number;
  modelProvider: string;
  gitBranch?: string;
}

// --- 会话发现 (Claude) ---

export interface DiscoveredClaudeSession {
  id: string;
  filePath: string;
  cwd: string;
  updatedAt: number;
  model?: string;
  gitBranch?: string;
}

// --- 工具名映射 ---

export const TOOL_NAME_MAP: Record<string, string> = {
  exec_command: "Bash",
  apply_patch: "Edit",
  list_directory: "Glob",
  read_file: "Read",
  write_file: "Write",
  request_user_input: "AskUserQuestion",
};

// 反向映射: Claude → Codex
export const TOOL_NAME_MAP_REVERSE: Record<string, string> = {
  Bash: "exec_command",
  Edit: "apply_patch",
  Glob: "list_directory",
  Read: "read_file",
  Write: "write_file",
  Grep: "exec_command",
  AskUserQuestion: "request_user_input",
};
