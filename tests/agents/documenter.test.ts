/**
 * DocumenterAgent 单元测试
 */

import { describe, it, expect, afterEach } from "vitest";
import { DocumenterAgent } from "../../src/agents/documenter.js";
import { MessageBus } from "../../src/message-bus.js";
import { createMessage, AgentRole, MessageType } from "../../src/models/task.js";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const sampleProject = {
  name: "UserService",
  description: "用户管理微服务",
  modules: [
    {
      title: "认证模块",
      description: "用户登录注册",
      features: [
        {
          title: "登录",
          description: "用户登录",
          interfaces: [
            {
              method: "POST",
              path: "/api/auth/login",
              description: "用户登录",
              input: '{"username": "str"}',
              output: '{"token": "str"}',
            },
          ],
          steps: ["验证用户凭证", "生成 JWT Token"],
        },
      ],
    },
  ],
};

describe("DocumenterAgent", () => {
  let tmpDir: string;

  function makeAgent(): DocumenterAgent {
    tmpDir = mkdtempSync(join(tmpdir(), "maca_doc_"));
    return new DocumenterAgent(new MessageBus(), undefined, tmpDir);
  }

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should generate README", async () => {
    const agent = makeAgent();
    const doc = await agent.generateReadme(sampleProject, {}, false);

    expect(doc.type).toBe("readme");
    expect(doc.content).toContain("UserService");
    expect(doc.content).toContain("## 📋 项目概述");
    expect(doc.content).toContain("## 🚀 快速开始");
  });

  it("should generate API doc", async () => {
    const agent = makeAgent();
    const interfaces = [
      { method: "GET", path: "/api/users", description: "获取用户列表" },
      { method: "POST", path: "/api/users", description: "创建用户" },
    ];
    const doc = await agent.generateApiDoc(interfaces, {}, false);

    expect(doc.type).toBe("api");
    expect(doc.content).toContain("GET");
    expect(doc.content).toContain("POST");
  });

  it("should generate module doc", async () => {
    const agent = makeAgent();
    const doc = await agent.generateModuleDoc(
      "AuthModule",
      "认证与授权模块",
      { "auth.ts": "export function login() {}" },
      false
    );

    expect(doc.type).toBe("module");
    expect(doc.content).toContain("AuthModule");
  });

  it("should generate retrospective", async () => {
    const agent = makeAgent();
    const doc = await agent.generateRetrospective(
      sampleProject,
      { "auth.ts": "..." },
      [{ severity: "error", title: "硬编码密钥" }],
      false
    );

    expect(doc.type).toBe("retrospective");
    expect(doc.content).toContain("UserService");
    expect(doc.content).toContain("硬编码密钥");
  });

  it("should save document to file", () => {
    const agent = makeAgent();
    const doc = { title: "测试文档", type: "readme", content: "# Hello\n\nWorld" };

    const filepath = agent.saveDocument(doc);
    const content = readFileSync(filepath, "utf-8");
    expect(content).toContain("# Hello");
  });

  it("should handle message-based doc task", async () => {
    const bus = new MessageBus();
    bus.start();
    bus.register("orchestrator");

    const agent = new DocumenterAgent(bus, undefined, tmpDir ?? "./output/docs");
    await agent.start();

    const msg = createMessage({
      msgType: "task_assign",
      sender: "orchestrator",
      receiver: "documenter",
      content: {
        doc_type: "readme",
        project_context: sampleProject,
        artifacts: {},
        use_llm: false,
      },
    });
    bus.send(msg);

    const reply = await bus.receive("orchestrator", 1000);
    expect(reply).not.toBeNull();
    expect(reply!.msgType).toBe("task_result");
    const result = reply!.content["result"] as Record<string, unknown>;
    expect(result["content"]).toBeDefined();

    await agent.stop();
    bus.shutdown();
  });
});
