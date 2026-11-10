/**
 * DeveloperAgent — 代码编写与实现
 */

import { mkdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { BaseAgent } from "./base.js";
import { MessageBus } from "../message-bus.js";
import { LLMService, llmService } from "../services/llm.js";
import { AgentRole, Message, MessageType } from "../models/task.js";
import { ragIndex } from "../services/rag.js";

const DEVELOPER_SYSTEM_PROMPT = `你是一个资深软件工程师。根据任务描述和接口规范生成高质量的生产级代码。

## 代码要求
1. 完整的类型标注
2. 完善的错误处理和输入验证
3. 清晰的 JSDoc / docstring 注释
4. 遵循语言最佳实践
5. 代码可直接运行

## 输出格式
返回 JSON：
{
  "filename": "建议的文件名",
  "language": "typescript|python|go",
  "code": "完整的代码内容",
  "description": "代码简要说明",
  "dependencies": ["需要的依赖包列表"],
  "entry_point": "入口函数/类名",
  "test_hints": ["关键测试点"]
}
请直接返回 JSON。`;

interface DevelopResult {
  filename: string;
  language: string;
  code: string;
  description: string;
  dependencies: string[];
  entryPoint?: string;
}

export class DeveloperAgent extends BaseAgent {
  readonly role: AgentRole = "developer";
  private llm: LLMService;
  private outputDir: string;

  constructor(bus?: MessageBus, llm?: LLMService, outputDir = "./output") {
    super(bus);
    this.llm = llm ?? llmService;
    this.outputDir = outputDir;
    mkdirSync(this.outputDir, { recursive: true });
  }

  async processMessage(message: Message): Promise<void> {
    if (message.msgType === "task_assign") {
      await this.handleDevTask(message);
    } else if (message.msgType === "review_response") {
      await this.handleReviewFeedback(message);
    } else {
      await this.sendError(message, `未知消息类型: ${message.msgType}`);
    }
  }

  private async handleDevTask(message: Message): Promise<void> {
    const taskData = (message.content["task"] as Record<string, unknown>) ?? {};
    const language = (message.content["language"] as string) ?? "typescript";
    const title = (taskData["title"] as string) ?? "未命名任务";
    const description = (taskData["description"] as string) ?? "";
    const context = (taskData["context"] as Record<string, unknown>) ?? {};
    const interfaces = (context["interfaces"] as Array<Record<string, string>>) ?? [];
    const useLLM = (message.content["use_llm"] as boolean) ?? !process.env["MACA_TEST_MODE"];

    this.log.info(`开始开发: ${title}`);

    try {
      const result = await this.develop(title, description, interfaces, language, useLLM);
      const filepath = this.saveCode(result);

      await this.sendTaskResult(message, {
        title,
        filename: result.filename,
        filepath,
        language: result.language,
        code: result.code,
        description: result.description,
        dependencies: result.dependencies,
      });
      this.log.info(`开发完成: ${result.filename}`);
    } catch (err) {
      this.log.error(`代码生成失败: ${title} — ${String(err)}`);
      await this.sendError(message, String(err));
    }
  }

  private async handleReviewFeedback(message: Message): Promise<void> {
    const issues = (message.content["issues"] as Array<Record<string, unknown>>) ?? [];
    const code = (message.content["code"] as string) ?? "";
    const language = (message.content["language"] as string) ?? "typescript";
    const useLLM = (message.content["use_llm"] as boolean) ?? !process.env["MACA_TEST_MODE"];

    this.log.info(`收到 ${issues.length} 条审核意见，开始修复...`);

    try {
      const fixedCode = await this.fixCode(code, issues, language, useLLM);
      await this.sendTaskResult(message, { code: fixedCode, fixesApplied: issues.length, status: "fixed" });
    } catch (err) {
      await this.sendError(message, String(err));
    }
  }

  // ── 核心开发 ──────────────────────────────────

  async develop(
    title: string,
    description: string,
    interfaces: Array<Record<string, string>>,
    language = "typescript",
    useLLM = true
  ): Promise<DevelopResult> {
    if (useLLM) {
      try {
        return await this.llmDevelop(title, description, interfaces, language);
      } catch (err) {
        this.log.warn(`LLM 代码生成失败，使用模板: ${String(err)}`);
      }
    }
    return this.templateDevelop(title, description, interfaces, language);
  }

  private async llmDevelop(
    title: string,
    description: string,
    interfaces: Array<Record<string, string>>,
    language: string
  ): Promise<DevelopResult> {
    // RAG: 从项目知识库检索相关代码作为参考
    const ragContext = ragIndex.getContext(`${title} ${description}`, 3, 2000);

    const prompt = `请为以下开发任务生成代码：

## 任务标题
${title}

## 任务描述
${description}

## 接口规范
${JSON.stringify(interfaces, null, 2)}

## 目标语言
${language}

${ragContext}

请生成完整的、可直接运行的代码。`;

    const response = await this.llm.chatWithJSON(
      [{ role: "user", content: prompt }],
      { systemPrompt: DEVELOPER_SYSTEM_PROMPT, temperature: 0.5, maxTokens: 8192 }
    );

    let jsonStr = response.trim();
    jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, "");
    jsonStr = jsonStr.replace(/\s*```$/i, "");
    const data = JSON.parse(jsonStr) as Record<string, unknown>;
    return {
      filename: (data["filename"] as string) ?? "output.ts",
      language: (data["language"] as string) ?? language,
      code: ((data["code"] as string) ?? "").replace(/\\n/g, "\n").replace(/\\t/g, "  "),
      description: (data["description"] as string) ?? description,
      dependencies: (data["dependencies"] as string[]) ?? [],
      entryPoint: data["entry_point"] as string | undefined,
    };
  }

  templateDevelop(
    title: string,
    description: string,
    interfaces: Array<Record<string, string>>,
    language: string
  ): DevelopResult {
    const lines: string[] = [];

    if (language === "typescript") {
      lines.push("/**");
      lines.push(` * ${title}`);
      lines.push(` * ${description}`);
      lines.push(" */");
      lines.push("");

      for (const iface of interfaces) {
        lines.push(...this.generateTSStub(iface));
        lines.push("");
      }

      if (interfaces.length === 0) {
        const className = this.titleToClass(title);
        lines.push(`export class ${className} {`);
        lines.push(`  /** ${description} */`);
        lines.push("  constructor() {}");
        lines.push("");
        lines.push("  execute(...args: unknown[]): unknown {");
        lines.push("    throw new Error('Not implemented');");
        lines.push("  }");
        lines.push("}");
      }

      lines.push("");
      lines.push("// Entry point");
      lines.push("if (import.meta.main) {");
      lines.push("  console.log('Running...');");
      lines.push("}");
    } else {
      // Python fallback
      lines.push('"""');
      lines.push(title);
      lines.push(description);
      lines.push('"""');
      lines.push("");

      for (const iface of interfaces) {
        lines.push(...this.generatePyStub(iface));
        lines.push("");
      }

      if (interfaces.length === 0) {
        const className = this.titleToClass(title);
        lines.push(`class ${className}:`);
        lines.push(`    """${description}"""`);
        lines.push("    def __init__(self):");
        lines.push("        pass");
      }
    }

    return {
      filename: this.titleToFilename(title, language),
      language,
      code: lines.join("\n"),
      description,
      dependencies: [],
    };
  }

  private generateTSStub(iface: Record<string, string>): string[] {
    const desc = iface["description"] ?? "";
    const inputDesc = iface["input"] ?? "";
    const outputDesc = iface["output"] ?? "";
    const funcName = this.pathToFuncName(iface["path"] ?? "handler");

    return [
      "/**",
      ` * ${desc}`,
      inputDesc ? ` * @param request - ${inputDesc}` : "",
      outputDesc ? ` * @returns ${outputDesc}` : "",
      " */",
      `export function ${funcName}(request: unknown): unknown {`,
      `  console.log('${funcName} called');`,
      "  // TODO: implement",
      "  throw new Error('Not implemented');",
      "}",
    ].filter(Boolean);
  }

  private generatePyStub(iface: Record<string, string>): string[] {
    const desc = iface["description"] ?? "";
    const funcName = this.pathToFuncName(iface["path"] ?? "handler");
    return [
      `def ${funcName}(request):`,
      `    """${desc}"""`,
      "    # TODO: implement",
      "    raise NotImplementedError",
    ];
  }

  // ── 代码修复 ──────────────────────────────────

  async fixCode(
    code: string,
    issues: Array<Record<string, unknown>>,
    language: string,
    useLLM = true
  ): Promise<string> {
    if (useLLM) {
      try {
        const prompt = `请修复以下 ${language} 代码中的所有问题。

原始代码：
\`\`\`${language}
${code}
\`\`\`

发现的问题：
${JSON.stringify(issues, null, 2)}

返回 JSON: {"code": "完整的修复后代码"}`;

        const response = await this.llm.chatWithJSON(
          [{ role: "user", content: prompt }],
          { systemPrompt: "你是代码修复专家。根据问题列表修复代码。只返回 JSON。", temperature: 0.2 }
        );

        let jsonStr = response.trim();
        jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, "");
        jsonStr = jsonStr.replace(/\s*```$/i, "");
        const data = JSON.parse(jsonStr) as { code: string };
        return (data["code"] ?? code).replace(/\\n/g, "\n").replace(/\\t/g, "  ");
      } catch {}
    }

    // Fallback: add FIXME comments
    const fixNotes = issues
      .map(
        (i) =>
          `// FIXME: [${i["severity"] ?? "info"}] ${i["title"] ?? ""} — ${i["suggestion"] ?? ""}`
      )
      .join("\n");
    return `${fixNotes}\n\n${code}`;
  }

  // ── 文件保存 ──────────────────────────────────

  saveCode(result: DevelopResult): string {
    const filepath = resolve(this.outputDir, result.filename);
    try { mkdirSync(dirname(filepath), { recursive: true }); } catch {}
    writeFileSync(filepath, result.code, "utf-8");
    this.log.info(`代码已保存: ${filepath}`);
    return filepath;
  }

  // ── 工具方法 ──────────────────────────────────

  titleToFilename(title: string, language: string): string {
    const extMap: Record<string, string> = {
      typescript: ".ts", python: ".py", go: ".go", rust: ".rs",
    };
    const ext = extMap[language] ?? ".ts";
    const name = title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/[-\s]+/g, "_");
    return `${name}${ext}`;
  }

  titleToClass(title: string): string {
    const name = title.replace(/[^\p{L}\p{N}\s_-]/gu, "");
    const words = name.split(/[-\s_]+/);
    return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("") || "MainModule";
  }

  pathToFuncName(path: string): string {
    const name = path.includes("/") ? path.split("/").pop()! : path;
    return name.replace(/[^\w]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "handler";
  }
}
