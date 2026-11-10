/**
 * MACA 数据模型 — Zod schemas + inferred types
 */

import { z } from "zod";

// ── 枚举 ──────────────────────────────────────────────

export const TaskStatus = z.enum([
  "pending",
  "in_progress",
  "awaiting_review",
  "completed",
  "failed",
  "blocked",
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const TaskPriority = z.enum(["critical", "high", "medium", "low"]);
export type TaskPriority = z.infer<typeof TaskPriority>;

export const AgentRole = z.enum([
  "planner",
  "developer",
  "tester",
  "documenter",
  "project_manager",
  "orchestrator",
]);
export type AgentRole = z.infer<typeof AgentRole>;

export const MessageType = z.enum([
  "task_assign",
  "task_result",
  "task_query",
  "status_update",
  "review_request",
  "review_response",
  "error",
  "broadcast",
  "heartbeat",
]);
export type MessageType = z.infer<typeof MessageType>;

// ── 工具函数 ──────────────────────────────────────────

let _counter = 0;
function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(++_counter).toString(36)}`;
}

// ── 任务模型 (recursive Zod schema) ──────────────────

export interface TaskRequirement {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: TaskPriority;
}

// Recursive: Task can have children Tasks
export interface Task {
  id: string;
  parentId: string | null;
  title: string;
  description: string;
  role: AgentRole;
  status: TaskStatus;
  priority: TaskPriority;
  dependsOn: string[];
  context: Record<string, unknown>;
  result: Record<string, unknown> | null;
  children: Task[];
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  retryCount: number;
  maxRetries: number;
}

export function createTask(partial: Partial<Task> & { title: string; description: string }): Task {
  return {
    id: uid("task"),
    parentId: null,
    role: "developer",
    status: "pending",
    priority: "medium",
    dependsOn: [],
    context: {},
    result: null,
    children: [],
    createdAt: new Date(),
    startedAt: null,
    completedAt: null,
    retryCount: 0,
    maxRetries: 3,
    ...partial,
  };
}

export function flattenTasks(task: Task): Task[] {
  const result: Task[] = [task];
  for (const child of task.children) {
    result.push(...flattenTasks(child));
  }
  return result;
}

export function findTask(tree: Task, taskId: string): Task | null {
  if (tree.id === taskId) return tree;
  for (const child of tree.children) {
    const found = findTask(child, taskId);
    if (found) return found;
  }
  return null;
}

export function isLeafTask(task: Task): boolean {
  return task.children.length === 0;
}

// ── 消息模型 ──────────────────────────────────────────

export interface Message {
  id: string;
  msgType: MessageType;
  sender: AgentRole;
  receiver: AgentRole;
  taskId: string | null;
  content: Record<string, unknown>;
  timestamp: Date;
  replyTo: string | null;
  correlationId: string | null;
}

export function createMessage(
  partial: Partial<Message> & { msgType: MessageType; sender: AgentRole; receiver: AgentRole }
): Message {
  return {
    id: uid("msg"),
    taskId: null,
    content: {},
    timestamp: new Date(),
    replyTo: null,
    correlationId: null,
    ...partial,
  };
}

// ── 项目模型 ──────────────────────────────────────────

export interface ProjectConfig {
  name: string;
  language: string;
  framework: string | null;
  outputDir: string;
  constraints: string[];
  codingStandards: string[];
}

export function createProjectConfig(partial?: Partial<ProjectConfig>): ProjectConfig {
  return {
    name: "untitled",
    language: "python",
    framework: null,
    outputDir: "./output",
    constraints: [],
    codingStandards: [],
    ...partial,
  };
}

export interface ProjectContext {
  id: string;
  config: ProjectConfig;
  requirements: TaskRequirement[];
  taskTree: Task | null;
  artifacts: Record<string, string>;
  logs: string[];
  status: TaskStatus;
  createdAt: Date;
  completedAt: Date | null;
}

export function createProjectContext(partial?: Partial<ProjectContext>): ProjectContext {
  return {
    id: uid("proj"),
    config: createProjectConfig(),
    requirements: [],
    taskTree: null,
    artifacts: {},
    logs: [],
    status: "pending",
    createdAt: new Date(),
    completedAt: null,
    ...partial,
  };
}
