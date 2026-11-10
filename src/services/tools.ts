/**
 * 工具调用系统 — Agent 可以真正执行操作
 *
 * 每个 Tool 有 name/description/parameters/execute，
 * Agent 通过 <tool_call> 标签触发工具调用。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { execSync } from "child_process";
import { resolve } from "path";

// ── 工具定义 ──────────────────────────────────

export interface ToolDef {
  name: string;
  description: string;
  parameters: Array<{
    name: string;
    type: "string" | "number" | "boolean";
    description: string;
    required: boolean;
  }>;
  execute: (params: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolResult {
  success: boolean;
  content: string;
  error?: string;
}

// ── 内置工具 ──────────────────────────────────

export const BUILTIN_TOOLS: ToolDef[] = [
  {
    name: "read_file",
    description: "读取项目中的代码文件",
    parameters: [
      { name: "path", type: "string", description: "文件路径（相对于项目根目录）", required: true },
    ],
    execute: async (params) => {
      const p = params["path"] as string;
      if (!existsSync(p)) return { success: false, content: "", error: `文件不存在: ${p}` };
      try {
        const content = readFileSync(p, "utf-8");
        return { success: true, content: content.slice(0, 3000) + (content.length > 3000 ? `\n... (共 ${content.length} 字符)` : "") };
      } catch (e) {
        return { success: false, content: "", error: String(e) };
      }
    },
  },
  {
    name: "write_file",
    description: "创建或覆盖代码文件",
    parameters: [
      { name: "path", type: "string", description: "文件路径", required: true },
      { name: "content", type: "string", description: "文件内容", required: true },
    ],
    execute: async (params) => {
      const p = params["path"] as string;
      const content = params["content"] as string;
      try {
        mkdirSync(resolve("."), { recursive: true });
        writeFileSync(p, content, "utf-8");
        return { success: true, content: `文件已写入: ${p} (${content.length} 字符)` };
      } catch (e) {
        return { success: false, content: "", error: String(e) };
      }
    },
  },
  {
    name: "run_command",
    description: "在项目目录运行 shell 命令（仅允许安全命令）",
    parameters: [
      { name: "command", type: "string", description: "要执行的命令（如 npm test, ls, cat）", required: true },
    ],
    execute: async (params) => {
      const cmd = (params["command"] as string).trim();
      // 安全校验：禁止危险命令
      const dangerous = [/rm -rf/, /del \//, /format/, />\/dev\/sd/, /:(){/, /curl.*\|.*sh/];
      for (const pattern of dangerous) {
        if (pattern.test(cmd)) {
          return { success: false, content: "", error: `命令被安全策略拦截: ${cmd}` };
        }
      }
      try {
        const result = execSync(cmd, { encoding: "utf-8", timeout: 10_000, cwd: process.cwd() });
        return { success: true, content: result.slice(0, 2000) };
      } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string; message: string };
        return { success: false, content: err.stdout ?? "", error: err.stderr ?? err.message };
      }
    },
  },
  {
    name: "list_files",
    description: "列出项目目录中的文件",
    parameters: [
      { name: "path", type: "string", description: "目录路径，默认当前目录", required: false },
    ],
    execute: async (params) => {
      const p = (params["path"] as string) || ".";
      try {
        const { readdirSync } = require("fs");
        const files = readdirSync(p, { withFileTypes: true });
        const lines = files.map((f: { name: string; isDirectory: () => boolean }) =>
          f.isDirectory() ? `${f.name}/` : f.name
        );
        return { success: true, content: lines.slice(0, 50).join("\n") };
      } catch (e) {
        return { success: false, content: "", error: String(e) };
      }
    },
  },
];

// ── 工具执行器 ────────────────────────────────

export class ToolExecutor {
  private tools: Map<string, ToolDef>;

  constructor(tools: ToolDef[] = BUILTIN_TOOLS) {
    this.tools = new Map(tools.map((t) => [t.name, t]));
  }

  /** 注册新工具 */
  register(tool: ToolDef): void {
    this.tools.set(tool.name, tool);
  }

  /** 获取工具的 LLM 函数调用格式（OpenAI Function Calling 兼容） */
  getFunctionDefinitions(): Array<Record<string, unknown>> {
    return [...this.tools.values()].map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: "object",
          properties: Object.fromEntries(
            t.parameters.map((p) => [p.name, { type: p.type, description: p.description }])
          ),
          required: t.parameters.filter((p) => p.required).map((p) => p.name),
        },
      },
    }));
  }

  /** 获取工具的文本描述（给不支持 Function Calling 的模型用） */
  getToolPrompt(): string {
    return [...this.tools.values()]
      .map((t) => {
        const params = t.parameters
          .map((p) => `  - ${p.name} (${p.type}${p.required ? ", 必填" : ""}): ${p.description}`)
          .join("\n");
        return `### ${t.name}\n${t.description}\n参数:\n${params}`;
      })
      .join("\n\n");
  }

  /** 解析 Agent 回复中的工具调用标签 */
  parseToolCalls(response: string): Array<{ name: string; params: Record<string, unknown> }> {
    const regex = /<tool_call\s+name=["'](\w+)["']>(.*?)<\/tool_call>/gs;
    const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
    let match;
    while ((match = regex.exec(response)) !== null) {
      try {
        calls.push({
          name: match[1]!,
          params: JSON.parse(match[2]!) as Record<string, unknown>,
        });
      } catch {
        // 解析失败，忽略
      }
    }
    return calls;
  }

  /** 执行工具调用 */
  async execute(name: string, params: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return { success: false, content: "", error: `未知工具: ${name}` };
    try {
      return await tool.execute(params);
    } catch (e) {
      return { success: false, content: "", error: String(e) };
    }
  }

  /** 执行 Agent 回复中的所有工具调用 */
  async executeAll(response: string): Promise<Array<{ name: string; result: ToolResult }>> {
    const calls = this.parseToolCalls(response);
    const results: Array<{ name: string; result: ToolResult }> = [];
    for (const call of calls) {
      results.push({ name: call.name, result: await this.execute(call.name, call.params) });
    }
    return results;
  }
}

/** 全局单例（含内置工具） */
export const toolExecutor = new ToolExecutor();
