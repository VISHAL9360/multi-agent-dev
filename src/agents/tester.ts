/**
 * TesterAgent — 代码审查、BUG 检测、安全扫描
 */

import { BaseAgent } from "./base.js";
import { MessageBus } from "../message-bus.js";
import { LLMService, llmService } from "../services/llm.js";
import { AgentRole, Message, MessageType } from "../models/task.js";

const TESTER_SYSTEM_PROMPT = `你是一个资深 QA 工程师。请审查以下代码，找出所有问题。

## 检查维度
1. 语法错误 2. 逻辑漏洞 3. 安全风险（注入、硬编码密钥、XSS） 4. 边界异常 5. 性能问题 6. 最佳实践

## 输出格式
返回 JSON：
{
  "summary": "整体评价",
  "score": 85,
  "issues": [
    {"severity": "error|warning|info", "category": "syntax|logic|security|boundary|performance|practice",
     "title": "简短标题", "line": 42, "description": "详细描述", "suggestion": "修复建议"}
  ],
  "passed": true
}
请直接返回 JSON。`;

interface ReviewIssue {
  severity: "error" | "warning" | "info";
  category: string;
  title: string;
  line: number;
  description: string;
  suggestion: string;
}

interface ReviewResult {
  summary: string;
  score: number;
  issues: ReviewIssue[];
  passed: boolean;
}

type PatternEntry = [RegExp, string, ReviewIssue["severity"]];

export class TesterAgent extends BaseAgent {
  readonly role: AgentRole = "tester";
  private llm: LLMService;

  // ── 安全检测模式 ──
  private static readonly SECURITY_PATTERNS: PatternEntry[] = [
    [/(?:password|passwd|secret|api_key|apiKey|token)\s*[:=]\s*['"]([^'"]+)['"]/gi, "硬编码密钥/密码", "error"],
    [/exec\s*\(|eval\s*\(/g, "动态执行风险（exec/eval）", "warning"],
    [/SELECT.*\+|INSERT.*\+|UPDATE.*\+|DELETE.*\+/gi, "SQL 注入风险（字符串拼接）", "error"],
    [/dangerouslySetInnerHTML/g, "XSS 风险（dangerouslySetInnerHTML）", "warning"],
    [/\.innerHTML\s*=/g, "XSS 风险（innerHTML 赋值）", "warning"],
    [/pickle\.(?:load|loads)\(/g, "反序列化风险（pickle）", "warning"],
  ];

  private static readonly PRACTICE_PATTERNS: PatternEntry[] = [
    [/catch\s*\(\s*\)/, "空 catch 块无错误处理", "warning"],
    [/catch\s*\([^)]*\)\s*\{\s*\}/, "静默吞掉异常（空 catch）", "warning"],
    [/\/\/\s*TODO/g, "存在 TODO 标记", "info"],
    [/console\.log\(/g, "使用 console.log 而非 logger，生产环境不推荐", "info"],
    [/while\s*\(\s*true\s*\)/g, "while(true) 无限循环，确认是否有退出条件", "info"],
    [/any\b/g, "使用 any 类型，建议明确类型", "warning"],
  ];

  constructor(bus?: MessageBus, llm?: LLMService) {
    super(bus);
    this.llm = llm ?? llmService;
  }

  async processMessage(message: Message): Promise<void> {
    if (message.msgType === "task_assign" || message.msgType === "review_request") {
      await this.handleTestTask(message);
    } else {
      await this.sendError(message, `未知消息类型: ${message.msgType}`);
    }
  }

  private async handleTestTask(message: Message): Promise<void> {
    const code = (message.content["code"] as string) ?? "";
    const language = (message.content["language"] as string) ?? "typescript";
    const useLLM = (message.content["use_llm"] as boolean) ?? true;

    if (!code) {
      await this.sendError(message, "缺少代码内容 (code)");
      return;
    }

    this.log.info(`开始代码审查: ${code.length} 字符`);
    const result = await this.review(code, language, useLLM);

    await this.sendTaskResult(message, {
      summary: result.summary,
      score: result.score,
      issues: result.issues,
      passed: result.passed,
      issueCount: result.issues.length,
    });

    this.log.info(
      `审查完成: 得分 ${result.score}, 问题 ${result.issues.length} 个, ${result.passed ? "✅ 通过" : "❌ 需修复"}`
    );
  }

  // ── 核心审查 ──────────────────────────────────

  async review(code: string, language = "typescript", useLLM = true): Promise<ReviewResult> {
    const staticIssues = this.staticAnalysis(code, language);

    let llmIssues: ReviewIssue[] = [];
    if (useLLM) {
      try {
        const llmResult = await this.llmReview(code, language);
        llmIssues = llmResult.issues ?? [];
      } catch (err) {
        this.log.warn(`LLM 审查失败，仅使用静态分析: ${String(err)}`);
      }
    }

    const allIssues = this.deduplicateIssues([...staticIssues, ...llmIssues]);
    const score = this.calculateScore(allIssues);
    const errorCount = allIssues.filter((i) => i.severity === "error").length;

    return {
      summary: this.generateSummary(allIssues, score),
      score,
      issues: allIssues,
      passed: errorCount === 0,
    };
  }

  private staticAnalysis(code: string, language: string): ReviewIssue[] {
    const issues: ReviewIssue[] = [];

    const allPatterns = [
      ...TesterAgent.SECURITY_PATTERNS,
      ...TesterAgent.PRACTICE_PATTERNS,
    ];

    for (const [pattern, desc, severity] of allPatterns) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = regex.exec(code)) !== null) {
        const lineNo = code.slice(0, match.index).split("\n").length;
        issues.push({
          severity,
          category: "security",
          title: desc,
          line: lineNo,
          description: `发现潜在问题: ${desc}`,
          suggestion: "请按照最佳实践修复",
        });
        if (!pattern.flags.includes("g")) break;
      }
    }

    return issues;
  }

  private async llmReview(code: string, language: string): Promise<{ issues: ReviewIssue[]; score: number }> {
    const prompt = `请审查以下 ${language} 代码：

\`\`\`${language}
${code}
\`\`\`

请从语法、逻辑、安全、边界、性能、最佳实践六个维度进行全面审查。`;

    const response = await this.llm.chatWithJSON(
      [{ role: "user", content: prompt }],
      { systemPrompt: TESTER_SYSTEM_PROMPT, temperature: 0.3, maxTokens: 4096 }
    );

    let jsonStr = response.trim();
    jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, "");
    jsonStr = jsonStr.replace(/\s*```$/i, "");
    return JSON.parse(jsonStr) as { issues: ReviewIssue[]; score: number };
  }

  private deduplicateIssues(issues: ReviewIssue[]): ReviewIssue[] {
    const seen = new Set<string>();
    const unique: ReviewIssue[] = [];
    for (const issue of issues) {
      const key = `${issue.line}:${issue.title}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(issue);
      }
    }
    const order = { error: 0, warning: 1, info: 2 } as const;
    return unique.sort((a, b) => order[a.severity] - order[b.severity] || a.line - b.line);
  }

  private calculateScore(issues: ReviewIssue[]): number {
    const deductions: Record<ReviewIssue["severity"], number> = {
      error: 15, warning: 5, info: 1,
    };
    let score = 100;
    for (const issue of issues) {
      score -= deductions[issue.severity];
    }
    return Math.max(0, Math.min(100, score));
  }

  private generateSummary(issues: ReviewIssue[], score: number): string {
    const errors = issues.filter((i) => i.severity === "error").length;
    const warnings = issues.filter((i) => i.severity === "warning").length;
    const infos = issues.filter((i) => i.severity === "info").length;

    const parts: string[] = [];
    if (errors) parts.push(`${errors} 个错误`);
    if (warnings) parts.push(`${warnings} 个警告`);
    if (infos) parts.push(`${infos} 个建议`);
    if (parts.length === 0) return `代码审查通过，得分 ${score}/100 ✅`;
    return `发现 ${parts.join(", ")}，得分 ${score}/100`;
  }

  formatReport(result: ReviewResult): string {
    const lines = [
      "=".repeat(60),
      "  代码审查报告",
      "=".repeat(60),
      `  评分: ${result.score}/100  ${result.passed ? "✅ 通过" : "❌ 需修复"}`,
      `  摘要: ${result.summary}`,
      "",
    ];

    if (result.issues.length > 0) {
      lines.push("  问题列表:");
      lines.push("  " + "-".repeat(56));
      for (let i = 0; i < result.issues.length; i++) {
        const issue = result.issues[i]!;
        const icon = { error: "🔴", warning: "🟡", info: "🔵" }[issue.severity] ?? "⚪";
        lines.push(
          `  ${i + 1}. ${icon} [${issue.severity.toUpperCase()}] L${issue.line}: ${issue.title}`
        );
        if (issue.suggestion) lines.push(`     建议: ${issue.suggestion}`);
        lines.push("");
      }
    }

    lines.push("=".repeat(60));
    return lines.join("\n");
  }
}
