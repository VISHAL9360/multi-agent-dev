#!/usr/bin/env tsx
/**
 * 企业级 TUI — 集成检查点、流式进度、工具调用、人工审核
 *
 * 用法: npx tsx tui-pro.ts
 */

import * as readline from "readline";
import chalk from "chalk";
import { MessageBus } from "./src/message-bus.js";
import { PlannerAgent } from "./src/agents/planner.js";
import { DeveloperAgent } from "./src/agents/developer.js";
import { TesterAgent } from "./src/agents/tester.js";
import { DocumenterAgent } from "./src/agents/documenter.js";
import { EnterpriseOrchestrator } from "./src/enterprise-orchestrator.js";
import { ProgressEmitter, ApprovalGate } from "./src/services/progress.js";
import { ragIndex } from "./src/services/rag.js";

// ── 全局 ──────────────────────────────────────
let bus: MessageBus;
let orch: EnterpriseOrchestrator;
let approval: ApprovalGate;
let progressBar = "";
let running = false;

function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[H");
}

function printHeader() {
  console.log("");
  console.log(chalk.cyan.bold("  ╔══════════════════════════════════════════════════╗"));
  console.log(chalk.cyan.bold("  ║") + chalk.white.bold("   MACA Enterprise — 企业级多智能体协同系统       ") + chalk.cyan.bold("║"));
  console.log(chalk.cyan.bold("  ║") + chalk.dim("   检查点 · 工具调用 · 流式进度 · 审核门禁          ") + chalk.cyan.bold("║"));
  console.log(chalk.cyan.bold("  ╚══════════════════════════════════════════════════╝"));
  console.log("");
}

function drawProgressBar() {
  if (!progressBar) return;
  process.stdout.write(`\r${progressBar}`);
  process.stdout.write("\n");
}

async function initSystem() {
  bus = new MessageBus();
  bus.start();

  const planner = new PlannerAgent(bus);
  const developer = new DeveloperAgent(bus);
  const tester = new TesterAgent(bus);
  const documenter = new DocumenterAgent(bus);

  for (const a of [planner, developer, tester, documenter]) await a.start();

  orch = new EnterpriseOrchestrator(bus);
  approval = orch.approval;

  // 流式进度监听
  ProgressEmitter.getInstance().onProgress((event) => {
    const barWidth = 30;
    const filled = Math.floor(event.percent / 100 * barWidth);
    const empty = barWidth - filled;
    progressBar = chalk.dim(`  [${chalk.green("█".repeat(filled))}${"░".repeat(empty)}] ${event.percent}%  ${event.message}`);
  });

  // 审核请求监听
  setInterval(() => {
    const pending = approval.getPending();
    if (pending.length > 0 && !running) {
      console.log(chalk.yellow(`\n  ⚠️ 有 ${pending.length} 个审核请求待处理`));
    }
  }, 2000);
}

async function handleChat(input: string) {
  try {
    process.stdout.write(chalk.dim("\n  🤔 "));
    const reply = await new PlannerAgent(bus)["llm"].simplePrompt(input, {
      systemPrompt: "你是 MACA 企业级多智能体协同开发系统。你基于 DeepSeek 运行，内部有 Planner(规划)、Developer(开发+工具调用)、Tester(审查)、Documenter(文档) 四个 Agent。支持检查点恢复、流式进度、人工审核门禁。像朋友一样自然聊天。",
    });
    process.stdout.write("\r\x1b[K");
    console.log(chalk.cyan(`\n  ${reply}\n`));
  } catch {
    console.log(chalk.yellow("\n  ⚠️ DeepSeek 没响应\n"));
  }
}

function isDevRequest(input: string): boolean {
  return input.length > 8 && /开发|写|做一个|创建|搭建|实现|构建|帮我/i.test(input);
}

async function runWithProgress(requirement: string) {
  if (running) { console.log(chalk.yellow("\n  ⚠️ 已有任务在运行\n")); return; }
  running = true;

  console.log(chalk.yellow.bold(`\n  🚀 启动企业级流水线: ${requirement}`));
  console.log(chalk.dim("  ────────────────────────────────────────"));

  // 流式打印进度
  const printInterval = setInterval(() => {
    if (progressBar) {
      process.stdout.write(`\r\x1b[K${progressBar}`);
    }
  }, 100);

  const result = await orch.runPipeline(requirement);

  clearInterval(printInterval);
  progressBar = "";
  running = false;

  // 结果
  if (result["status"] === "completed") {
    const stats = result["stats"] as Record<string, unknown>;
    console.log(chalk.green.bold(`\n\n  ═══════════════════════════════════════`));
    console.log(chalk.green.bold(`  ✅ 流水线完成!`));
    console.log(chalk.white(`  📁 输出: ${result["outputDir"]}`));
    console.log(chalk.white(`  📊 任务: ${stats["completedTasks"]}/${stats["totalTasks"]} 通过`));
    console.log(chalk.white(`  ⏱ 耗时: ${stats["elapsedSeconds"]}s`));
    console.log(chalk.green.bold(`  ═══════════════════════════════════════\n`));
  } else {
    console.log(chalk.red(`\n\n  ❌ 流水线失败: ${result["reason"]}\n`));
  }
}

// ── 审核交互 ──────────────────────────────────

async function handleApprovals() {
  const pending = approval.getPending();
  if (pending.length === 0) return;

  console.log(chalk.yellow.bold("\n  ─── 待审核事项 ───"));
  for (const req of pending) {
    console.log(chalk.red(`\n  🔴 [${req.severity.toUpperCase()}] ${req.title}`));
    console.log(chalk.dim(`     ${req.description}`));

    const answer = await askLine(`  批准通过? (y=通过 / n=驳回 / s=跳过): `);
    approval.decide(req.id, answer === "y" ? "approve" : answer === "n" ? "reject" : "skip");
    console.log(chalk.green(`  ✅ 已处理: ${req.title}`));
  }
}

function askLine(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(chalk.cyan(prompt), (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

// ── 主循环 ────────────────────────────────────

async function main() {
  await initSystem();

  clearScreen();
  printHeader();

  // RAG 索引
  const ragDocs = ragIndex["documents"]?.length ?? 0;
  if (ragDocs === 0) {
    console.log(chalk.dim("\n  🔍 正在索引项目文件..."));
    ragIndex.indexDirectory(".");
  }
  const docCount = ragIndex["documents"]?.length ?? 0;

  console.log(chalk.dim("  ┌─ 企业级特性 ────────────────────────────────────┐"));
  console.log(chalk.dim("  │") + chalk.white("  💾 检查点     ") + chalk.dim("每任务完成后自动保存，断点续跑          │"));
  console.log(chalk.dim("  │") + chalk.white("  🔧 工具调用   ") + chalk.dim("Agent 可读写文件、执行命令              │"));
  console.log(chalk.dim("  │") + chalk.white("  🔍 RAG 检索   ") + chalk.dim(`知识库: ${docCount} 个文件索引               │`));
  console.log(chalk.dim("  │") + chalk.white("  📡 流式进度   ") + chalk.dim("实时进度条，不再干等                    │"));
  console.log(chalk.dim("  │") + chalk.white("  🛡️  审核门禁  ") + chalk.dim("安全风险自动挂起等人工审批              │"));
  console.log(chalk.dim("  └──────────────────────────────────────────────────┘"));

  console.log(chalk.dim("\n  ┌─ 命令 ──────────────────────────────────────────┐"));
  console.log(chalk.dim("  │") + chalk.white("  输入需求  → 启动全流程      │"));
  console.log(chalk.dim("  │") + chalk.white("  approve   → 处理待审核事项  │"));
  console.log(chalk.dim("  │") + chalk.white("  status    → 查看运行状态    │"));
  console.log(chalk.dim("  │") + chalk.white("  help      → 帮助            │"));
  console.log(chalk.dim("  │") + chalk.white("  exit      → 退出            │"));
  console.log(chalk.dim("  └──────────────────────────────────────────────────┘"));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan("\n  maca> "),
  });

  rl.prompt();

  rl.on("line", async (line: string) => {
    const input = line.trim();
    const cmd = input.split(/\s+/)[0]?.toLowerCase() ?? "";

    switch (cmd) {
      case "approve":
        await handleApprovals();
        break;

      case "status":
        console.log(chalk.dim(`\n  阶段: ${orch["phase"]}`));
        if (orch["completedTaskIds"]) {
          console.log(chalk.dim(`  已完成: ${orch["completedTaskIds"].length} 任务`));
        }
        console.log("");
        break;

      case "help":
        console.log(chalk.dim("\n  直接输入需求即可。"));
        console.log(chalk.dim("  企业级特性: 检查点自动保存 / 工具调用 / 审核门禁\n"));
        break;

      case "exit":
      case "quit":
        console.log(chalk.yellow("\n  正在关闭...\n"));
        bus.shutdown();
        rl.close();
        console.log(chalk.green("  👋 再见!\n"));
        process.exit(0);
        return;

      case "":
        break;

      default:
        if (isDevRequest(input)) {
          await runWithProgress(input);
        } else {
          await handleChat(input);
        }
    }

    rl.prompt();
  });
}

main().catch((err) => {
  console.error(chalk.red("启动失败:"), err);
  process.exit(1);
});
