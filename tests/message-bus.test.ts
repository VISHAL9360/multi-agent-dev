/**
 * MessageBus 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MessageBus } from "../src/message-bus.js";
import { createMessage, AgentRole, MessageType, Message } from "../src/models/task.js";

describe("MessageBus", () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
    bus.start();
  });

  afterEach(() => {
    bus.shutdown();
  });

  it("should register agents", () => {
    bus.register("planner");
    expect(bus.registeredAgents).toContain("planner");
  });

  it("should unregister agents", () => {
    bus.register("planner");
    bus.unregister("planner");
    expect(bus.registeredAgents).not.toContain("planner");
  });

  it("should send and receive messages", async () => {
    bus.register("planner");
    bus.register("developer");

    const msg = createMessage({
      msgType: "task_assign",
      sender: "planner",
      receiver: "developer",
      content: { task: "test" },
    });
    bus.send(msg);

    const received = await bus.receive("developer", 100);
    expect(received).not.toBeNull();
    expect(received!.sender).toBe("planner");
    expect(received!.content["task"]).toBe("test");
  });

  it("should broadcast to all except sender", async () => {
    bus.register("planner");
    bus.register("developer");
    bus.register("tester");

    const msg = createMessage({
      msgType: "broadcast",
      sender: "planner",
      receiver: "orchestrator",
      content: { announcement: "hello" },
    });
    bus.broadcast(msg, true);

    // Planner (sender) should NOT receive
    const r1 = await bus.receive("planner", 50);
    expect(r1).toBeNull();

    // Developer should receive
    const r2 = await bus.receive("developer", 50);
    expect(r2).not.toBeNull();

    // Tester should receive
    const r3 = await bus.receive("tester", 50);
    expect(r3).not.toBeNull();
  });

  it("should reply to messages", async () => {
    bus.register("planner");
    bus.register("developer");

    const original = createMessage({
      msgType: "task_assign",
      sender: "planner",
      receiver: "developer",
      correlationId: "corr-001",
      content: { task: "build" },
    });
    bus.send(original);

    const received = await bus.receive("developer", 100);
    expect(received).not.toBeNull();

    bus.reply(received!, "task_result", { result: "done" });

    const reply = await bus.receive("planner", 100);
    expect(reply).not.toBeNull();
    expect(reply!.replyTo).toBe(received!.id);
    expect(reply!.correlationId).toBe("corr-001");
  });

  it("should support sendAndWait pattern", async () => {
    bus.register("planner");
    bus.register("developer");

    // Simulate developer that replies
    setTimeout(async () => {
      const msg = await bus.receive("developer", 200);
      if (msg) {
        bus.reply(msg, "task_result", { code: "..." });
      }
    }, 10);

    const request = createMessage({
      msgType: "task_assign",
      sender: "planner",
      receiver: "developer",
      content: { task: "write code" },
    });

    const reply = await bus.sendAndWait(request, 2000);
    expect(reply).not.toBeNull();
    expect(reply!.msgType).toBe("task_result");
  });

  it("should return null on sendAndWait timeout", async () => {
    bus.register("planner");
    // Developer NOT registered — no one will reply

    const request = createMessage({
      msgType: "task_assign",
      sender: "planner",
      receiver: "developer",
      content: {},
    });

    const reply = await bus.sendAndWait(request, 200);
    expect(reply).toBeNull();
  });

  it("should track message history", () => {
    bus.register("planner");
    bus.register("developer");

    const msg = createMessage({
      msgType: "task_assign",
      sender: "planner",
      receiver: "developer",
      taskId: "task-001",
    });
    bus.send(msg);

    const history = bus.getHistory({ taskId: "task-001" });
    expect(history).toHaveLength(1);
    expect(history[0]!.taskId).toBe("task-001");
  });

  it("should count messages", () => {
    bus.send(createMessage({ msgType: "task_assign", sender: "planner", receiver: "developer" }));
    bus.send(createMessage({ msgType: "task_result", sender: "developer", receiver: "planner" }));
    expect(bus.messageCount).toBe(2);
  });
});
