/**
 * 流式进度推送 + 人工审核门禁
 */

import { EventEmitter } from "events";

// ── 进度事件 ──────────────────────────────────

export interface ProgressEvent {
  phase: string;
  message: string;
  percent: number;
  timestamp: number;
}

export class ProgressEmitter extends EventEmitter {
  private static instance: ProgressEmitter;
  static getInstance(): ProgressEmitter {
    if (!this.instance) this.instance = new ProgressEmitter();
    return this.instance;
  }

  emitProgress(phase: string, message: string, percent: number): void {
    this.emit("progress", {
      phase, message, percent,
      timestamp: Date.now(),
    } as ProgressEvent);
  }

  onProgress(handler: (event: ProgressEvent) => void): void {
    this.on("progress", handler);
  }
}

// ── 审核门禁 ──────────────────────────────────

export type ApprovalDecision = "approve" | "reject" | "skip";

export interface ApprovalRequest {
  id: string;
  title: string;
  description: string;
  severity: "critical" | "warning" | "info";
  context: Record<string, unknown>;
}

export class ApprovalGate {
  private pending: Map<string, {
    request: ApprovalRequest;
    resolve: (decision: ApprovalDecision) => void;
  }> = new Map();

  /** 提交审批请求，返回 Promise 等待人工决策 */
  async requestApproval(request: ApprovalRequest, timeoutMs = 120_000): Promise<ApprovalDecision> {
    return new Promise<ApprovalDecision>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id);
        resolve("skip"); // 超时自动跳过
      }, timeoutMs);

      this.pending.set(request.id, {
        request,
        resolve: (decision) => {
          clearTimeout(timer);
          resolve(decision);
        },
      });
      // 可以通过 WebSocket/SSE 通知前端
    });
  }

  /** 人工做出决策 */
  decide(requestId: string, decision: ApprovalDecision): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    this.pending.delete(requestId);
    entry.resolve(decision);
    return true;
  }

  /** 获取所有待审批项 */
  getPending(): ApprovalRequest[] {
    return [...this.pending.values()].map((v) => v.request);
  }
}

// ── 安全检查器 ────────────────────────────────

export function shouldRequestApproval(issues: Array<{ severity: string; category: string }>): ApprovalRequest[] {
  return issues
    .filter((i) => i.severity === "error" && ["security", "logic"].includes(i.category))
    .map((i, idx) => ({
      id: `approval-${Date.now()}-${idx}`,
      title: i.severity === "error" ? `安全风险: ${i.category}` : `警告: ${i.category}`,
      description: `${i.category} 级别问题需要人工确认`,
      severity: (i.severity === "error" ? "critical" : "warning") as ApprovalRequest["severity"],
      context: { issue: i },
    }));
}
