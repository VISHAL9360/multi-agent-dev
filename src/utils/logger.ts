/**
 * 日志工具 — 带颜色的结构化日志
 */

import chalk from "chalk";

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

let currentLevel: LogLevel = "INFO";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
}

function timestamp(): string {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

export const logger = {
  debug(msg: string): void {
    if (!shouldLog("DEBUG")) return;
    console.log(`${chalk.dim(`[${timestamp()}]`)} ${chalk.gray("DEBUG")}  ${msg}`);
  },

  info(msg: string): void {
    if (!shouldLog("INFO")) return;
    console.log(`${chalk.dim(`[${timestamp()}]`)} ${chalk.blue("INFO")}   ${msg}`);
  },

  warn(msg: string): void {
    if (!shouldLog("WARN")) return;
    console.log(`${chalk.dim(`[${timestamp()}]`)} ${chalk.yellow("WARN")}   ${msg}`);
  },

  error(msg: string): void {
    if (!shouldLog("ERROR")) return;
    console.log(`${chalk.dim(`[${timestamp()}]`)} ${chalk.red("ERROR")}  ${msg}`);
  },

  success(msg: string): void {
    console.log(`${chalk.dim(`[${timestamp()}]`)} ${chalk.green("OK")}     ${msg}`);
  },

  phase(msg: string): void {
    console.log(`\n${chalk.cyan.bold("━".repeat(60))}`);
    console.log(`${chalk.cyan.bold(msg)}`);
    console.log(`${chalk.cyan.bold("━".repeat(60))}\n`);
  },
};

export function getAgentLogger(agentName: string) {
  return {
    debug: (msg: string) => logger.debug(`[${agentName}] ${msg}`),
    info: (msg: string) => logger.info(`[${chalk.cyan(agentName)}] ${msg}`),
    warn: (msg: string) => logger.warn(`[${agentName}] ${msg}`),
    error: (msg: string) => logger.error(`[${agentName}] ${msg}`),
  };
}
