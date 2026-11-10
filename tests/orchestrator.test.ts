/**
 * Orchestrator 单元 + 集成测试
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { MessageBus } from "../src/message-bus.js";
import { DeveloperAgent } from "../src/agents/developer.js";
import { TesterAgent } from "../src/agents/tester.js";
import { DocumenterAgent } from "../src/agents/documenter.js";
import { createTask, flattenTasks, isLeafTask } from "../src/models/task.js";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Orchestrator", () => {
  let bus: MessageBus;
  let tmpDir: string;

  beforeEach(() => {
    process.env["MACA_TEST_MODE"] = "1";
    bus = new MessageBus();
    bus.start();
    tmpDir = mkdtempSync(join(tmpdir(), "maca_orch_"));
  });

  afterEach(() => {
    bus.shutdown();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should initialize with idle phase", () => {
    const orch = new Orchestrator(bus);
    expect(orch.isRunning).toBe(false);
  });

  it("should dispatch develop to DeveloperAgent", async () => {
    const developer = new DeveloperAgent(bus, undefined, tmpDir);
    await developer.start();

    const orch = new Orchestrator(bus, tmpDir);

    const task = createTask({
      title: "测试任务",
      description: "编写测试函数",
      context: {
        interfaces: [{ method: "FUNC", path: "testFunc", description: "测试函数" }],
        language: "typescript",
      },
    });

    const result = await orch.dispatchDevelop(task);
    expect(result).not.toBeNull();
    expect(result!["code"]).toBeDefined();

    await developer.stop();
  });

  it("should dispatch test to TesterAgent", async () => {
    const tester = new TesterAgent(bus);
    await tester.start();

    const orch = new Orchestrator(bus, tmpDir);

    const code = 'export function add(a: number, b: number): number { return a + b; }';
    const result = await orch.dispatchTest(code);
    expect(result).not.toBeNull();
    expect(result!["score"]).toBeDefined();
    expect(result!["score"] as number).toBeGreaterThanOrEqual(0);

    await tester.stop();
  });

  it("should run test-and-fix loop", async () => {
    const developer = new DeveloperAgent(bus, undefined, tmpDir);
    const tester = new TesterAgent(bus);
    await developer.start();
    await tester.start();

    const orch = new Orchestrator(bus, tmpDir);

    const code = 'const SECRET = "hardcoded123";\nconsole.log("hello");';
    const task = createTask({ title: "测试", description: "测试" });

    // Should fail because of hardcoded secret
    const passed = await orch.testAndFixLoop(task, code);
    expect(passed).toBe(false);

    await developer.stop();
    await tester.stop();
  });

  it("should generate documentation", async () => {
    const documenter = new DocumenterAgent(bus, undefined, join(tmpDir, "docs"));
    await documenter.start();

    const orch = new Orchestrator(bus, tmpDir);

    const root = createTask({ title: "TestProject", description: "测试项目" });
    const mod = createTask({
      title: "核心模块",
      description: "核心功能",
      context: { interfaces: [{ method: "GET", path: "/api/test", description: "测试" }] },
    });
    const step = createTask({ title: "Step 1", description: "实现步骤" });
    mod.children.push(step);
    root.children.push(mod);

    const docs = await orch.phaseDocument(root);
    expect(docs).toBeDefined();

    await documenter.stop();
  });
});
