#!/usr/bin/env tsx
/**
 * MACA 交互式使用入口 — 你输入需求，4 个 Agent 自动协同交付
 *
 * 用法: npx tsx use.ts "你的需求"
 *
 * 示例:
 *   npx tsx use.ts "开发一个文件上传 API"
 *   npx tsx use.ts "写一个用户注册登录系统"
 *   npx tsx use.ts "做一个命令行 todolist 工具"
 */

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve, relative } from "path";
import chalk from "chalk";
import { MessageBus } from "./src/message-bus.js";
import { PlannerAgent } from "./src/agents/planner.js";
import { DeveloperAgent } from "./src/agents/developer.js";
import { TesterAgent } from "./src/agents/tester.js";
import { DocumenterAgent } from "./src/agents/documenter.js";
import { flattenTasks, isLeafTask } from "./src/models/task.js";

async function main() {
  const requirement = process.argv[2];

  if (!requirement) {
    console.log(chalk.red("请提供需求描述！"));
    console.log(chalk.dim("\n用法: npx tsx use.ts \"你的需求\""));
    console.log(chalk.dim('\n示例: npx tsx use.ts "开发一个文件上传 API 服务"'));
    process.exit(1);
  }

  // 创建输出目录（放在当前目录下）
  const outputDir = resolve(process.cwd(), `maca_output_${Date.now()}`);
  mkdirSync(outputDir, { recursive: true });

  console.log(chalk.cyan.bold("\n🚀 MACA 多智能体协同开发系统"));
  console.log(chalk.dim("━".repeat(55)));
  console.log(chalk.white(`📝 你的需求: ${requirement}`));
  console.log(chalk.dim("━".repeat(55)));

  // 启动消息总线
  const bus = new MessageBus();
  bus.start();

  // 创建 4 个 Agent
  const planner = new PlannerAgent(bus);
  const developer = new DeveloperAgent(bus, undefined, outputDir);
  const tester = new TesterAgent(bus);
  const documenter = new DocumenterAgent(bus, undefined, resolve(outputDir, "docs"));

  const agents = [planner, developer, tester, documenter];
  for (const agent of agents) await agent.start();

  // ═══════════════ Step 1: 需求拆解 ═══════════
  console.log(chalk.yellow.bold("\n📋 [1/4] Planner 工作中 — 拆解需求..."));
  const tree = planner.ruleDecompose(requirement);
  const leaves = flattenTasks(tree).filter(isLeafTask);
  console.log(chalk.green(`   ✅ 拆解完成: ${tree.children.length} 个模块, ${leaves.length} 个开发任务`));
  for (const mod of tree.children) {
    console.log(chalk.dim(`      📦 ${mod.title} (${mod.children.length} 功能)`));
  }

  // ═══════════════ Step 2: 代码开发 ═══════════
  console.log(chalk.yellow.bold(`\n🔨 [2/4] Developer 工作中 — 生成代码...`));
  const maxTasks = Math.min(8, leaves.length);
  const artifacts: Record<string, string> = {};

  for (let i = 0; i < maxTasks; i++) {
    const task = leaves[i]!;
    process.stdout.write(chalk.dim(`   [${i + 1}/${maxTasks}] ${task.title.slice(0, 50)}...`));
    const result = developer.templateDevelop(
      task.title, task.description,
      (task.context["interfaces"] as Array<Record<string, string>>) ?? [],
      "typescript"
    );
    const fp = developer.saveCode(result);
    artifacts[task.id] = fp;
    console.log(chalk.green(` ✅ ${relative(outputDir, fp)}`));
  }

  // ═══════════════ Step 3: 代码审查 ═══════════
  console.log(chalk.yellow.bold(`\n🧪 [3/4] Tester 工作中 — 审查代码...`));
  let totalIssues = 0;
  let totalScore = 0;

  for (const [taskId, filepath] of Object.entries(artifacts)) {
    const code = readFileSync(filepath, "utf-8");
    const review = await tester.review(code, "typescript", false);
    totalIssues += review.issues.length;
    totalScore += review.score;
    const icon = review.passed ? "✅" : "⚠️";
    process.stdout.write(
      chalk.dim(`   ${icon} ${relative(outputDir, filepath)}: ${review.score}/100`)
    );
    if (review.issues.length > 0) {
      console.log(chalk.yellow(` (${review.issues.length} 个建议)`));
    } else {
      console.log("");
    }
  }

  // ═══════════════ Step 4: 文档输出 ═══════════
  console.log(chalk.yellow.bold(`\n📝 [4/4] Documenter 工作中 — 生成文档...`));

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
  console.log(chalk.dim(`   ✅ README.md`));

  const retro = await documenter.generateRetrospective(projectCtx, artifacts, [], false);
  const retroPath = documenter.saveDocument(retro);
  console.log(chalk.dim(`   ✅ 复盘报告.md`));

  // ═══════════════ 交付 ═══════════════
  console.log(chalk.green.bold(`\n${"━".repeat(55)}`));
  console.log(chalk.green.bold("  ✅ 多智能体协同开发完成！"));
  console.log(chalk.green.bold("━".repeat(55)));
  console.log("");
  console.log(chalk.white("  📊 交付清单:"));
  console.log(chalk.white(`     模块拆解:  ${tree.children.length} 个`));
  console.log(chalk.white(`     代码文件:  ${Object.keys(artifacts).length} 个`));
  console.log(chalk.white(`     代码审查:  ${totalIssues} 个建议`));
  console.log(chalk.white(`     生成文档:  2 份`));
  console.log("");
  console.log(chalk.cyan(`  📁 所有文件在这里 → ${outputDir}`));
  console.log("");

  // 列出文件
  for (const f of Object.values(artifacts)) {
    console.log(chalk.dim(`     ${relative(outputDir, f)}`));
  }
  console.log(chalk.dim(`     docs/README.md`));
  console.log(chalk.dim(`     docs/复盘报告.md`));
  console.log("");

  // 清理
  for (const agent of agents) await agent.stop();
  bus.shutdown();
}

main().catch((err) => {
  console.error(chalk.red("出错了:"), err);
  process.exit(1);
});
