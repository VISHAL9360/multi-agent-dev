/**
 * 配置管理 — 从环境变量和 .env 文件加载配置
 */

import { config as dotenvConfig } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, "../../.env") });

export const config = {
  openaiApiKey: process.env["OPENAI_API_KEY"] ?? "",
  openaiBaseUrl: process.env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1",
  openaiModel: process.env["OPENAI_MODEL"] ?? "gpt-4o",

  logLevel: process.env["MACA_LOG_LEVEL"] ?? "INFO",
  dataDir: process.env["MACA_DATA_DIR"] ?? "./data",

  maxConcurrentAgents: parseInt(process.env["MACA_MAX_CONCURRENT_AGENTS"] ?? "4", 10),

  agentTimeout: 300,
  llmTimeout: 120,
} as const;
