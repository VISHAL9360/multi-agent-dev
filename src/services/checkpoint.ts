/**
 * 检查点管理器 — 断点续跑
 *
 * 每个任务完成后自动保存状态，系统崩溃后可以从上次中断的地方继续。
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import type { Task } from "../models/task.js";

export interface Checkpoint {
  projectId: string;
  requirement: string;
  taskTree: Task;
  completedTaskIds: string[];
  failedTaskIds: string[];
  currentTaskIndex: number;
  artifacts: Record<string, string>;
  reviewResults: Record<string, { score: number; issues: number }>;
  timestamp: number;
  version: number;
}

export class CheckpointManager {
  private dir: string;

  constructor(dir = ".maca") {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
  }

  /** 保存检查点 */
  save(checkpoint: Checkpoint): void {
    const path = resolve(this.dir, `${checkpoint.projectId}.json`);
    checkpoint.timestamp = Date.now();
    checkpoint.version = (checkpoint.version ?? 0) + 1;
    writeFileSync(path, JSON.stringify(checkpoint, null, 2), "utf-8");
  }

  /** 加载检查点 */
  load(projectId: string): Checkpoint | null {
    const path = resolve(this.dir, `${projectId}.json`);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as Checkpoint;
    } catch {
      return null;
    }
  }

  /** 列出所有保存的检查点 */
  list(): { projectId: string; timestamp: number; completed: number; total: number }[] {
    const { readdirSync } = require("fs");
    const files = readdirSync(this.dir).filter((f: string) => f.endsWith(".json"));
    return files.map((f: string) => {
      const c = JSON.parse(readFileSync(resolve(this.dir, f), "utf-8")) as Checkpoint;
      return {
        projectId: c.projectId,
        timestamp: c.timestamp,
        completed: c.completedTaskIds.length,
        total: flattenAll(c.taskTree).filter((t) => t.children.length === 0).length,
      };
    });
  }

  /** 删除检查点 */
  delete(projectId: string): void {
    const { unlinkSync } = require("fs");
    const path = resolve(this.dir, `${projectId}.json`);
    if (existsSync(path)) unlinkSync(path);
  }
}

function flattenAll(task: Task): Task[] {
  const r = [task];
  for (const c of task.children) r.push(...flattenAll(c));
  return r;
}
