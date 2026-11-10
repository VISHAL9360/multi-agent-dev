/**
 * Agent 基类 — 所有 Agent 的抽象基类
 */

import { MessageBus, messageBus } from "../message-bus.js";
import {
  AgentRole,
  Message,
  MessageType,
  createMessage,
} from "../models/task.js";
import { getAgentLogger } from "../utils/logger.js";

export abstract class BaseAgent {
  abstract readonly role: AgentRole;

  protected bus: MessageBus;
  protected log: ReturnType<typeof getAgentLogger>;
  private running = false;
  private loopPromise: Promise<void> | null = null;
  private abortController: AbortController | null = null;

  constructor(bus?: MessageBus) {
    this.bus = bus ?? messageBus;
    this.log = getAgentLogger("agent");
  }

  // ── 生命周期 ──────────────────────────────────

  async start(): Promise<void> {
    this.bus.register(this.role);
    this.running = true;
    this.abortController = new AbortController();
    this.log.info("Agent 启动");
    await this.onStart();
    this.loopPromise = this.messageLoop();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abortController?.abort();
    try {
      await this.loopPromise;
    } catch {
      // ignore cancellation
    }
    await this.onStop();
    this.bus.unregister(this.role);
    this.log.info("Agent 已停止");
  }

  protected async onStart(): Promise<void> {}
  protected async onStop(): Promise<void> {}

  // ── 消息循环 ──────────────────────────────────

  private async messageLoop(): Promise<void> {
    while (this.running) {
      try {
        const message = await this.bus.receive(this.role, 500);
        if (message) {
          await this.handleMessage(message);
        }
      } catch (err) {
        if (!this.running) break;
        this.log.error(`消息循环异常: ${String(err)}`);
      }
    }
  }

  private async handleMessage(message: Message): Promise<void> {
    try {
      this.log.debug(`收到消息 [${message.msgType}] 来自 [${message.sender}]`);
      await this.processMessage(message);
    } catch (err) {
      this.log.error(`处理消息失败: ${message.id} — ${String(err)}`);
      this.bus.reply(message, "error", {
        error: `消息处理异常: ${String(err)}`,
        messageId: message.id,
      });
    }
  }

  // ── 抽象接口 ──────────────────────────────────

  abstract processMessage(message: Message): Promise<void>;

  // ── 便捷方法 ──────────────────────────────────

  async sendTaskResult(
    original: Message,
    result: Record<string, unknown>,
    status = "completed"
  ): Promise<void> {
    this.bus.reply(original, "task_result", { status, result });
  }

  async sendError(original: Message, error: string): Promise<void> {
    this.bus.reply(original, "error", { error });
  }

  async requestReview(
    taskId: string,
    content: Record<string, unknown>,
    reviewer: AgentRole = "tester"
  ): Promise<Message | null> {
    const msg = createMessage({
      msgType: "review_request",
      sender: this.role,
      receiver: reviewer,
      taskId,
      content,
    });
    return this.bus.sendAndWait(msg);
  }

  get isRunning(): boolean {
    return this.running;
  }
}
