/**
 * 企业级 Orchestrator — 集成检查点、流式进度、工具调用、人工审核
 */

import { BaseAgent } from "./agents/base.js";
import { MessageBus, messageBus } from "./message-bus.js";
import { PlannerAgent } from "./agents/planner.js";
import { DeveloperAgent } from "./agents/developer.js";
import { TesterAgent } from "./agents/tester.js";
import { DocumenterAgent } from "./agents/documenter.js";
import { ToolExecutor, toolExecutor } from "./services/tools.js";
import { CheckpointManager, Checkpoint } from "./services/checkpoint.js";
import { ProgressEmitter, ApprovalGate, shouldRequestApproval, ApprovalRequest } from "./services/progress.js";
import { AgentRole, Message, MessageType, Task, createMessage, createTask, flattenTasks, isLeafTask } from "./models/task.js";
import { logger } from "./utils/logger.js";
import { ragIndex } from "./services/rag.js";
import chalk from "chalk";

export class EnterpriseOrchestrator extends BaseAgent {
  readonly role: AgentRole = "orchestrator";

  // 企业级组件
  readonly progress = ProgressEmitter.getInstance();
  readonly approval = new ApprovalGate();
  readonly tools: ToolExecutor;
  readonly checkpoints: CheckpointManager;

  // 配置
  private TASK_TIMEOUT = 120_000;
  private MAX_FIX_ITERATIONS = 3;
  private REVIEW_PASS_THRESHOLD = 80;
  private outputDir = "./maca_output";
  private projectId = "";

  // 运行时状态
  private phase: string = "idle";
  private taskTree: Task | null = null;
  private artifacts: Record<string, string> = {};
  private reviewResults: Record<string, { score: number; issues: number }> = {};
  private completedTaskIds: string[] = [];
  private failedTaskIds: string[] = [];
  private currentTaskIndex = 0;
  private requirement = "";
  private startTime = 0;

  constructor(bus?: MessageBus, outputDir?: string) {
    super(bus ?? messageBus);
    this.outputDir = outputDir ?? this.outputDir;
    this.tools = toolExecutor;
    this.checkpoints = new CheckpointManager();
    if (process.env["MACA_TEST_MODE"]) this.TASK_TIMEOUT = 5000;
  }

  // ═══════════════════════════════════════════════
  // 消息处理
  // ═══════════════════════════════════════════════

  async processMessage(message: Message): Promise<void> {
    if (message.msgType === "task_assign") {
      const req = message.content["requirement"] as string;
      if (!req) { await this.sendError(message, "缺少需求"); return; }
      this.runPipeline(req).then((r) => this.sendTaskResult(message, r as Record<string, unknown>));
    } else if (message.msgType === "error") {
      logger.error(`[${message.sender}] ${String(message.content["error"])}`);
    }
  }

  // ═══════════════════════════════════════════════
  // 主流水线
  // ═══════════════════════════════════════════════

  async runPipeline(requirement: string): Promise<Record<string, unknown>> {
    this.requirement = requirement;
    this.projectId = `proj-${Date.now().toString(36)}`;
    this.startTime = Date.now();
    this.phase = "planning";

    // 检查是否有保存的检查点
    const saved = this.checkpoints.load(this.projectId);
    if (saved) {
      this.progress.emitProgress("recovery", "发现未完成的进度，从断点恢复...", 5);
      this.taskTree = saved.taskTree;
      this.completedTaskIds = saved.completedTaskIds;
      this.failedTaskIds = saved.failedTaskIds;
      this.currentTaskIndex = saved.currentTaskIndex;
      this.artifacts = saved.artifacts;
      this.reviewResults = saved.reviewResults;
    }

    this.progress.emitProgress("start", "流水线启动", 0);

    // RAG: 索引项目已有文件作为知识库
    this.progress.emitProgress("rag", "索引项目文件...", 2);
    const indexed = ragIndex.indexDirectory(".");
    if (indexed > 0) {
      this.progress.emitProgress("rag", `RAG 知识库就绪: ${indexed} 个文件`, 5);
    }

    try {
      // Phase 1: Plan
      if (!this.taskTree) {
        this.taskTree = await this.phasePlan(requirement);
        if (!this.taskTree) throw new Error("规划失败");
      }

      // Phase 2: Develop + Test
      await this.phaseDevelopAndTest(this.taskTree);

      // Phase 3: Document
      const docs = await this.phaseDocument(this.taskTree);

      this.phase = "done";
      const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
      this.progress.emitProgress("done", `全部完成，耗时 ${elapsed}s`, 100);

      return {
        status: "completed",
        projectId: this.projectId,
        projectName: this.taskTree.title,
        stats: {
          totalTasks: flattenTasks(this.taskTree).filter(isLeafTask).length,
          completedTasks: this.completedTaskIds.length,
          failedTasks: this.failedTaskIds.length,
          elapsedSeconds: parseFloat(elapsed),
        },
        artifacts: this.artifacts,
        reviewResults: this.reviewResults,
        documentation: docs,
        outputDir: this.outputDir,
      };
    } catch (err) {
      this.phase = "failed";
      this.progress.emitProgress("failed", String(err), 0);
      return { status: "failed", reason: String(err) };
    }
  }

  // ── Phase 1: Plan ─────────────────────────────

  private async phasePlan(requirement: string): Promise<Task | null> {
    this.phase = "planning";
    this.progress.emitProgress("planning", "Planner 正在拆解需求...", 10);

    const planner = new PlannerAgent(this.bus);
    await planner.start();
    const tree = await planner.decompose(requirement, true);
    await planner.stop();

    if (!tree) {
      this.progress.emitProgress("planning", "拆解失败", 10);
      return null;
    }

    this.progress.emitProgress(
      "planning",
      `拆解完成: ${tree.children.length} 个模块`,
      25
    );
    return tree;
  }

  // ── Phase 2: Develop + Test ──────────────────

  private async phaseDevelopAndTest(tree: Task): Promise<void> {
    this.phase = "developing";
    const leaves = flattenTasks(tree).filter(isLeafTask);
    const total = leaves.length;

    // 跳过已完成的
    const pending = leaves
      .map((t, i) => ({ task: t, index: i }))
      .filter(({ task }) => !this.completedTaskIds.includes(task.id));

    this.progress.emitProgress("developing", `共 ${total} 个任务，${pending.length} 个待执行`, 25);

    for (const { task, index } of pending) {
      this.currentTaskIndex = index;
      const pct = 25 + Math.floor((index / total) * 50);

      this.progress.emitProgress("developing", `[${index + 1}/${total}] ${task.title}`, pct);

      task.status = "in_progress";
      const developer = new DeveloperAgent(this.bus, undefined, this.outputDir);
      const tester = new TesterAgent(this.bus);

      await developer.start();
      await tester.start();

      // 开发
      this.progress.emitProgress("developing", `Developer 正在写: ${task.title}`, pct + 2);
      const codeResult = await developer.develop(
        task.title, task.description,
        (task.context["interfaces"] as Array<Record<string, string>>) ?? [],
        "typescript", true
      );
      const filepath = developer.saveCode(codeResult);
      this.artifacts[task.id] = filepath;

      // 审查 + 修复循环
      let code = codeResult.code;
      let passed = false;

      for (let iter = 0; iter <= this.MAX_FIX_ITERATIONS; iter++) {
        this.progress.emitProgress("testing", `Tester 审查中 (${iter + 1}/${this.MAX_FIX_ITERATIONS + 1})`, pct + 3);

        const review = await tester.review(code, "typescript", true);

        // 人工审核门禁
        const approvals = shouldRequestApproval(
          (review.issues as Array<{ severity: string; category: string }>)
        );
        if (approvals.length > 0) {
          this.progress.emitProgress("approval", `发现 ${approvals.length} 个需人工审核的问题`, pct + 4);
          for (const approval of approvals) {
            const decision = await this.approval.requestApproval(approval, 30000);
            if (decision === "reject") {
              this.progress.emitProgress("approval", "人工审核驳回，标记失败", pct + 4);
              passed = false;
              break;
            }
          }
        }

        this.reviewResults[task.id] = {
          score: review.score,
          issues: review.issues.length,
        };

        const errors = review.issues.filter((i) => i.severity === "error");

        if (review.score >= this.REVIEW_PASS_THRESHOLD && errors.length === 0) {
          passed = true;
          break;
        }

        if (iter >= this.MAX_FIX_ITERATIONS) break;

        // 修复
        this.progress.emitProgress("fixing", `Developer 修复 ${review.issues.length} 个问题`, pct + 4);
        code = await developer.fixCode(code, review.issues as unknown as Record<string, unknown>[], "typescript");
      }

      if (passed) {
        this.completedTaskIds.push(task.id);
        task.status = "completed";
      } else {
        this.failedTaskIds.push(task.id);
        task.status = "failed";
      }

      await developer.stop();
      await tester.stop();

      // 保存检查点
      this.saveCheckpoint();
    }

    this.progress.emitProgress("developing", `开发完成: ${this.completedTaskIds.length}/${total} 通过`, 75);
  }

  // ── Phase 3: Document ────────────────────────

  private async phaseDocument(tree: Task): Promise<Record<string, unknown>> {
    this.phase = "documenting";
    this.progress.emitProgress("documenting", "Documenter 生成文档...", 85);

    const documenter = new DocumenterAgent(this.bus, undefined, this.outputDir + "/docs");
    await documenter.start();

    const projectCtx = {
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

    const readme = await documenter.generateReadme(projectCtx, this.artifacts, true);
    const readmePath = documenter.saveDocument(readme);

    const retro = await documenter.generateRetrospective(projectCtx, this.artifacts, [], true);
    documenter.saveDocument(retro);

    this.progress.emitProgress("documenting", "文档生成完成", 95);

    await documenter.stop();
    return { readme: readme.content, readmePath };
  }

  // ── 检查点 ───────────────────────────────────

  private saveCheckpoint(): void {
    this.checkpoints.save({
      projectId: this.projectId,
      requirement: this.requirement,
      taskTree: this.taskTree!,
      completedTaskIds: this.completedTaskIds,
      failedTaskIds: this.failedTaskIds,
      currentTaskIndex: this.currentTaskIndex,
      artifacts: this.artifacts,
      reviewResults: this.reviewResults,
      timestamp: Date.now(),
      version: 0,
    });
  }

  // ── 工具调用代理 ─────────────────────────────

  /** 让 Agent 可以使用工具：把工具列表注入 System Prompt */
  getToolAugmentedPrompt(basePrompt: string): string {
    return `${basePrompt}\n\n## 可用工具\n${this.tools.getToolPrompt()}\n\n需要调用工具时使用格式:\n<tool_call name="工具名">{"参数":"值"}</tool_call>`;
  }
}
