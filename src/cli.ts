#!/usr/bin/env node
/**
 * MACA CLI — 多智能体协同开发助手命令行入口
 *
 *   maca run "开发一个XXX"
 *   maca demo
 *   maca plan "需求"
 *   maca review <file>
 */

import { Command } from "commander";
import chalk from "chalk";
import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { resolve, relative, dirname } from "path";
import { tmpdir } from "os";
import { MessageBus } from "./message-bus.js";
import { PlannerAgent } from "./agents/planner.js";
import { DeveloperAgent } from "./agents/developer.js";
import { TesterAgent } from "./agents/tester.js";
import { DocumenterAgent } from "./agents/documenter.js";
import { Orchestrator } from "./orchestrator.js";
import { createTask, flattenTasks, isLeafTask } from "./models/task.js";

const program = new Command();

function printBanner(): void {
  console.log("");
  console.log(chalk.cyan.bold("  MACA — Multi-Agent Collaborative Architect"));
  console.log(chalk.dim("  多智能体协同开发助手系统 v0.1.0"));
  console.log("");
}

program.name("maca").description("多智能体协同开发助手系统").version("0.1.0");

// ── run ─────────────────────────────────────────

program
  .command("run [requirement]")
  .description("启动完整开发流水线")
  .option("--no-llm", "禁用 LLM 增强")
  .option("-o, --output <dir>", "输出目录", "./output")
  .action(async (requirement: string | undefined, opts: { llm: boolean; output: string }) => {
    printBanner();
    if (!requirement) {
      console.log("请输入项目需求:");
      return;
    }
    console.log(chalk.bold(`需求: ${requirement}\n`));

    const bus = new MessageBus();
    bus.start();

    const agents = [
      new PlannerAgent(bus),
      new DeveloperAgent(bus, undefined, opts.output),
      new TesterAgent(bus),
      new DocumenterAgent(bus, undefined, `${opts.output}/docs`),
    ];
    const orch = new Orchestrator(bus, opts.output);

    for (const agent of agents) await agent.start();
    await orch.start();
    console.log(chalk.green("✅ 所有 Agent 已就绪\n"));

    const result = await orch.runPipeline(requirement);

    if (result.status === "completed") {
      console.log("");
      console.log(chalk.green.bold("📊 流水线统计:"));
      console.log(`  总任务: ${result.stats.totalTasks}`);
      console.log(`  完成: ${result.stats.completedTasks}`);
      console.log(`  修复迭代: ${result.stats.fixIterations}`);
      if (result.stats.elapsedSeconds) {
        console.log(`  耗时: ${result.stats.elapsedSeconds.toFixed(1)}s`);
      }
      console.log(`\n${chalk.green(`📁 输出目录: ${opts.output}`)}`);
    } else {
      console.log(chalk.red(`\n❌ 流水线失败: ${result.documentation["reason"]}`));
    }

    for (const agent of agents) await agent.stop();
    await orch.stop();
    bus.shutdown();
  });

// ── demo ────────────────────────────────────────

program
  .command("demo")
  .description("运行端到端演示（规则模式，无需 LLM）")
  .action(async () => {
    printBanner();
    console.log(chalk.yellow.bold("🎬 启动端到端演示...\n"));

    const bus = new MessageBus();
    bus.start();

    const outputDir = resolve(tmpdir(), `maca_demo_${Date.now()}`);
    mkdirSync(outputDir, { recursive: true });

    const planner = new PlannerAgent(bus);
    const developer = new DeveloperAgent(bus, undefined, outputDir);
    const tester = new TesterAgent(bus);
    const documenter = new DocumenterAgent(bus, undefined, resolve(outputDir, "docs"));

    const agents = [planner, developer, tester, documenter];
    for (const agent of agents) await agent.start();

    console.log(chalk.green("✅ 4 个 Agent 已就绪:"));
    const names = ["planner", "developer", "tester", "documenter"];
    const icons = ["📋", "🔨", "🧪", "📝"];
    const descs = ["需求分析 & 任务拆解", "代码编写 & 实现", "代码审查 & BUG 检测", "文档生成 & 项目复盘"];
    for (let i = 0; i < agents.length; i++) {
      console.log(`  ${icons[i]} ${chalk.cyan(names[i])} — ${descs[i]}`);
    }

    // Step 1: Plan
    const requirement = "开发一个用户认证 API 服务，支持邮箱注册、JWT 登录、密码重置";
    console.log(chalk.cyan.bold("\n📋 Step 1: 需求拆解"));
    console.log(`  输入: ${requirement}`);

    const tree = planner.ruleDecompose(requirement);
    console.log(chalk.green(`  ✅ ${tree.children.length} 个模块`));
    for (const mod of tree.children) {
      const features = mod.children.length;
      const steps = mod.children.reduce((s, f) => s + f.children.length, 0);
      console.log(`    ├─ 📦 ${chalk.bold(mod.title)} (${features} 功能, ${steps} 步骤)`);
    }

    // Step 2: Develop
    const leaves = flattenTasks(tree).filter(isLeafTask);
    console.log(chalk.cyan.bold(`\n🔨 Step 2: 代码开发 (${Math.min(5, leaves.length)}/${leaves.length} 个任务)`));

    const artifacts: Record<string, string> = {};
    for (let i = 0; i < Math.min(5, leaves.length); i++) {
      const task = leaves[i]!;
      console.log(`  [${i + 1}] 🔨 ${task.title}...`);
      const result = developer.templateDevelop(
        task.title,
        task.description,
        (task.context["interfaces"] as Array<Record<string, string>>) ?? [],
        "typescript"
      );
      const fp = developer.saveCode(result);
      artifacts[task.id] = fp;
      console.log(`      ✅ ${relative(outputDir, fp)}`);
    }

    // Step 3: Test
    console.log(chalk.cyan.bold("\n🧪 Step 3: 代码审查"));
    let totalIssues = 0;
    for (const [taskId, filepath] of Object.entries(artifacts)) {
      const code = readFileSync(filepath, "utf-8");
      const review = await tester.review(code, "typescript", false);
      const icon = review.passed ? "✅" : "❌";
      console.log(`  ${icon} ${relative(outputDir, filepath)}: ${review.score}/100 (${review.issues.length} 问题)`);
      totalIssues += review.issues.length;
    }

    // Step 4: Document
    console.log(chalk.cyan.bold("\n📝 Step 4: 文档生成"));

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

    const readme = await documenter.generateReadme(projectCtx, artifacts, false);
    const readmePath = documenter.saveDocument(readme);
    console.log(`  ✅ README: ${relative(outputDir, readmePath)}`);

    const retro = await documenter.generateRetrospective(projectCtx, artifacts, [], false);
    const retroPath = documenter.saveDocument(retro);
    console.log(`  ✅ 复盘: ${relative(outputDir, retroPath)}`);

    // Summary
    console.log(chalk.green.bold(`\n${"=".repeat(50)}`));
    console.log(chalk.green.bold("  ✅ 演示完成!"));
    console.log(chalk.green.bold("=".repeat(50)));
    console.log(`  模块: ${tree.children.length} | 任务: ${leaves.length} | 代码: ${Object.keys(artifacts).length} | 问题: ${totalIssues}`);
    console.log(`  📁 ${outputDir}`);

    for (const agent of agents) await agent.stop();
    bus.shutdown();
  });

// ── plan ────────────────────────────────────────

program
  .command("plan <requirement>")
  .description("仅运行需求拆解")
  .option("--no-llm", "禁用 LLM")
  .action(async (requirement: string, opts: { llm: boolean }) => {
    printBanner();
    const bus = new MessageBus();
    bus.start();

    const planner = new PlannerAgent(bus);
    await planner.start();

    const tree = await planner.decompose(requirement, opts.llm);
    console.log(`\n${chalk.bold("项目:")} ${tree.title}`);
    console.log(`${chalk.bold("模块:")} ${tree.children.length}`);
    console.log(`${chalk.bold("总节点:")} ${flattenTasks(tree).length}\n`);

    function print(t: typeof tree, indent = 0): void {
      const prefix = "  ".repeat(indent) + (indent > 0 ? "├─ " : "");
      const icon = { pending: "⏳", in_progress: "🔄", completed: "✅", failed: "❌", blocked: "🔒", awaiting_review: "👁️" }[
        t.status
      ] ?? "❓";
      console.log(`${prefix}${icon} ${t.title}`);
      for (const child of t.children) print(child, indent + 1);
    }
    print(tree);

    await planner.stop();
    bus.shutdown();
  });

// ── review ──────────────────────────────────────

program
  .command("review <file>")
  .description("仅运行代码审查")
  .option("--no-llm", "禁用 LLM")
  .action(async (file: string, opts: { llm: boolean }) => {
    printBanner();
    const bus = new MessageBus();
    bus.start();

    const tester = new TesterAgent(bus);
    await tester.start();

    const code = readFileSync(file, "utf-8");
    const ext = file.split(".").pop() ?? "ts";
    const langMap: Record<string, string> = { ts: "typescript", tsx: "typescript", py: "python", go: "go", rs: "rust" };
    const language = langMap[ext] ?? "typescript";

    console.log(`\n${chalk.bold("审查文件:")} ${file} (${language})\n`);
    const result = await tester.review(code, language, opts.llm);
    console.log(tester.formatReport(result));

    await tester.stop();
    bus.shutdown();
  });

program.parse();
