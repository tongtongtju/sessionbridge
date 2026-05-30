// ============================================================
// session-discovery.ts - 查找 Codex 会话
// ============================================================

import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fs from "fs";
import type { DiscoveredSession } from "./types.js";

function getCodexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function getSQLitePath(): string {
  return path.join(getCodexHome(), "state_5.sqlite");
}

/**
 * 通过 SQLite 查找会话（优先）
 */
export function findSessionById(sessionId: string): DiscoveredSession | null {
  const dbPath = getSQLitePath();

  if (!fs.existsSync(dbPath)) {
    return findSessionByFileScan(sessionId);
  }

  try {
    const db = new Database(dbPath, { readonly: true });
    const row = db
      .prepare(
        `SELECT id, rollout_path, cwd, title, updated_at, model_provider, git_branch
         FROM threads WHERE id = ?`
      )
      .get(sessionId) as Record<string, unknown> | undefined;
    db.close();

    if (row) {
      return {
        id: row.id as string,
        rolloutPath: row.rollout_path as string,
        cwd: row.cwd as string,
        title: row.title as string,
        updatedAt: row.updated_at as number,
        modelProvider: row.model_provider as string,
        gitBranch: row.git_branch as string | undefined,
      };
    }
  } catch {
    // SQLite 查询失败，fallback
  }

  return findSessionByFileScan(sessionId);
}

/**
 * Fallback: 扫描文件系统查找会话
 */
function findSessionByFileScan(sessionId: string): DiscoveredSession | null {
  const sessionsDir = path.join(getCodexHome(), "sessions");

  if (!fs.existsSync(sessionsDir)) {
    return null;
  }

  const files = walkDir(sessionsDir);
  const match = files.find((f) => f.includes(sessionId));

  if (!match) return null;

  // 从 JSONL 第一行提取元数据
  try {
    const firstLine = fs.readFileSync(match, "utf-8").split("\n")[0];
    const meta = JSON.parse(firstLine);
    if (meta.type === "session_meta") {
      return {
        id: meta.payload.id,
        rolloutPath: match,
        cwd: meta.payload.cwd || "",
        title: "",
        updatedAt: 0,
        modelProvider: meta.payload.model_provider || "",
        gitBranch: meta.payload.git?.branch,
      };
    }
  } catch {
    // 解析失败
  }

  return null;
}

/**
 * 列出最近的 Codex 会话
 */
export function listRecentSessions(limit = 20): DiscoveredSession[] {
  const dbPath = getSQLitePath();

  if (!fs.existsSync(dbPath)) {
    return listSessionsByFileScan(limit);
  }

  try {
    const db = new Database(dbPath, { readonly: true });
    const rows = db
      .prepare(
        `SELECT id, rollout_path, cwd, title, updated_at, model_provider, git_branch
         FROM threads
         WHERE archived = 0
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(limit) as Record<string, unknown>[];

    db.close();

    return rows.map((row) => ({
      id: row.id as string,
      rolloutPath: row.rollout_path as string,
      cwd: row.cwd as string,
      title: row.title as string,
      updatedAt: row.updated_at as number,
      modelProvider: row.model_provider as string,
      gitBranch: row.git_branch as string | undefined,
    }));
  } catch {
    return listSessionsByFileScan(limit);
  }
}

/**
 * Fallback: 通过文件系统列出会话
 */
function listSessionsByFileScan(limit: number): DiscoveredSession[] {
  const sessionsDir = path.join(getCodexHome(), "sessions");
  if (!fs.existsSync(sessionsDir)) return [];

  const files = walkDir(sessionsDir);
  const sessions: DiscoveredSession[] = [];

  for (const file of files.slice(0, limit * 2)) {
    if (sessions.length >= limit) break;
    try {
      const firstLine = fs.readFileSync(file, "utf-8").split("\n")[0];
      const meta = JSON.parse(firstLine);
      if (meta.type === "session_meta") {
        const stat = fs.statSync(file);
        sessions.push({
          id: meta.payload.id,
          rolloutPath: file,
          cwd: meta.payload.cwd || "",
          title: "",
          updatedAt: stat.mtimeMs,
          modelProvider: meta.payload.model_provider || "",
          gitBranch: meta.payload.git?.branch,
        });
      }
    } catch {
      // skip
    }
  }

  return sessions.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}

/**
 * 递归获取目录下所有 .jsonl 文件
 */
function walkDir(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      results.push(...walkDir(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      results.push(fullPath);
    }
  }

  return results;
}
