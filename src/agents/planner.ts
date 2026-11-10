/**
 * PlannerAgent — 需求分析与任务拆解
 */

import { BaseAgent } from "./base.js";
import { MessageBus } from "../message-bus.js";
import { LLMService, llmService } from "../services/llm.js";
import {
  AgentRole,
  Message,
  MessageType,
  Task,
  TaskPriority,
  createTask,
} from "../models/task.js";

const PLANNER_SYSTEM_PROMPT = `你是一个资深的软件架构师和项目经理。将用户的自然语言需求拆解为结构化的开发任务树。

## 输出格式
返回 JSON：
{
  "project_name": "项目名称",
  "summary": "一句话概述",
  "modules": [
    {
      "title": "模块名称",
      "description": "模块描述",
      "priority": "high|medium|low",
      "features": [
        {
          "title": "功能点",
          "description": "功能描述",
          "interfaces": [
            {"method": "GET|POST|PUT|DELETE|FUNC", "path": "/api/xxx 或 函数名", "description": "接口描述", "input": "输入", "output": "输出"}
          ],
          "steps": ["具体实现步骤1", "具体实现步骤2"]
        }
      ]
    }
  ],
  "dependencies": [{"task": "模块A.功能B", "depends_on": "模块X.功能Y", "reason": "原因"}]
}

## 拆解原则
1. 模块粒度适中 2. 功能点明确可独立交付 3. 接口清晰 4. 步骤可执行 5. 依赖合理
请直接返回 JSON，不要包含任何其他文字。`;

export class PlannerAgent extends BaseAgent {
  readonly role: AgentRole = "planner";
  private llm: LLMService;

  constructor(bus?: MessageBus, llm?: LLMService) {
    super(bus);
    this.llm = llm ?? llmService;
  }

  async processMessage(message: Message): Promise<void> {
    if (message.msgType === "task_assign") {
      await this.handlePlanRequest(message);
    } else if (message.msgType === "task_query") {
      await this.handleQuery(message);
    } else {
      await this.sendError(message, `未知消息类型: ${message.msgType}`);
    }
  }

  private async handlePlanRequest(message: Message): Promise<void> {
    const requirement = message.content["requirement"] as string;
    const useLLM = (message.content["use_llm"] as boolean) ?? true;

    if (!requirement) {
      await this.sendError(message, "缺少需求描述 (requirement)");
      return;
    }

    this.log.info(`开始分析需求: ${requirement.slice(0, 80)}...`);

    try {
      const taskTree = await this.decompose(requirement, useLLM);
      await this.sendTaskResult(message, {
        taskTree,
        summary: taskTree.description,
        totalTasks: flattenCount(taskTree),
        modules: taskTree.children.map((c) => c.title),
      });
      this.log.info(
        `需求拆解完成: ${taskTree.children.length} 个模块, ${flattenCount(taskTree)} 个任务节点`
      );
    } catch (err) {
      this.log.error(`需求拆解失败: ${String(err)}`);
      await this.sendError(message, String(err));
    }
  }

  private async handleQuery(message: Message): Promise<void> {
    const taskId = message.content["task_id"] as string;
    await this.sendTaskResult(message, { queryAck: taskId });
  }

  // ── 核心拆解逻辑 ──────────────────────────────

  async decompose(requirement: string, useLLM = true): Promise<Task> {
    if (useLLM && this.llm.totalCalls >= 0) {
      try {
        return await this.llmDecompose(requirement);
      } catch (err) {
        this.log.warn(`LLM 拆解失败，回退到规则拆解: ${String(err)}`);
      }
    }
    return this.ruleDecompose(requirement);
  }

  private async llmDecompose(requirement: string): Promise<Task> {
    const response = await this.llm.chatWithJSON(
      [{ role: "user", content: requirement }],
      { systemPrompt: PLANNER_SYSTEM_PROMPT, temperature: 0.3, maxTokens: 4096 }
    );

    let jsonStr = response.trim();
    jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, "");
    jsonStr = jsonStr.replace(/\s*```$/i, "");
    const data = JSON.parse(jsonStr) as Record<string, unknown>;
    return this.buildTaskTree(data, requirement);
  }

  ruleDecompose(requirement: string): Task {
    const lower = requirement.toLowerCase();
    const hasAuth = /登录|认证|权限|用户|auth/.test(lower);
    const hasStorage = /存储|文件|上传|下载|数据库/.test(lower);

    const modules: Array<Record<string, unknown>> = [
      {
        title: "核心功能模块",
        description: "实现核心业务逻辑",
        priority: "high",
        features: [
          {
            title: "主功能实现",
            description: requirement.trim(),
            interfaces: [
              { method: "FUNC", path: "main", description: "核心入口", input: "", output: "" },
            ],
            steps: [
              "定义数据模型和类型",
              "实现核心业务逻辑",
              "添加输入验证和错误处理",
              "编写单元测试",
            ],
          },
        ],
      },
    ];

    if (hasAuth) {
      modules.push({
        title: "用户认证模块",
        description: "用户注册、登录、权限管理",
        priority: "high",
        features: [
          {
            title: "用户管理",
            description: "注册、登录、Token 管理",
            interfaces: [
              { method: "POST", path: "/api/auth/register", description: "用户注册" },
              { method: "POST", path: "/api/auth/login", description: "用户登录" },
            ],
            steps: ["定义用户数据模型", "实现密码哈希与验证", "实现 JWT Token 生成与验证", "添加认证中间件"],
          },
        ],
      });
    }

    if (hasStorage) {
      modules.push({
        title: "数据存储模块",
        description: "数据持久化和文件管理",
        priority: "medium",
        features: [
          {
            title: "数据层",
            description: "数据库连接和 ORM 配置",
            interfaces: [
              { method: "FUNC", path: "connectDB", description: "数据库连接" },
              { method: "FUNC", path: "migrate", description: "数据库迁移" },
            ],
            steps: ["配置数据库连接", "定义 ORM 模型", "创建迁移脚本", "实现 CRUD 操作"],
          },
        ],
      });
    }

    modules.push({
      title: "配置与工具模块",
      description: "项目配置、日志、错误处理",
      priority: "low",
      features: [
        {
          title: "基础设施",
          description: "配置管理、日志、异常处理",
          interfaces: [],
          steps: ["实现配置加载（环境变量/.env）", "配置日志系统", "实现全局异常处理", "添加健康检查端点"],
        },
      ],
    });

    const data = {
      project_name: this.extractProjectName(requirement),
      summary: requirement.trim(),
      modules,
      dependencies: [] as Array<Record<string, unknown>>,
    };
    return this.buildTaskTree(data, requirement);
  }

  // ── 任务树构建 ────────────────────────────────

  private buildTaskTree(data: Record<string, unknown>, requirement: string): Task {
    const root = createTask({
      title: (data["project_name"] as string) ?? "未命名项目",
      description: (data["summary"] as string) ?? requirement,
      role: "orchestrator" as AgentRole,
      priority: "critical" as TaskPriority,
    });

    const modules = (data["modules"] as Array<Record<string, unknown>>) ?? [];
    for (const modData of modules) {
      const modPriority = (modData["priority"] as TaskPriority) ?? "medium";
      const moduleTask = createTask({
        title: modData["title"] as string,
        description: (modData["description"] as string) ?? "",
        role: "developer",
        priority: modPriority,
        parentId: root.id,
      });

      const features = (modData["features"] as Array<Record<string, unknown>>) ?? [];
      for (const featData of features) {
        const featureTask = createTask({
          title: featData["title"] as string,
          description: (featData["description"] as string) ?? "",
          role: "developer",
          priority: modPriority,
          parentId: moduleTask.id,
          context: {
            interfaces: (featData["interfaces"] as Array<unknown>) ?? [],
            module: modData["title"] as string,
          },
        });

        const steps = (featData["steps"] as string[]) ?? [];
        for (let i = 0; i < steps.length; i++) {
          const stepTask = createTask({
            title: `Step ${i + 1}: ${(steps[i] ?? "").slice(0, 60)}`,
            description: steps[i] ?? "",
            role: "developer",
            priority: modPriority,
            parentId: featureTask.id,
          });
          featureTask.children.push(stepTask);
        }
        moduleTask.children.push(featureTask);
      }
      root.children.push(moduleTask);
    }

    return root;
  }

  extractProjectName(requirement: string): string {
    const m1 = requirement.match(/一个?['「](.+?)['」]/);
    if (m1) return m1[1]!.trim();
    const m2 = requirement.match(/一个(.+?)(?:系统|平台|工具|应用|项目|服务|模块)/);
    if (m2) return m2[1]!.trim();
    return requirement.slice(0, 30).trim();
  }

  getExecutableTasks(tree: Task): Task[] {
    return flattenAll(tree).filter(
      (t) => t.children.length === 0 && t.status === "pending"
    );
  }
}

function flattenCount(task: Task): number {
  let count = 1;
  for (const child of task.children) count += flattenCount(child);
  return count;
}

function flattenAll(task: Task): Task[] {
  const result: Task[] = [task];
  for (const child of task.children) result.push(...flattenAll(child));
  return result;
}
