/**
 * Agent 基类 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BaseAgent } from "../../src/agents/base.js";
import { MessageBus } from "../../src/message-bus.js";
import { AgentRole, Message, MessageType, createMessage } from "../../src/models/task.js";

class MockAgent extends BaseAgent {
  readonly role: AgentRole = "developer";
  received: Message[] = [];
  startCalled = false;
  stopCalled = false;

  protected async onStart(): Promise<void> {
    this.startCalled = true;
  }

  protected async onStop(): Promise<void> {
    this.stopCalled = true;
  }

  async processMessage(message: Message): Promise<void> {
    this.received.push(message);
    if (message.msgType === "task_assign") {
      await this.sendTaskResult(message, { echo: message.content });
    }
  }
}

class FailingAgent extends BaseAgent {
  readonly role: AgentRole = "tester";

  async processMessage(_message: Message): Promise<void> {
    throw new Error("模拟处理异常");
  }
}

describe("BaseAgent", () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
    bus.start();
  });

  afterEach(() => {
    bus.shutdown();
  });

  it("should start and stop", async () => {
    const agent = new MockAgent(bus);
    await agent.start();
    expect(agent.isRunning).toBe(true);
    expect(agent["startCalled"]).toBe(true);

    await agent.stop();
    expect(agent.isRunning).toBe(false);
    expect(agent["stopCalled"]).toBe(true);
  });

  it("should receive and process messages", async () => {
    const agent = new MockAgent(bus);
    await agent.start();

    const msg = createMessage({
      msgType: "task_assign",
      sender: "planner",
      receiver: "developer",
      content: { action: "test" },
    });
    bus.send(msg);

    // Wait for processing
    await sleep(200);

    expect(agent.received.length).toBeGreaterThanOrEqual(1);
    expect(agent.received[0]!.content["action"]).toBe("test");

    await agent.stop();
  });

  it("should send reply after processing", async () => {
    bus.register("planner");

    const agent = new MockAgent(bus);
    await agent.start();

    const msg = createMessage({
      msgType: "task_assign",
      sender: "planner",
      receiver: "developer",
      content: { action: "code" },
    });
    bus.send(msg);

    const reply = await bus.receive("planner", 500);
    expect(reply).not.toBeNull();
    expect(reply!.msgType).toBe("task_result");

    await agent.stop();
  });

  it("should handle errors gracefully", async () => {
    bus.register("planner");

    const agent = new FailingAgent(bus);
    await agent.start();

    const msg = createMessage({
      msgType: "task_assign",
      sender: "planner",
      receiver: "tester",
      content: {},
    });
    bus.send(msg);

    const reply = await bus.receive("planner", 500);
    expect(reply).not.toBeNull();
    expect(reply!.msgType).toBe("error");
    expect(agent.isRunning).toBe(true); // Still running

    await agent.stop();
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
