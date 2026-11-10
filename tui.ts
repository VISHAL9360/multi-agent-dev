#!/usr/bin/env tsx
/**
 * MACA TUI — 多智能体协同开发交互式控制台
 *
 * 用法: npx tsx tui.ts
 *
 * 进入后输入命令:
 *   run 开发一个XXX    →  启动完整流水线
 *   demo              →  运行演示
 *   plan 需求          →  仅拆解需求
 *   status            →  查看 Agent 状态
 *   help              →  帮助
 *   exit              →  退出
 */

import * as readline from "readline";
import { mkdirSync, readFileSync } from "fs";
import { resolve, relative } from "path";
import chalk from "chalk";
import { MessageBus } from "./src/message-bus.js";
import { PlannerAgent } from "./src/agents/planner.js";
import { DeveloperAgent } from "./src/agents/developer.js";
import { TesterAgent } from "./src/agents/tester.js";
import { DocumenterAgent } from "./src/agents/documenter.js";
import type { Task } from "./src/models/task.js";

// ── 全局状态 ──────────────────────────────────
let bus: MessageBus;
let planner: PlannerAgent;
let developer: DeveloperAgent;
let tester: TesterAgent;
let documenter: DocumenterAgent;
let running = false;

function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[H");
}

function printHeader() {
  console.log("");
  console.log(chalk.cyan.bold("  ╔══════════════════════════════════════════════════╗"));
  console.log(chalk.cyan.bold("  ║") + chalk.white.bold("   MACA — Multi-Agent Collaborative Architect     ") + chalk.cyan.bold("║"));
  console.log(chalk.cyan.bold("  ║") + chalk.dim("   多智能体协同开发助手 · 交互式控制台              ") + chalk.cyan.bold("║"));
  console.log(chalk.cyan.bold("  ╚══════════════════════════════════════════════════╝"));
  console.log("");
}

function printAgentPanel() {
  console.log(chalk.dim("  ┌─ Agent 状态 ──────────────────────────────────────┐"));
  const agents = [
    { icon: "📋", name: "Planner", role: "需求分析 & 任务拆解", status: planner.isRunning },
    { icon: "🔨", name: "Developer", role: "代码编写 & 实现", status: developer.isRunning },
    { icon: "🧪", name: "Tester", role: "代码审查 & BUG 检测", status: tester.isRunning },
    { icon: "📝", name: "Documenter", role: "文档生成 & 项目复盘", status: documenter.isRunning },
  ];
  for (const a of agents) {
    const statusIcon = a.status ? chalk.green("● 在线") : chalk.red("○ 离线");
    console.log(chalk.dim(`  │  ${a.icon} ${chalk.cyan(a.name.padEnd(12))} ${statusIcon}  ${chalk.dim(a.role)}${" ".repeat(8)}│`));
  }
  console.log(chalk.dim("  └────────────────────────────────────────────────────┘"));
}

function printCommands() {
  console.log(chalk.dim("  ┌─ 命令 ────────────────────────────────────────────┐"));
  console.log(chalk.dim("  │") + chalk.white("  run <需求描述>   ") + chalk.dim("启动完整开发流水线          │"));
  console.log(chalk.dim("  │") + chalk.white("  demo             ") + chalk.dim("运行端到端演示              │"));
  console.log(chalk.dim("  │") + chalk.white("  plan <需求>      ") + chalk.dim("仅需求拆解                  │"));
  console.log(chalk.dim("  │") + chalk.white("  status           ") + chalk.dim("刷新 Agent 状态             │"));
  console.log(chalk.dim("  │") + chalk.white("  clear            ") + chalk.dim("清屏                        │"));
  console.log(chalk.dim("  │") + chalk.white("  help             ") + chalk.dim("显示帮助                    │"));
  console.log(chalk.dim("  │") + chalk.white("  exit / quit      ") + chalk.dim("退出                        │"));
  console.log(chalk.dim("  └────────────────────────────────────────────────────┘"));
}

async function initAgents() {
  bus = new MessageBus();
  bus.start();

  planner = new PlannerAgent(bus);
  developer = new DeveloperAgent(bus);
  tester = new TesterAgent(bus);
  documenter = new DocumenterAgent(bus);

  for (const a of [planner, developer, tester, documenter]) {
    await a.start();
  }
}

async function runPipeline(requirement: string) {
  if (running) {
    console.log(chalk.yellow("\n  ⚠️ 已有任务在运行，请等待完成\n"));
    return;
  }
  running = true;

  const outputDir = resolve("E:/daima/maca-ts", `maca_output`);
  mkdirSync(outputDir, { recursive: true });
  developer["outputDir"] = outputDir;
  documenter["outputDir"] = resolve(outputDir, "docs");

  const startTime = Date.now();

  // ═══════ Step 1 ═══════
  console.log(chalk.yellow.bold("\n  ─── 📋 Planner 工作中... ───"));
  const tree = await planner.decompose(requirement, true);
  const leaves = flattenAll(tree).filter((t) => t.children.length === 0);
  console.log(chalk.green(`  ✅ 拆解: ${tree.children.length} 模块, ${leaves.length} 任务`));
  for (const mod of tree.children) {
    console.log(chalk.dim(`     📦 ${mod.title}`));
  }

  // ═══════ Step 2 ═══════
  console.log(chalk.yellow.bold("\n  ─── 🔨 Developer 工作中... ───"));
  const maxTasks = Math.min(6, leaves.length);
  const artifacts: Record<string, string> = {};

  for (let i = 0; i < maxTasks; i++) {
    const task = leaves[i]!;
    const result = await developer.develop(
      task.title, task.description,
      (task.context["interfaces"] as Array<Record<string, string>>) ?? [],
      "typescript", true
    );
    const fp = developer.saveCode(result);
    artifacts[task.id] = fp;
    console.log(chalk.green(`  ✅ ${relative(outputDir, fp)}`));
  }

  // ═══════ Step 3 ═══════
  console.log(chalk.yellow.bold("\n  ─── 🧪 Tester 工作中... ───"));
  let totalIssues = 0;

  for (const [, filepath] of Object.entries(artifacts)) {
    const code = readFileSync(filepath, "utf-8");
    const review = await tester.review(code, "typescript", true);
    totalIssues += review.issues.length;
    const icon = review.passed ? "✅" : "⚠️";
    console.log(`  ${icon} ${relative(outputDir, filepath)}: ${review.score}/100`);
    for (const issue of review.issues) {
      console.log(chalk.dim(`     └─ ${issue.title}`));
    }
  }

  // ═══════ Step 4 ═══════
  console.log(chalk.yellow.bold("\n  ─── 📝 Documenter 工作中... ───"));

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

  const readme = await documenter.generateReadme(projectCtx, artifacts, true);
  const rp = documenter.saveDocument(readme);
  console.log(chalk.green(`  ✅ README.md`));

  const retro = await documenter.generateRetrospective(projectCtx, artifacts, [], true);
  documenter.saveDocument(retro);
  console.log(chalk.green(`  ✅ 复盘报告.md`));

  // ═══════ 总结 ═══════
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(chalk.green.bold(`\n  ═══════════════════════════════════════`));
  console.log(chalk.green.bold(`  ✅ 完成! 耗时 ${elapsed}s`));
  console.log(chalk.white(`  📁 输出: ${outputDir}`));
  console.log(chalk.white(`  📊 模块:${tree.children.length} 代码:${Object.keys(artifacts).length} 审查建议:${totalIssues}`));
  console.log(chalk.green.bold(`  ═══════════════════════════════════════\n`));

  running = false;
}

function flattenAll(task: Task): Task[] {
  const r = [task];
  for (const c of task.children) r.push(...flattenAll(c));
  return r;
}

async function handleChat(input: string) {
  try {
    process.stdout.write(chalk.dim("\n  🤔 思考中..."));
    const reply = await planner["llm"].simplePrompt(input, {
      systemPrompt: "你是 MACA，一个多智能体协同开发助手。你内部有 Planner(规划)、Developer(开发)、Tester(测试)、Documenter(文档) 四个 Agent。你基于 DeepSeek 大模型运行。像朋友一样自然聊天，不要总是催用户输入需求。用户问什么就答什么。用户说开发需求时才进入工作模式。",
    });
    process.stdout.write("\r\x1b[K"); // 清除"思考中"
    console.log(chalk.cyan(`\n  ${reply}\n`));
  } catch {
    console.log(chalk.yellow("\n  ⚠️ DeepSeek 暂时没响应，请重新输入\n"));
  }
}

function isDevRequest(input: string): boolean {
  return (
    input.length > 10 &&
    /开发|写|做一个|创建|搭建|实现|构建|帮我|弄一个|搞一个|生成|弄个|做个|写个/i.test(input)
  );
}

// ── 主循环 ────────────────────────────────────
async function main() {
  await initAgents();

  clearScreen();
  printHeader();
  printAgentPanel();
  printCommands();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan("\n  maca> "),
  });

  rl.prompt();

  rl.on("line", async (line: string) => {
    const input = line.trim();
    const cmd = input.split(/\s+/)[0]?.toLowerCase();
    const args = input.slice(cmd?.length ?? 0).trim();

    switch (cmd) {
      case "run": {
        if (!args) {
          console.log(chalk.red("\n  请提供需求描述，例如: run 开发一个文件上传服务\n"));
        } else {
          await runPipeline(args);
        }
        break;
      }

      case "demo": {
        await runPipeline("开发一个用户认证 API 服务，支持邮箱注册、JWT 登录、密码重置");
        break;
      }

      case "plan": {
        if (!args) {
          console.log(chalk.red("\n  请提供需求描述\n"));
        } else {
          console.log(chalk.yellow.bold("\n  ─── 📋 Planner 工作中... ───"));
          const tree = await planner.decompose(args, true);
          console.log(chalk.green(`  ✅ ${tree.children.length} 个模块:`));
          for (const mod of tree.children) {
            console.log(chalk.cyan(`     📦 ${mod.title}`));
            for (const feat of mod.children) {
              console.log(chalk.dim(`        └─ ${feat.title} (${feat.children.length} 步骤)`));
            }
          }
          console.log("");
        }
        break;
      }

      case "status":
        printAgentPanel();
        console.log("");
        break;

      case "clear":
        clearScreen();
        printHeader();
        printAgentPanel();
        printCommands();
        break;

      case "help":
        printCommands();
        console.log("");
        break;

      case "exit":
      case "quit":
        console.log(chalk.yellow("\n  正在关闭 Agent...\n"));
        for (const a of [planner, developer, tester, documenter]) {
          await a.stop();
        }
        bus.shutdown();
        rl.close();
        console.log(chalk.green("  👋 再见!\n"));
        process.exit(0);
        return;

      case "":
        break;

      default:
        if (isDevRequest(input)) {
          await runPipeline(input);
        } else {
          await handleChat(input);
        }
    }

    rl.prompt();
  });

  rl.on("close", () => {
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(chalk.red("启动失败:"), err);
  process.exit(1);
});
