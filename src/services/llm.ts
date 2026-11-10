/**
 * LLM 服务 — OpenAI 兼容接口封装
 */

import OpenAI from "openai";
import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";

export interface LLMStats {
  totalCalls: number;
  totalTokens: number;
  totalTimeMs: number;
  avgTimeMs: number;
}

export class LLMService {
  private client: OpenAI;
  readonly model: string;

  totalCalls = 0;
  totalTokens = 0;
  totalTimeMs = 0;

  constructor(apiKey?: string, baseUrl?: string, model?: string) {
    this.model = model ?? config.openaiModel;
    this.client = new OpenAI({
      apiKey: apiKey ?? config.openaiApiKey,
      baseURL: baseUrl ?? config.openaiBaseUrl,
      timeout: config.llmTimeout * 1000,
      maxRetries: 0, // we handle retries ourselves
    });
  }

  // ── 核心调用 ──────────────────────────────────

  async chat(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    opts?: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      systemPrompt?: string;
      maxRetries?: number;
    }
  ): Promise<string> {
    const {
      model,
      temperature = 0.7,
      maxTokens = 4096,
      systemPrompt,
      maxRetries = 3,
    } = opts ?? {};

    // Fail fast if no API key configured
    if (!this.client.apiKey) {
      throw new Error("No API key configured — skipping LLM call");
    }

    const fullMessages = systemPrompt
      ? [{ role: "system" as const, content: systemPrompt }, ...messages]
      : messages;

    let lastError: unknown;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const start = performance.now();
        const response = await this.client.chat.completions.create({
          model: model ?? this.model,
          messages: fullMessages,
          temperature,
          max_tokens: maxTokens,
        });

        const elapsed = performance.now() - start;
        this.totalCalls++;
        this.totalTokens += response.usage?.total_tokens ?? 0;
        this.totalTimeMs += elapsed;

        logger.debug(
          `LLM 调用完成: model=${model ?? this.model}, ` +
            `tokens=${response.usage?.total_tokens ?? "?"}, ` +
            `time=${elapsed.toFixed(0)}ms`
        );

        return response.choices[0]?.message?.content ?? "";
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries - 1) {
          const wait = 2 ** attempt;
          logger.warn(
            `LLM 调用失败 (attempt ${attempt + 1}/${maxRetries}): ${String(err)}. 等待 ${wait}s 后重试...`
          );
          await sleep(wait * 1000);
        }
      }
    }

    throw new Error(`LLM 调用失败（已重试 ${maxRetries} 次）: ${String(lastError)}`);
  }

  async chatWithJSON(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    opts?: {
      model?: string;
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
    }
  ): Promise<string> {
    const jsonInstruction =
      "You MUST respond with valid JSON only. " +
      "No markdown fences, no explanations, just the JSON object.";

    const systemPrompt = opts?.systemPrompt
      ? `${opts.systemPrompt}\n\n${jsonInstruction}`
      : jsonInstruction;

    return this.chat(messages, {
      ...opts,
      systemPrompt,
      temperature: opts?.temperature ?? 0.3,
    });
  }

  async simplePrompt(
    prompt: string,
    opts?: { systemPrompt?: string; model?: string; temperature?: number }
  ): Promise<string> {
    return this.chat([{ role: "user", content: prompt }], opts);
  }

  // ── 统计 ──────────────────────────────────────

  get stats(): LLMStats {
    return {
      totalCalls: this.totalCalls,
      totalTokens: this.totalTokens,
      totalTimeMs: this.totalTimeMs,
      avgTimeMs: this.totalCalls > 0 ? this.totalTimeMs / this.totalCalls : 0,
    };
  }

  resetStats(): void {
    this.totalCalls = 0;
    this.totalTokens = 0;
    this.totalTimeMs = 0;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const llmService = new LLMService();
