/**
 * DocumenterAgent — 文档生成与项目复盘
 */

import { mkdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { BaseAgent } from "./base.js";
import { MessageBus } from "../message-bus.js";
import { LLMService, llmService } from "../services/llm.js";
import { AgentRole, Message, MessageType } from "../models/task.js";

const DOCUMENTER_SYSTEM_PROMPT = `你是一个资深技术文档工程师。根据项目的开发上下文生成专业的技术文档。

## 输出格式
返回 JSON：
{
  "title": "文档标题",
  "type": "api|readme|module|retrospective",
  "content": "完整的 Markdown 文档内容"
}`;

interface DocResult {
  title: string;
  type: string;
  content: string;
}

interface ProjectContext {
  name: string;
  description: string;
  modules: Array<{
    title: string;
    description: string;
    features: Array<{
      title: string;
      description: string;
      interfaces: Array<Record<string, string>>;
      steps: string[];
    }>;
  }>;
}

export class DocumenterAgent extends BaseAgent {
  readonly role: AgentRole = "documenter";
  private llm: LLMService;
  private outputDir: string;

  constructor(bus?: MessageBus, llm?: LLMService, outputDir = "./output/docs") {
    super(bus);
    this.llm = llm ?? llmService;
    this.outputDir = outputDir;
    mkdirSync(this.outputDir, { recursive: true });
  }

  async processMessage(message: Message): Promise<void> {
    if (message.msgType === "task_assign") {
      await this.handleDocTask(message);
    } else {
      await this.sendError(message, `未知消息类型: ${message.msgType}`);
    }
  }

  private async handleDocTask(message: Message): Promise<void> {
    const docType = (message.content["doc_type"] as string) ?? "readme";
    const projectContext = (message.content["project_context"] as ProjectContext) ?? {};
    const artifacts = (message.content["artifacts"] as Record<string, string>) ?? {};
    const interfaces = (message.content["interfaces"] as Array<Record<string, string>>) ?? [];
    const issues = (message.content["issues"] as Array<Record<string, unknown>>) ?? [];
    const useLLM = (message.content["use_llm"] as boolean) ?? true;

    this.log.info(`开始生成文档: ${docType}`);

    try {
      let doc: DocResult;
      switch (docType) {
        case "api":
          doc = await this.generateApiDoc(interfaces, artifacts, useLLM);
          break;
        case "module":
          doc = await this.generateModuleDoc(
            (message.content["module_name"] as string) ?? "未命名",
            (message.content["description"] as string) ?? "",
            artifacts,
            useLLM
          );
          break;
        case "retrospective":
          doc = await this.generateRetrospective(projectContext, artifacts, issues, useLLM);
          break;
        default:
          doc = await this.generateReadme(projectContext, artifacts, useLLM);
      }

      const filepath = this.saveDocument(doc);
      await this.sendTaskResult(message, { docType, title: doc.title, content: doc.content, filepath });
      this.log.info(`文档已生成: ${filepath}`);
    } catch (err) {
      this.log.error(`文档生成失败: ${String(err)}`);
      await this.sendError(message, String(err));
    }
  }

  // ── README ─────────────────────────────────────

  async generateReadme(
    projectContext: ProjectContext,
    artifacts: Record<string, string>,
    useLLM = true
  ): Promise<DocResult> {
    if (useLLM) {
      try {
        return await this.llmGenerate("readme", projectContext as unknown as Record<string, unknown>, {});
      } catch { /* fallback */ }
    }

    const name = projectContext.name ?? "未命名项目";
    const description = projectContext.description ?? "";
    const modules = projectContext.modules ?? [];

    const lines = [
      `# ${name}`,
      "",
      `> ${description}`,
      "",
      "## 📋 项目概述",
      "",
      description,
      "",
      "## 🏗️ 项目结构",
      "",
      "```",
      `${name}/`,
    ];

    for (const mod of modules) {
      lines.push(`├── ${mod.title}/`);
      for (const feat of mod.features) {
        lines.push(`│   ├── ${feat.title}`);
      }
    }

    lines.push("```", "", "## 🚀 快速开始", "", "```bash", "npm install", "npm run dev", "```", "");

    lines.push("## 📦 模块说明", "");
    for (const mod of modules) {
      lines.push(`### ${mod.title}`, mod.description, "");
    }

    lines.push("## 🔌 API 接口", "", "| 方法 | 路径 | 说明 |", "|------|------|------|");
    for (const mod of modules) {
      for (const feat of mod.features) {
        for (const iface of feat.interfaces) {
          lines.push(`| ${iface["method"] ?? "—"} | \`${iface["path"] ?? "—"}\` | ${iface["description"] ?? "—"} |`);
        }
      }
    }

    lines.push("", "## 🧪 测试", "", "```bash", "npm test", "```", "", "## 📄 许可证", "", "MIT");

    return { title: `${name} - README`, type: "readme", content: lines.join("\n") };
  }

  // ── API 文档 ───────────────────────────────────

  async generateApiDoc(
    interfaces: Array<Record<string, string>>,
    artifacts: Record<string, string>,
    useLLM = true
  ): Promise<DocResult> {
    if (useLLM) {
      try {
        return await this.llmGenerate("api", { interfaces, artifacts } as unknown as Record<string, unknown>, {});
      } catch { /* fallback */ }
    }

    const lines = [
      "# API 接口文档",
      "",
      `> 自动生成于 ${new Date().toISOString().slice(0, 19).replace("T", " ")}`,
      "",
      "## 接口列表",
      "",
    ];

    for (let i = 0; i < interfaces.length; i++) {
      const iface = interfaces[i]!;
      const method = iface["method"] ?? "GET";
      const path = iface["path"] ?? "/";
      const desc = iface["description"] ?? "";

      lines.push(`### ${i + 1}. ${method} \`${path}\``, "", `**说明**: ${desc}`, "");

      if (iface["input"]) {
        lines.push("**请求参数**:", "", "```json", iface["input"], "```", "");
      }
      if (iface["output"]) {
        lines.push("**响应格式**:", "", "```json", iface["output"], "```", "");
      }
      lines.push("---", "");
    }

    return { title: "API 接口文档", type: "api", content: lines.join("\n") };
  }

  // ── 模块文档 ───────────────────────────────────

  async generateModuleDoc(
    moduleName: string,
    description: string,
    artifacts: Record<string, string>,
    useLLM = true
  ): Promise<DocResult> {
    if (useLLM) {
      try {
        return await this.llmGenerate("module", { moduleName, description } as unknown as Record<string, unknown>, artifacts);
      } catch { /* fallback */ }
    }

    let codeSnippet = "";
    for (const [name, content] of Object.entries(artifacts)) {
      if (name.toLowerCase().includes(moduleName.toLowerCase())) {
        codeSnippet = content.slice(0, 500);
        break;
      }
    }

    const lines = [
      `# 模块: ${moduleName}`,
      "",
      `> ${description}`,
      "",
      "## 概述",
      "",
      description,
      "",
    ];

    if (codeSnippet) {
      lines.push("## 代码示例", "", "```typescript", codeSnippet, "```", "");
    }

    return { title: `模块文档 - ${moduleName}`, type: "module", content: lines.join("\n") };
  }

  // ── 复盘报告 ───────────────────────────────────

  async generateRetrospective(
    projectContext: ProjectContext,
    artifacts: Record<string, string>,
    issues: Array<Record<string, unknown>>,
    useLLM = true
  ): Promise<DocResult> {
    if (useLLM) {
      try {
        return await this.llmGenerate(
          "retrospective",
          { project: projectContext, artifacts, issues } as unknown as Record<string, unknown>,
          {}
        );
      } catch { /* fallback */ }
    }

    const name = projectContext.name ?? "未命名项目";
    const modules = projectContext.modules ?? [];
    const totalIssues = issues.length;
    const errorCount = issues.filter((i) => i["severity"] === "error").length;
    const warningCount = issues.filter((i) => i["severity"] === "warning").length;

    const lines = [
      `# 项目复盘报告: ${name}`,
      "",
      `> 生成于 ${new Date().toISOString().slice(0, 19).replace("T", " ")}`,
      "",
      "## 📊 项目概况",
      "",
      `- **项目名称**: ${name}`,
      `- **模块数量**: ${modules.length}`,
      `- **产出文件**: ${Object.keys(artifacts).length}`,
      `- **代码问题**: ${totalIssues} (${errorCount} 错误, ${warningCount} 警告)`,
      "",
      "## ✅ 完成情况",
      "",
    ];

    for (const mod of modules) {
      const totalSteps = mod.features.reduce((sum, f) => sum + f.steps.length, 0);
      lines.push(`- **${mod.title}**: ${mod.features.length} 功能, ${totalSteps} 步骤`);
    }

    lines.push("", "## 🐛 问题汇总", "");

    if (issues.length > 0) {
      lines.push("| 严重度 | 类别 | 说明 |", "|--------|------|------|");
      for (const issue of issues.slice(0, 20)) {
        lines.push(
          `| ${issue["severity"] ?? "—"} | ${issue["category"] ?? "—"} | ${issue["title"] ?? "—"} |`
        );
      }
    } else {
      lines.push("✅ 无遗留问题");
    }

    lines.push(
      "",
      "## 📝 经验总结",
      "",
      "### 做得好的",
      "- 需求拆解清晰，任务分配合理",
      "- 代码规范，类型标注完善",
      "",
      "### 需改进的",
      "- 初期应更多关注安全设计",
      "- 增加集成测试覆盖",
      "",
      "## 🎯 后续建议",
      "",
      "1. 补充端到端测试",
      "2. 添加 CI/CD 流水线",
      "3. 性能基准测试",
    );

    return { title: `项目复盘 - ${name}`, type: "retrospective", content: lines.join("\n") };
  }

  // ── LLM 辅助 ──────────────────────────────────

  private async llmGenerate(
    docType: string,
    context: Record<string, unknown>,
    artifacts: Record<string, string>
  ): Promise<DocResult> {
    const prompt = `请为以下项目生成 ${docType} 类型的 Markdown 文档。

## 项目上下文
${JSON.stringify(context, null, 2)}

## 代码产物
${JSON.stringify(
  Object.fromEntries(Object.entries(artifacts).map(([k, v]) => [k, v.slice(0, 200)])),
  null,
  2
)}`;

    const response = await this.llm.chatWithJSON(
      [{ role: "user", content: prompt }],
      { systemPrompt: DOCUMENTER_SYSTEM_PROMPT, temperature: 0.5, maxTokens: 4096 }
    );

    let jsonStr = response.trim();
    jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, "");
    jsonStr = jsonStr.replace(/\s*```$/i, "");
    return JSON.parse(jsonStr) as DocResult;
  }

  // ── 保存 ──────────────────────────────────────

  saveDocument(doc: DocResult): string {
    const safeTitle = doc.title
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 50);
    const filename = `${doc.type}_${safeTitle}.md`;
    const filepath = resolve(this.outputDir, filename);
    try { mkdirSync(dirname(filepath), { recursive: true }); } catch {}
    writeFileSync(filepath, doc.content, "utf-8");
    this.log.info(`文档已保存: ${filepath}`);
    return filepath;
  }
}
