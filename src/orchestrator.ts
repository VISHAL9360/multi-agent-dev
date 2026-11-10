/**
 * Orchestrator — 总控调度器（系统核心）
 *
 * 三阶段流水线: PLAN → DEVELOP+TEST+FIX → DOCUMENT → DONE
 */

import { BaseAgent } from "./agents/base.js";
import { MessageBus } from "./message-bus.js";
import {
  AgentRole,
  Message,
  MessageType,
  Task,
  TaskStatus,
  createMessage,
  createTask,
  flattenTasks,
  isLeafTask,
} from "./models/task.js";
import { logger } from "./utils/logger.js";

type PipelinePhase = "idle" | "planning" | "developing" | "testing" | "fixing" | "documenting" | "done" | "failed";

interface PipelineResult {
  status: "completed" | "failed";
  projectName?: string;
  requirement?: string;
  stats: {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    fixIterations: number;
    startedAt: Date | null;
    completedAt: Date | null;
    elapsedSeconds?: number;
  };
  artifacts: Record<string, string>;
  reviewResults: Record<string, { score?: number; issues: number }>;
  documentation: Record<string, unknown>;
  outputDir: string;
}

export class Orchestrator extends BaseAgent {
  readonly role: AgentRole = "orchestrator";

  private TASK_TIMEOUT = 120_000; // ms
  private MAX_FIX_ITERATIONS = 3;
  private REVIEW_PASS_THRESHOLD = 80;

  private get useLLM(): boolean {
    return !process.env["MACA_TEST_MODE"];
  }

  private outputDir: string;
  private phase: PipelinePhase = "idle";
  private taskTree: Task | null = null;
  private artifacts: Record<string, string> = {};
  private reviewResults: Record<string, { score?: number; issues: number }> = {};
  private currentRequirement = "";

  private stats = {
    totalTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    fixIterations: 0,
    startedAt: null as Date | null,
    completedAt: null as Date | null,
  };

  constructor(bus?: MessageBus, outputDir = "./output") {
    super(bus);
    this.outputDir = outputDir;
    // Adjust timeouts for tests
    if (process.env["MACA_TEST_MODE"]) {
      this.TASK_TIMEOUT = 5000;
    }
  }

  // ═══════════════════════════════════════════════
  // 消息处理
  // ═══════════════════════════════════════════════

  async processMessage(message: Message): Promise<void> {
    if (message.msgType === "task_assign") {
      const requirement = message.content["requirement"] as string;
      if (requirement) {
        // Fire and forget — pipeline runs async
        this.runPipeline(requirement).then((result) => {
          this.sendTaskResult(message, result as unknown as Record<string, unknown>);
        });
      } else {
        await this.sendError(message, "缺少需求描述");
      }
    } else if (message.msgType === "task_result") {
      logger.debug(`收到异步结果: ${message.sender}`);
    } else if (message.msgType === "error") {
      logger.error(`[${message.sender}] 错误: ${String(message.content["error"])}`);
    }
  }

  // ═══════════════════════════════════════════════
  // 主流水线
  // ═══════════════════════════════════════════════

  async runPipeline(requirement: string): Promise<PipelineResult> {
    this.currentRequirement = requirement;
    this.stats.startedAt = new Date();
    this.phase = "planning";

    logger.phase("🚀 启动流水线");
    logger.info(`需求: ${requirement.slice(0, 100)}...`);

    try {
      // Phase 1: Plan
      const taskTree = await this.phasePlan(requirement);
      if (!taskTree) return this.fail("规划阶段失败");

      // Phase 2: Develop + Test
      await this.phaseDevelopAndTest(taskTree);

      // Phase 3: Document
      const docs = await this.phaseDocument(taskTree);

      this.phase = "done";
      this.stats.completedAt = new Date();

      const elapsed = this.stats.startedAt
        ? (this.stats.completedAt.getTime() - this.stats.startedAt.getTime()) / 1000
        : undefined;

      const result: PipelineResult = {
        status: "completed",
        projectName: this.taskTree?.title,
        requirement: this.currentRequirement,
        stats: { ...this.stats, elapsedSeconds: elapsed },
        artifacts: this.artifacts,
        reviewResults: this.reviewResults,
        documentation: docs,
        outputDir: this.outputDir,
      };

      logger.phase("✅ 流水线完成");
      logger.info(`统计: ${JSON.stringify(this.stats)}`);
      return result;
    } catch (err) {
      return this.fail(String(err));
    }
  }

  // ── Phase 1: Plan ─────────────────────────────

  private async phasePlan(requirement: string): Promise<Task | null> {
    logger.phase("📋 Phase 1/3: 需求分析与任务拆解");
    this.phase = "planning";

    const request = createMessage({
      msgType: "task_assign",
      sender: "orchestrator",
      receiver: "planner",
      content: { requirement, use_llm: this.useLLM },
    });

    const reply = await this.bus.sendAndWait(request, this.TASK_TIMEOUT);
    if (!reply || reply.msgType === "error") {
      logger.error("Planner 无响应或返回错误");
      return null;
    }

    const result = reply.content["result"] as Record<string, unknown> | undefined;
    const taskTree = result?.["taskTree"] as Task | undefined;
    if (!taskTree) {
      logger.error("Planner 返回空任务树");
      return null;
    }

    this.taskTree = taskTree;
    this.stats.totalTasks = flattenTasks(taskTree).length;
    logger.info(`任务树: ${taskTree.children.length} 个模块, ${this.stats.totalTasks} 个节点`);
    return taskTree;
  }

  // ── Phase 2: Develop + Test ──────────────────

  private async phaseDevelopAndTest(tree: Task): Promise<void> {
    logger.phase("🔨 Phase 2/3: 开发 & 测试");
    this.phase = "developing";

    const leaves = flattenTasks(tree).filter(isLeafTask);
    logger.info(`共 ${leaves.length} 个可执行任务`);

    for (let i = 0; i < leaves.length; i++) {
      const task = leaves[i]!;
      logger.info(`\n--- 任务 [${i + 1}/${leaves.length}]: ${task.title} ---`);

      task.status = "in_progress";
      task.startedAt = new Date();

      // Step A: Develop
      const codeResult = await this.dispatchDevelop(task);
      if (!codeResult) {
        task.status = "failed";
        this.stats.failedTasks++;
        continue;
      }

      const filepath = (codeResult["filepath"] as string) ?? "";
      this.artifacts[task.id] = filepath;
      const code = (codeResult["code"] as string) ?? "";

      // Step B: Test + Fix loop
      const passed = await this.testAndFixLoop(task, code);
      if (passed) {
        task.status = "completed";
        task.completedAt = new Date();
        this.stats.completedTasks++;
        logger.info(`✅ ${task.title} — 完成`);
      } else {
        task.status = "failed";
        this.stats.failedTasks++;
        logger.warn(`⚠️ ${task.title} — 审查未通过`);
      }
    }

    logger.info(`\n开发阶段完成: ${this.stats.completedTasks}/${leaves.length} 通过`);
  }

  async dispatchDevelop(task: Task): Promise<Record<string, unknown> | null> {
    this.phase = "developing";

    const request = createMessage({
      msgType: "task_assign",
      sender: "orchestrator",
      receiver: "developer",
      content: {
        task: {
          title: task.title,
          description: task.description,
          context: task.context,
        },
        language: (task.context["language"] as string) ?? "typescript",
        use_llm: this.useLLM,
      },
    });

    const reply = await this.bus.sendAndWait(request, this.TASK_TIMEOUT);
    if (!reply || reply.msgType === "error") {
      logger.error(`Developer 无响应: ${task.title}`);
      return null;
    }

    return reply.content["result"] as Record<string, unknown> | null;
  }

  async testAndFixLoop(task: Task, code: string): Promise<boolean> {
    for (let iter = 0; iter <= this.MAX_FIX_ITERATIONS; iter++) {
      this.phase = "testing";

      const review = await this.dispatchTest(code);
      if (!review) return false;

      this.reviewResults[task.id] = {
        score: review["score"] as number,
        issues: (review["issues"] as Array<unknown>)?.length ?? 0,
      };

      const score = (review["score"] as number) ?? 0;
      const issues = (review["issues"] as Array<Record<string, unknown>>) ?? [];
      const errors = issues.filter((i) => i["severity"] === "error");

      logger.info(`  审查 #${iter}: 得分 ${score}/100, ${errors.length} 错误`);

      if (score >= this.REVIEW_PASS_THRESHOLD && errors.length === 0) {
        return true;
      }

      if (iter >= this.MAX_FIX_ITERATIONS) break;

      this.phase = "fixing";
      this.stats.fixIterations++;
      logger.info(`  🔧 修复迭代 ${iter + 1}/${this.MAX_FIX_ITERATIONS}...`);

      const fixedCode = await this.dispatchFix(code, issues);
      if (!fixedCode) return false;
      code = fixedCode;
    }

    return false;
  }

  async dispatchTest(code: string): Promise<Record<string, unknown> | null> {
    const request = createMessage({
      msgType: "task_assign",
      sender: "orchestrator",
      receiver: "tester",
      content: { code, language: "typescript", use_llm: this.useLLM },
    });

    const reply = await this.bus.sendAndWait(request, this.TASK_TIMEOUT);
    if (!reply || reply.msgType === "error") {
      logger.error("Tester 无响应");
      return null;
    }

    return reply.content["result"] as Record<string, unknown> | null;
  }

  async dispatchFix(code: string, issues: Array<Record<string, unknown>>): Promise<string | null> {
    const request = createMessage({
      msgType: "review_response",
      sender: "orchestrator",
      receiver: "developer",
      content: { code, issues, language: "typescript", use_llm: this.useLLM },
    });

    const reply = await this.bus.sendAndWait(request, this.TASK_TIMEOUT);
    if (!reply || reply.msgType === "error") {
      logger.error("Developer 修复失败");
      return null;
    }

    const result = reply.content["result"] as Record<string, unknown> | null;
    return (result?.["code"] as string) ?? null;
  }

  // ── Phase 3: Document ────────────────────────

  async phaseDocument(tree: Task): Promise<Record<string, unknown>> {
    logger.phase("📝 Phase 3/3: 文档生成");
    this.phase = "documenting";

    const projectContext = {
      name: tree.title,
      description: tree.description,
      modules: tree.children.map((mod) => ({
        title: mod.title,
        description: mod.description,
        features: mod.children.map((feat) => ({
          title: feat.title,
          description: feat.description,
          interfaces: (feat.context["interfaces"] as Array<Record<string, string>>) ?? [],
          steps: feat.children.map((s) => s.title),
        })),
      })),
    };

    const allInterfaces: Array<Record<string, string>> = [];
    for (const node of flattenTasks(tree)) {
      const ifaces = node.context["interfaces"] as Array<Record<string, string>> | undefined;
      if (ifaces) allInterfaces.push(...ifaces);
    }

    const allIssues: Array<Record<string, unknown>> = [];

    const request = createMessage({
      msgType: "task_assign",
      sender: "orchestrator",
      receiver: "documenter",
      content: {
        doc_type: "readme",
        project_context: projectContext,
        artifacts: this.artifacts,
        interfaces: allInterfaces,
        issues: allIssues,
        use_llm: this.useLLM,
      },
    });

    const reply = await this.bus.sendAndWait(request, this.TASK_TIMEOUT);
    if (!reply || reply.msgType === "error") {
      logger.error("Documenter 无响应");
      return {};
    }

    return (reply.content["result"] as Record<string, unknown>) ?? {};
  }

  // ── 结果 ─────────────────────────────────────

  private fail(reason: string): PipelineResult {
    this.phase = "failed";
    logger.error(`流水线失败: ${reason}`);
    return {
      status: "failed",
      stats: this.stats,
      artifacts: this.artifacts,
      reviewResults: this.reviewResults,
      documentation: { reason },
      outputDir: this.outputDir,
    };
  }
}
