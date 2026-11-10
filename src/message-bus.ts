/**
 * 消息总线 — Agent 之间的异步通信中枢
 *
 * 基于 EventEmitter + Promise 实现：
 * - Agent 注册 / 注销
 * - 点对点消息发送（每个 Agent 独立的队列）
 * - 广播消息
 * - 请求-响应模式（sendAndWait）
 * - 消息审计日志
 */

import { EventEmitter } from "events";
import {
  AgentRole,
  Message,
  MessageType,
  createMessage,
} from "./models/task.js";
import { logger } from "./utils/logger.js";

export class MessageBus extends EventEmitter {
  /** 每个 Agent 角色的消息队列 */
  private queues = new Map<AgentRole, Message[]>();

  /** 消息历史 */
  private history: Message[] = [];

  /** 等待回复的 Promise resolver 映射 */
  private pendingReplies = new Map<string, (msg: Message) => void>();

  private running = false;

  // ── Agent 管理 ──────────────────────────────────

  register(role: AgentRole): void {
    if (!this.queues.has(role)) {
      this.queues.set(role, []);
    }
    logger.info(`[MessageBus] Agent 注册: ${role}`);
  }

  unregister(role: AgentRole): void {
    this.queues.delete(role);
    logger.info(`[MessageBus] Agent 注销: ${role}`);
  }

  get registeredAgents(): AgentRole[] {
    return [...this.queues.keys()];
  }

  // ── 发送 ───────────────────────────────────────

  send(message: Message): void {
    this.history.push(message);

    // 先 resolve pending reply — 即使接收者未注册也要 resolve
    this.resolvePendingReply(message);

    const queue = this.queues.get(message.receiver);
    if (!queue) {
      logger.warn(`[MessageBus] 接收者 ${message.receiver} 未注册，消息丢弃: ${message.id}`);
      return;
    }

    queue.push(message);
    this.emit("message", message);
    logger.debug(`[${message.sender}] → [${message.receiver}] ${message.msgType} (${message.id})`);
  }

  broadcast(message: Message, excludeSender = true): void {
    this.history.push(message);

    let sent = 0;
    for (const [role, queue] of this.queues) {
      if (excludeSender && role === message.sender) continue;
      queue.push(message);
      this.emit("message", message);
      sent++;
    }
    logger.debug(`[${message.sender}] → ALL(${sent}) broadcast (${message.id})`);
  }

  reply(original: Message, msgType: MessageType, content: Record<string, unknown>): Message {
    const replyMsg = createMessage({
      msgType,
      sender: original.receiver,
      receiver: original.sender,
      taskId: original.taskId,
      content,
      replyTo: original.id,
      correlationId: original.correlationId,
    });
    this.send(replyMsg);
    return replyMsg;
  }

  // ── 接收 ───────────────────────────────────────

  async receive(role: AgentRole, timeoutMs = 500): Promise<Message | null> {
    const queue = this.queues.get(role);
    if (!queue) return null;

    if (queue.length > 0) {
      return queue.shift()!;
    }

    // 等待新消息
    return new Promise<Message | null>((resolve) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve(null);
      }, timeoutMs);

      const onMessage = (msg: Message) => {
        if (msg.receiver === role) {
          cleanup();
          resolve(msg);
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.off("message", onMessage);
      };

      this.on("message", onMessage);
    });
  }

  async receiveAll(role: AgentRole, timeoutMs = 500): Promise<Message[]> {
    const messages: Message[] = [];
    while (true) {
      const msg = await this.receive(role, timeoutMs);
      if (!msg) break;
      messages.push(msg);
    }
    return messages;
  }

  // ── 请求-响应 ──────────────────────────────────

  async sendAndWait(message: Message, timeoutMs = 60_000): Promise<Message | null> {
    if (!message.correlationId) {
      message.correlationId = message.id;
    }

    const corrId = message.correlationId;

    return new Promise<Message | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingReplies.delete(corrId);
        logger.warn(`[MessageBus] 等待回复超时: correlation_id=${corrId}`);
        resolve(null);
      }, timeoutMs);

      this.pendingReplies.set(corrId, (msg: Message) => {
        clearTimeout(timer);
        resolve(msg);
      });

      this.send(message);
    });
  }

  private resolvePendingReply(message: Message): boolean {
    // 只有回复消息才触发 resolve
    if (!message.replyTo) return false;
    const corrId = message.correlationId;
    if (!corrId) return false;

    const resolver = this.pendingReplies.get(corrId);
    if (resolver) {
      this.pendingReplies.delete(corrId);
      resolver(message);
      return true;
    }
    return false;
  }

  // ── 查询 ───────────────────────────────────────

  getHistory(filter?: {
    sender?: AgentRole;
    receiver?: AgentRole;
    msgType?: MessageType;
    taskId?: string;
  }, limit = 100): Message[] {
    let results = this.history;
    if (filter?.sender) results = results.filter((m) => m.sender === filter.sender);
    if (filter?.receiver) results = results.filter((m) => m.receiver === filter.receiver);
    if (filter?.msgType) results = results.filter((m) => m.msgType === filter.msgType);
    if (filter?.taskId) results = results.filter((m) => m.taskId === filter.taskId);
    return results.slice(-limit);
  }

  getConversation(correlationId: string): Message[] {
    return this.history.filter((m) => m.correlationId === correlationId);
  }

  // ── 生命周期 ──────────────────────────────────

  start(): void {
    this.running = true;
    logger.info("[MessageBus] 消息总线已启动");
  }

  shutdown(): void {
    this.running = false;
    this.queues.clear();
    this.pendingReplies.clear();
    logger.info("[MessageBus] 消息总线已关闭");
  }

  get messageCount(): number {
    return this.history.length;
  }
}

/** 全局单例 */
export const messageBus = new MessageBus();
