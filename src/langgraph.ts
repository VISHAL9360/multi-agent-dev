/**
 * Mini LangGraph — 声明式 Agent 工作流引擎
 *
 * 核心理念：把 Agent 之间的跳转逻辑从代码里抽出来，变成可配置的图
 *
 * 三个概念：
 *   State  — 所有节点共享的数据
 *   Node   — 一个处理步骤，接收 State，返回部分新 State
 *   Edge   — 节点之间的连线（普通边 / 条件边）
 */

// ── 类型定义 ──────────────────────────────────

/** 任意 State 类型（用户自定义） */
type AnyState = Record<string, unknown>;

/** 一个节点：接收完整 State，返回要合并的部分 State */
type NodeFn<S extends AnyState> = (state: S) => Promise<Partial<S>>;

/** 条件判断：根据 State 决定下一步去哪 */
type RouterFn<S extends AnyState> = (state: S) => string;

/** 图的内部结构 */
interface GraphDef<S extends AnyState> {
  nodes: Map<string, NodeFn<S>>;
  edges: Map<string, string>;                    // from → to
  conditionalEdges: Map<string, RouterFn<S>>;    // from → router function
  entryPoint: string;
}

// ── Graph Builder ─────────────────────────────

class StateGraph<S extends AnyState> {
  private def: GraphDef<S> = {
    nodes: new Map(),
    edges: new Map(),
    conditionalEdges: new Map(),
    entryPoint: "",
  };

  /** 注册一个节点 */
  addNode(name: string, fn: NodeFn<S>): this {
    this.def.nodes.set(name, fn);
    if (!this.def.entryPoint) this.def.entryPoint = name;
    return this;
  }

  /** 普通边：A 执行完 → 直接去 B */
  addEdge(from: string, to: string): this {
    this.def.edges.set(from, to);
    return this;
  }

  /** 条件边：A 执行完 → 根据 router 函数的结果决定去 B、C 还是 D */
  addConditionalEdges(from: string, router: RouterFn<S>): this {
    this.def.conditionalEdges.set(from, router);
    return this;
  }

  /** 设置入口节点 */
  setEntryPoint(name: string): this {
    this.def.entryPoint = name;
    return this;
  }

  /** 编译成可执行的函数 */
  compile(): (initialState: S) => Promise<S> {
    const { nodes, edges, conditionalEdges, entryPoint } = this.def;

    return async (initialState: S): Promise<S> => {
      let state = { ...initialState };
      let currentNode = entryPoint;
      const visited = new Set<string>();
      const maxSteps = 50;

      for (let step = 0; step < maxSteps; step++) {
        if (!currentNode) break;

        // 防死循环
        if (visited.has(currentNode)) {
          console.warn(`[Graph] 检测到循环回到 ${currentNode}，继续执行`);
        }
        visited.add(currentNode);

        const nodeFn = nodes.get(currentNode);
        if (!nodeFn) throw new Error(`节点 "${currentNode}" 未注册`);

        // 执行节点，合并返回的 State
        console.log(`[Graph] 执行节点: ${currentNode}`);
        const partial = await nodeFn(state);
        state = { ...state, ...partial };

        // 决定下一个节点
        const condRouter = conditionalEdges.get(currentNode);
        if (condRouter) {
          // 条件边：根据 router 返回值决定
          currentNode = condRouter(state);
        } else {
          // 普通边
          currentNode = edges.get(currentNode) ?? "";
        }
      }

      return state;
    };
  }
}

// ── 导出 ──────────────────────────────────────

export { StateGraph };
export type { AnyState, NodeFn, RouterFn };
