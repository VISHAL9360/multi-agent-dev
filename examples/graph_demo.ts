/**
 * 用自研 Mini LangGraph 编排 MACA 的四个 Agent
 *
 * 对比原来的硬编码 Orchestrator，现在是声明式图：
 *
 *   [Plan] → [Develop] → [Test] ⇄ [Fix] → [Document] → [Done]
 *                        ↑______|（条件边：未通过就循环修复）
 */

import { StateGraph } from "../src/langgraph.js";
import { PlannerAgent } from "../src/agents/planner.js";
import { DeveloperAgent } from "../src/agents/developer.js";
import { TesterAgent } from "../src/agents/tester.js";
import { DocumenterAgent } from "../src/agents/documenter.js";
import { MessageBus } from "../src/message-bus.js";
import type { Task } from "../src/models/task.js";
import { mkdirSync } from "fs";
import { resolve } from "path";

// ── 定义 State 类型 ────────────────────────────

interface AgentState {
  requirement: string;
  taskTree: Task | null;
  currentTaskIndex: number;
  tasks: Task[];
  code: string;
  reviewResult: Record<string, unknown> | null;
  fixCount: number;
  docs: string;
  done: boolean;
}

// ── 构建图 ─────────────────────────────────────

async function buildGraph(): Promise<(req: string) => Promise<AgentState>> {
  const bus = new MessageBus();
  bus.start();

  const planner = new PlannerAgent(bus);
  const developer = new DeveloperAgent(bus);
  const tester = new TesterAgent(bus);
  const documenter = new DocumenterAgent(bus);

  const outputDir = resolve(process.cwd(), "maca_output");
  mkdirSync(outputDir, { recursive: true });
  developer["outputDir"] = outputDir;

  const graph = new StateGraph<AgentState>();

  // ── 节点 1: 规划 ──
  graph.addNode("plan", async (state) => {
    console.log("  📋 Planner 拆解需求...");
    const tree = await planner.decompose(state.requirement, true);
    return {
      taskTree: tree,
      tasks: flattenAll(tree).filter((t) => t.children.length === 0),
      currentTaskIndex: 0,
    };
  });

  // ── 节点 2: 开发 ──
  graph.addNode("develop", async (state) => {
    const task = state.tasks[state.currentTaskIndex];
    if (!task) return { done: true };

    console.log(`  🔨 Developer 写代码: ${task.title}`);
    const result = await developer.develop(
      task.title,
      task.description,
      (task.context["interfaces"] as Array<Record<string, string>>) ?? [],
      "typescript",
      true
    );
    return { code: result.code };
  });

  // ── 节点 3: 测试 ──
  graph.addNode("test", async (state) => {
    console.log("  🧪 Tester 审查代码...");
    const result = await tester.review(state.code, "typescript", true);
    return { reviewResult: result as unknown as Record<string, unknown>, fixCount: 0 };
  });

  // ── 节点 4: 修复 ──
  graph.addNode("fix", async (state) => {
    const issues = (state.reviewResult?.["issues"] as Array<Record<string, unknown>>) ?? [];
    console.log(`  🔧 Developer 修复 ${issues.length} 个问题...`);
    const code = await developer.fixCode(state.code, issues, "typescript");
    return { code, fixCount: (state.fixCount ?? 0) + 1 };
  });

  // ── 节点 5: 文档 ──
  graph.addNode("document", async (state) => {
    console.log("  📝 Documenter 生成文档...");
    const tree = state.taskTree!;
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
    const doc = await documenter.generateReadme(projectCtx, {}, true);
    return { docs: doc.content };
  });

  // ── 连线 ─────────────────────────────────────

  graph.addEdge("plan", "develop");
  graph.addEdge("develop", "test");
  graph.addEdge("fix", "test");   // 修完 → 再测
  graph.addEdge("document", "__END__");

  // ── 条件边：测试结果决定下一步 ──
  graph.addConditionalEdges("test", (state) => {
    const score = (state.reviewResult?.["score"] as number) ?? 0;
    const errors = (state.reviewResult?.["issues"] as Array<Record<string, unknown>>) ?? [];
    const errorCount = errors.filter((i) => i["severity"] === "error").length;
    const fixCount = state.fixCount ?? 0;

    if (score >= 80 && errorCount === 0) {
      // 通过 → 下一个任务或文档
      const nextIndex = (state.currentTaskIndex ?? 0) + 1;
      return nextIndex < state.tasks.length ? "develop" : "document";
    }
    if (fixCount >= 3) {
      // 修了 3 次还不行 → 放弃，继续下一个
      console.log("  ⚠️ 已达最大修复次数，跳过此任务");
      const nextIndex = (state.currentTaskIndex ?? 0) + 1;
      return nextIndex < state.tasks.length ? "develop" : "document";
    }
    return "fix"; // 继续修
  });

  graph.setEntryPoint("plan");

  const run = graph.compile();

  // 包装成只需要 requirement 的函数
  return async (requirement: string) => {
    return run({
      requirement,
      taskTree: null,
      currentTaskIndex: 0,
      tasks: [],
      code: "",
      reviewResult: null,
      fixCount: 0,
      docs: "",
      done: false,
    });
  };
}

// ── 工具 ───────────────────────────────────────

function flattenAll(task: Task): Task[] {
  const r = [task];
  for (const c of task.children) r.push(...flattenAll(c));
  return r;
}

// ── 入口 ───────────────────────────────────────

async function main() {
  const requirement = process.argv[2] || "开发一个用户管理系统";
  console.log(`\n🚀 LangGraph 模式启动: ${requirement}\n`);

  const run = await buildGraph();
  const result = await run(requirement);

  console.log(`\n✅ 完成! 规划了 ${result.tasks.length} 个任务`);
  console.log(`   文档长度: ${result.docs.length} 字符`);
}

main().catch(console.error);
