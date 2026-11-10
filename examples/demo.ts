#!/usr/bin/env tsx
/**
 * MACA 端到端演示脚本
 *   npx tsx examples/demo.ts
 */

import { mkdirSync } from "fs";
import { resolve, relative } from "path";
import { tmpdir } from "os";
import chalk from "chalk";
import { MessageBus } from "../src/message-bus.js";
import { PlannerAgent } from "../src/agents/planner.js";
import { DeveloperAgent } from "../src/agents/developer.js";
import { TesterAgent } from "../src/agents/tester.js";
import { DocumenterAgent } from "../src/agents/documenter.js";
import { flattenTasks, isLeafTask } from "../src/models/task.js";
import { readFileSync } from "fs";

async function main(): Promise<void> {
  console.log(chalk.cyan.bold("MACA — Multi-Agent Collaborative Architect"));
  console.log(chalk.dim("多智能体协同开发助手系统 — 端到端演示\n"));

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

  console.log(chalk.green("🤖 四大核心 Agent 就绪:"));
  const roles = [
    "📋 需求分析 & 任务拆解",
    "🔨 代码编写 & 实现",
    "🧪 代码审查 & BUG 检测",
    "📝 文档生成 & 项目复盘",
  ];
  for (let i = 0; i < agents.length; i++) {
    console.log(`  • ${chalk.cyan(agents[i]!.role)} — ${roles[i]}`);
  }

  // Step 1
  const requirement = "开发一个用户认证 API 服务，支持邮箱注册、JWT 登录、密码重置";
  console.log(chalk.yellow.bold("\n━━━ 📋 Step 1: 需求拆解 ━━━"));
  console.log(`  输入: ${requirement}`);

  const tree = planner.ruleDecompose(requirement);
  console.log(chalk.green(`  ✅ ${tree.children.length} 个模块`));
  for (const mod of tree.children) {
    const steps = mod.children.reduce((s, f) => s + f.children.length, 0);
    console.log(`    ├─ 📦 ${mod.title} (${mod.children.length} 功能, ${steps} 步骤)`);
  }

  // Step 2
  const leaves = flattenTasks(tree).filter(isLeafTask);
  console.log(chalk.yellow.bold(`\n━━━ 🔨 Step 2: 代码开发 (${Math.min(5, leaves.length)}/${leaves.length}) ━━━`));

  const artifacts: Record<string, string> = {};
  for (let i = 0; i < Math.min(5, leaves.length); i++) {
    const task = leaves[i]!;
    console.log(`  [${i + 1}] 🔨 ${task.title}...`);
    const result = developer.templateDevelop(
      task.title, task.description,
      (task.context["interfaces"] as Array<Record<string, string>>) ?? [],
      "typescript"
    );
    const fp = developer.saveCode(result);
    artifacts[task.id] = fp;
    console.log(`      ✅ ${relative(outputDir, fp)} (${result.code.length} 字符)`);
  }

  // Step 3
  console.log(chalk.yellow.bold("\n━━━ 🧪 Step 3: 代码审查 ━━━\n"));

  let totalIssues = 0;
  for (const [taskId, filepath] of Object.entries(artifacts)) {
    const code = readFileSync(filepath, "utf-8");
    console.log(`  🔍 审查 ${chalk.cyan(relative(outputDir, filepath))}...`);
    const review = await tester.review(code, "typescript", false);
    const icon = review.passed ? "✅" : "❌";
    console.log(`     ${icon} ${review.score}/100 (${review.issues.length} 问题)`);
    totalIssues += review.issues.length;
  }

  // Step 4
  console.log(chalk.yellow.bold("\n━━━ 📝 Step 4: 文档生成 ━━━\n"));

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

  console.log("  📄 生成 README...");
  const readme = await documenter.generateReadme(projectCtx, artifacts, false);
  const rp = documenter.saveDocument(readme);
  console.log(`      ✅ ${relative(outputDir, rp)}`);

  console.log("  📄 生成 API 文档...");
  const allIfaces: Array<Record<string, string>> = [];
  for (const node of flattenTasks(tree)) {
    const ifaces = node.context["interfaces"] as Array<Record<string, string>> | undefined;
    if (ifaces) allIfaces.push(...ifaces);
  }
  const apiDoc = await documenter.generateApiDoc(allIfaces, artifacts, false);
  const ap = documenter.saveDocument(apiDoc);
  console.log(`      ✅ ${relative(outputDir, ap)}`);

  console.log("  📄 生成复盘报告...");
  const retro = await documenter.generateRetrospective(projectCtx, artifacts, [], false);
  const rtp = documenter.saveDocument(retro);
  console.log(`      ✅ ${relative(outputDir, rtp)}`);

  // Summary
  console.log(chalk.green.bold(`\n${"=".repeat(50)}`));
  console.log(chalk.green.bold("  ✅ 多智能体协同开发演示完成!"));
  console.log(chalk.green.bold("=".repeat(50)));
  console.log(`\n  📊 统计:`);
  console.log(`    模块: ${tree.children.length} | 任务: ${leaves.length} | 代码: ${Object.keys(artifacts).length}`);
  console.log(`    问题: ${totalIssues} | 文档: 3 份`);
  console.log(`\n  📁 输出: ${outputDir}`);

  for (const agent of agents) await agent.stop();
  bus.shutdown();
}

main().catch(console.error);
