/**
 * DeveloperAgent 单元测试
 */

import { describe, it, expect, afterEach } from "vitest";
import { DeveloperAgent } from "../../src/agents/developer.js";
import { MessageBus } from "../../src/message-bus.js";
import { createMessage, AgentRole, MessageType } from "../../src/models/task.js";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("DeveloperAgent", () => {
  let tmpDir: string;

  function makeAgent(): DeveloperAgent {
    tmpDir = mkdtempSync(join(tmpdir(), "maca_test_"));
    return new DeveloperAgent(new MessageBus(), undefined, tmpDir);
  }

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should generate TypeScript template code", () => {
    const agent = makeAgent();
    const result = agent.templateDevelop(
      "用户注册功能",
      "实现用户注册接口",
      [{ method: "POST", path: "/api/auth/register", description: "用户注册" }],
      "typescript"
    );

    expect(result.filename).toMatch(/\.ts$/);
    expect(result.language).toBe("typescript");
    expect(result.code).toContain("export function");
    expect(result.code).toContain("register");
  });

  it("should generate Python template code", () => {
    const agent = makeAgent();
    const result = agent.templateDevelop(
      "Data Fetcher",
      "Fetch data",
      [{ method: "FUNC", path: "fetchData", description: "获取数据" }],
      "python"
    );

    expect(result.filename).toMatch(/\.py$/);
    expect(result.code).toContain("def fetchData");
  });

  it("should generate class when no interfaces", () => {
    const agent = makeAgent();
    const result = agent.templateDevelop(
      "Core Engine",
      "核心引擎模块",
      [],
      "typescript"
    );

    expect(result.code).toContain("export class");
    expect(result.code).toContain("CoreEngine");
  });

  it("should save code to file", () => {
    const agent = makeAgent();
    const result = {
      filename: "test_module.ts",
      code: "export function hello(): string { return 'world'; }\n",
      language: "typescript",
      description: "test",
      dependencies: [],
    };

    const filepath = agent.saveCode(result);
    const content = readFileSync(filepath, "utf-8");
    expect(content).toContain("export function hello");
  });

  it("should convert title to filename", () => {
    const agent = makeAgent();
    expect(agent.titleToFilename("Hello World", "typescript")).toBe("hello_world.ts");
    expect(agent.titleToFilename("用户 管理", "python")).toBe("用户_管理.py");
  });

  it("should convert title to class name", () => {
    const agent = makeAgent();
    expect(agent.titleToClass("user manager")).toBe("UserManager");
    expect(agent.titleToClass("")).toBe("MainModule");
  });

  it("should handle message-based dev task", async () => {
    const bus = new MessageBus();
    bus.start();
    bus.register("orchestrator");

    const agent = new DeveloperAgent(bus, undefined, tmpDir ?? "./output");
    await agent.start();

    const msg = createMessage({
      msgType: "task_assign",
      sender: "orchestrator",
      receiver: "developer",
      content: {
        task: {
          title: "健康检查接口",
          description: "实现 /health 端点",
          context: {
            interfaces: [{ method: "GET", path: "/api/health", description: "健康检查" }],
          },
        },
        language: "typescript",
        use_llm: false,
      },
    });
    bus.send(msg);

    const reply = await bus.receive("orchestrator", 1000);
    expect(reply).not.toBeNull();
    expect(reply!.msgType).toBe("task_result");
    const result = reply!.content["result"] as Record<string, unknown>;
    expect(result["code"]).toBeDefined();

    await agent.stop();
    bus.shutdown();
  });
});
