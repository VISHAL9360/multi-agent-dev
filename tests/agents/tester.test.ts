/**
 * TesterAgent 单元测试
 */

import { describe, it, expect } from "vitest";
import { TesterAgent } from "../../src/agents/tester.js";
import { MessageBus } from "../../src/message-bus.js";
import { createMessage, AgentRole, MessageType } from "../../src/models/task.js";

describe("TesterAgent", () => {
  function makeAgent(): TesterAgent {
    return new TesterAgent(new MessageBus());
  }

  describe("static analysis", () => {
    it("should detect hardcoded secrets", async () => {
      const agent = makeAgent();
      const code = 'const API_KEY = "sk-abc123";\nconst password = "admin123";';
      const result = await agent.review(code, "typescript", false);

      const secrets = result.issues.filter((i) => i.title.includes("硬编码") || i.title.includes("密钥"));
      expect(secrets.length).toBeGreaterThanOrEqual(1);
    });

    it("should detect eval/exec usage", async () => {
      const agent = makeAgent();
      const code = 'function run(input: string) { eval(input); }';
      const result = await agent.review(code, "typescript", false);

      const evalIssues = result.issues.filter((i) =>
        i.title.toLowerCase().includes("eval") || i.title.toLowerCase().includes("exec")
      );
      expect(evalIssues.length).toBeGreaterThanOrEqual(1);
    });

    it("should detect any type usage", async () => {
      const agent = makeAgent();
      const code = "function process(data: any): any { return data; }";
      const result = await agent.review(code, "typescript", false);

      const anyIssues = result.issues.filter((i) => i.title.includes("any"));
      expect(anyIssues.length).toBeGreaterThanOrEqual(1);
    });

    it("should detect TODO markers", async () => {
      const agent = makeAgent();
      const code = "// TODO: implement this\nfunction foo() {}";
      const result = await agent.review(code, "typescript", false);

      const todos = result.issues.filter((i) => i.title.includes("TODO"));
      expect(todos.length).toBeGreaterThanOrEqual(1);
    });

    it("should detect console.log usage", async () => {
      const agent = makeAgent();
      const code = 'console.log("debug message");';
      const result = await agent.review(code, "typescript", false);

      const prints = result.issues.filter((i) => i.title.includes("console.log"));
      expect(prints.length).toBeGreaterThanOrEqual(1);
    });

    it("should give clean code a high score", async () => {
      const agent = makeAgent();
      const code = `
/**
 * A clean module with proper logging.
 */
import { logger } from "./logger";

export function calculateSum(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  return numbers.reduce((a, b) => a + b, 0);
}
`;
      const result = await agent.review(code, "typescript", false);
      expect(result.score).toBeGreaterThanOrEqual(90);
      expect(result.passed).toBe(true);
    });
  });

  describe("scoring", () => {
    it("should calculate score correctly", () => {
      const agent = makeAgent();
      const issues = [
        { severity: "error" as const, category: "security", title: "e1", line: 1, description: "", suggestion: "" },
        { severity: "warning" as const, category: "practice", title: "w1", line: 2, description: "", suggestion: "" },
        { severity: "info" as const, category: "practice", title: "i1", line: 3, description: "", suggestion: "" },
      ];
      const score = (agent as any).calculateScore(issues);
      // 100 - 15 - 5 - 1 = 79
      expect(score).toBe(79);
    });
  });

  describe("formatting", () => {
    it("should format review report", async () => {
      const agent = makeAgent();
      const result = await agent.review('const x: any = 1;', "typescript", false);
      const report = agent.formatReport(result);

      expect(report).toContain("代码审查报告");
      expect(report).toContain(`${result.score}/100`);
    });
  });

  describe("message handling", () => {
    it("should handle review via message bus", async () => {
      const bus = new MessageBus();
      bus.start();
      bus.register("orchestrator");

      const agent = new TesterAgent(bus);
      await agent.start();

      const msg = createMessage({
        msgType: "task_assign",
        sender: "orchestrator",
        receiver: "tester",
        content: {
          code: 'const API_KEY = "secret-123";\nconsole.log("hello");\n',
          language: "typescript",
          use_llm: false,
        },
      });
      bus.send(msg);

      const reply = await bus.receive("orchestrator", 1000);
      expect(reply).not.toBeNull();
      expect(reply!.msgType).toBe("task_result");
      const result = reply!.content["result"] as Record<string, unknown>;
      expect(result["score"]).toBeDefined();
      expect((result["score"] as number)).toBeLessThan(100);

      await agent.stop();
      bus.shutdown();
    });
  });
});
