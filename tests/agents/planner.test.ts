/**
 * PlannerAgent 单元测试
 */

import { describe, it, expect } from "vitest";
import { PlannerAgent } from "../../src/agents/planner.js";
import { MessageBus } from "../../src/message-bus.js";
import { createMessage, AgentRole, MessageType } from "../../src/models/task.js";

describe("PlannerAgent", () => {
  it("should decompose an API requirement using rules", () => {
    const agent = new PlannerAgent(new MessageBus());
    const tree = agent.ruleDecompose("开发一个用户管理 REST API 服务，支持登录和数据库存储");

    expect(tree.title).toBeTruthy();
    expect(tree.children.length).toBeGreaterThanOrEqual(3); // core + auth + storage + config

    const all = flatten(tree);
    expect(all.length).toBeGreaterThan(3);
  });

  it("should decompose a CLI requirement", () => {
    const agent = new PlannerAgent(new MessageBus());
    const tree = agent.ruleDecompose("做一个命令行文件批量重命名工具");

    expect(tree.children.length).toBeGreaterThanOrEqual(1);
  });

  it("should extract project name from requirement", () => {
    const agent = new PlannerAgent(new MessageBus());
    expect(agent.extractProjectName("开发一个「用户管理系统」")).toBe("用户管理系统");
    expect(agent.extractProjectName("创建一个文件上传服务")).toBe("文件上传");
  });

  it("should get executable tasks (leaf + pending)", () => {
    const agent = new PlannerAgent(new MessageBus());
    const tree = agent.ruleDecompose("开发一个简单的计算器");

    const tasks = agent.getExecutableTasks(tree);
    expect(tasks.length).toBeGreaterThan(0);
    for (const t of tasks) {
      expect(t.children.length).toBe(0); // all leaves
      expect(t.status).toBe("pending");
    }
  });

  it("should handle message-based plan requests", async () => {
    const bus = new MessageBus();
    bus.start();
    bus.register("orchestrator");

    const agent = new PlannerAgent(bus);
    await agent.start();

    const msg = createMessage({
      msgType: "task_assign",
      sender: "orchestrator",
      receiver: "planner",
      content: { requirement: "开发一个文件上传服务", use_llm: false },
    });
    bus.send(msg);

    const reply = await bus.receive("orchestrator", 1000);
    expect(reply).not.toBeNull();
    expect(reply!.msgType).toBe("task_result");
    const result = reply!.content["result"] as Record<string, unknown>;
    expect(result["taskTree"]).toBeDefined();

    await agent.stop();
    bus.shutdown();
  });
});

function flatten(t: ReturnType<PlannerAgent["ruleDecompose"]>): unknown[] {
  const r: unknown[] = [t];
  for (const c of t.children) r.push(...flatten(c));
  return r;
}
