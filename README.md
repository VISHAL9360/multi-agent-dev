<div align="center">

# ⚡ MACA: Autonomous Multi-Agent Collaborative Architecture
### Enterprise Software Engineering Swarm with Zero-Dependency Graph Engine, Asynchronous MessageBus & Self-Healing Code Review Loops

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7%2B-blue.svg?logo=typescript)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg?logo=node.js)](https://nodejs.org/)
[![Architecture](https://img.shields.io/badge/Architecture-Decoupled%20MessageBus-purple.svg)](#system-architecture)
[![Orchestrator](https://img.shields.io/badge/Graph%20Engine-Zero--Dependency%20StateGraph-orange.svg)](#zero-dependency-declarative-graph-engine)
[![Tests](https://img.shields.io/badge/Tests-45%2F45%20Passing%20(100%25)-brightgreen.svg)](#test-verification--benchmarks)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

*An enterprise-grade, autonomous software engineering platform built from first principles. Eliminates black-box framework bloat (no LangChain, no heavy runtime dependencies) through an event-driven asynchronous message bus, a handcrafted 120-line declarative StateGraph engine, automated 6-dimension code quality gates, and crash-resilient atomic checkpointing.*

---

[Executive Overview](#-executive-overview) • [System Architecture](#-system-architecture) • [Core Subsystems](#-core-subsystems--technical-deep-dive) • [StateGraph Engine](#-zero-dependency-declarative-graph-engine) • [Self-Healing Review Loop](#-self-healing-code-review--repair-loop) • [Enterprise Resilience](#-enterprise-operations--resilience) • [Quickstart](#-quickstart--usage) • [Test Verification](#-test-verification--benchmarks)

---

</div>

## 📌 Executive Overview

Monolithic LLM code generation fails in production software engineering: single-prompt completions miss architectural boundaries, hallucinate invalid API contracts, introduce severe security vulnerabilities (SSRF, hardcoded secrets, SQL injection), and leave no audit trail. Furthermore, existing agent frameworks (LangChain, AutoGen, CrewAI) introduce massive dependency bloat, opaque state mutability, and fragile memory abstractions that are impossible to debug at enterprise scale.

**MACA (Multi-Agent Collaborative Architecture)** proves that high-performance agentic engineering can be achieved cleanly from **first principles**:
- **Decoupled Asynchronous Messaging**: Agents communicate exclusively through a zero-dependency, event-driven `MessageBus` supporting point-to-point mailboxes, publish-subscribe broadcasts, and correlated RPC request-response semantics.
- **Strict Role Specialization**: Four autonomous agents operate under distinct system prompts and temperature gradients—**Planner** (WBS task tree decomposition), **Developer** (context-aware code synthesis with hybrid RAG), **Tester** (6-dimension static/semantic code review), and **Documenter** (API specs, architecture guides, and post-mortems).
- **Self-Healing Code Review Loop**: Code is never blindly accepted. The tester reviews code against 15+ vulnerability patterns and AST heuristics, automatically dispatches structured defect reports, and prompts the developer to iteratively remediate issues until a quality threshold (score $\ge 80/100$) is satisfied.
- **Handcrafted Declarative Graph Engine**: Implements the core runtime of LangGraph in 120 lines of pure TypeScript with full support for conditional routing edges, cyclical repair paths, and shared immutable state merging.
- **Enterprise Operations & Resilience**: Native disk-backed atomic checkpointing (`.maca/checkpoints/`), tool execution with security allowlists, hybrid BM25 + vector search RAG, real-time progress streaming, and human-in-the-loop approval gates.

---

## 🏗️ System Architecture

MACA enforces physical decoupling between orchestration, communication, and agent execution:

```mermaid
flowchart TD
    subgraph Ingress["Client & Telemetry Layer"]
        CLI["CLI Runner (`use.ts`)"]
        TUI["Enterprise TUI Console (`tui-pro.ts`)"]
        API["Programmatic SDK Ingress"]
    end

    subgraph CoreEngine["Orchestration & State Management"]
        ORCH["Enterprise Orchestrator\n(Lifecycle Manager & Task Dispatcher)"]
        GRAPH["Mini LangGraph Engine\n(StateGraph with Cyclic Edge Routing)"]
        BUS["Asynchronous MessageBus\n(EventEmitter + Correlation ID RPC + FIFO Queues)"]
        CHECKPOINT[("Atomic Checkpoints\n(.maca/checkpoints/*.json)")]
        RAG[("Hybrid RAG Store\n(BM25 Inverted Index + Embeddings)")]
        
        ORCH <--> BUS
        GRAPH <--> BUS
        ORCH <--> CHECKPOINT
        ORCH <--> RAG
    end

    subgraph AgentSwarm["Autonomous 4-Tier Agent Swarm"]
        PLANNER["📋 PlannerAgent\n(WBS Decomposition & Contract Design)"]
        DEV["🔨 DeveloperAgent\n(Code Synthesis & AST Template Fallback)"]
        TESTER["🧪 TesterAgent\n(6-Dimension Quality Audit & Vulnerability Scanner)"]
        DOC["📝 DocumenterAgent\n(OpenAPI, Architecture README & Retrospectives)"]

        BUS -->|"task_assign"| PLANNER
        BUS -->|"task_assign / review_response"| DEV
        BUS -->|"task_assign (Review)"| TESTER
        BUS -->|"task_assign (Docs)"| DOC

        PLANNER -->|"task_result (WBS Tree)"| BUS
        DEV -->|"task_result (Generated Artifact)"| BUS
        TESTER -->|"task_result (Review Score & Issues)"| BUS
        DOC -->|"task_result (Markdown Bundle)"| BUS
    end

    subgraph Operations["Enterprise Safety & Tools"]
        GATE["🛡️ Human Approval Gate\n(High-Risk Escalation with 30s Timeout)"]
        TOOLS["🔧 Tool Execution Sandbox\n(Filesystem I/O, Command Allowlist)"]
    end

    Ingress --> ORCH
    ORCH --- GATE
    ORCH --- TOOLS
```

---

## 🔄 Sequence: Request-Response & Self-Healing Execution

The sequence diagram below traces how a natural-language requirement transitions through planning, synthesis, automated testing, iterative defect remediation, and final artifact archival:

```mermaid
sequenceDiagram
    autonumber
    actor User as Engineer / Enterprise Client
    participant Orch as Orchestrator / Graph Engine
    participant Bus as MessageBus (Event Hub)
    participant Planner as PlannerAgent
    participant Dev as DeveloperAgent
    participant Tester as TesterAgent
    participant Doc as DocumenterAgent
    participant Disk as Artifact Store (maca_output/)

    User->>Orch: Dispatch Requirement: "Build a User Auth Microservice"
    Orch->>Bus: sendAndWait(task_assign -> Planner)
    Planner->>Planner: Decompose WBS Task Tree & Interface Contracts
    Planner-->>Bus: reply(task_result: Modules, Steps, Contracts)
    Bus-->>Orch: WBS Task Tree Received

    loop For each Task Step in WBS Tree
        Orch->>Bus: sendAndWait(task_assign -> Developer, Task Context)
        Dev->>Dev: Query RAG Context + Synthesize Code
        Dev-->>Bus: reply(task_result: Source Code)
        Bus-->>Orch: Source Code Received

        loop Test-and-Fix Verification Loop (Max 3 Iterations)
            Orch->>Bus: sendAndWait(task_assign -> Tester, Code)
            Tester->>Tester: 6-Dimension Audit (Security, Syntax, Logic, Boundaries)
            Tester-->>Bus: reply(task_result: Score: 65, Issues: [Hardcoded Secret])
            Bus-->>Orch: Review Failed (Score < 80)
            
            Orch->>Bus: sendAndWait(review_response -> Developer, Defect List)
            Dev->>Dev: Autonomous Remediation & Patch Application
            Dev-->>Bus: reply(task_result: Patched Source Code)
            Bus-->>Orch: Patched Code Received
        end
        Orch->>Disk: Persist Validated Code Artifact
    end

    Orch->>Bus: sendAndWait(task_assign -> Documenter, Full Project Context)
    Doc->>Doc: Generate README, API Reference, Architecture Diagrams & Retrospective
    Doc-->>Bus: reply(task_result: Markdown Documents)
    Bus-->>Orch: Documentation Bundle
    Orch->>Disk: Commit Full Project Bundle to maca_output/
    Orch-->>User: Pipeline Complete: Production Bundle Ready
```

---

## 🧩 Core Subsystems & Technical Deep Dive

### 1. Asynchronous Event-Driven MessageBus (`src/message-bus.ts`)
The `MessageBus` decouples all agent interactions, preventing tight method coupling and eliminating race conditions:
- **FIFO Mailboxes**: Every agent role (`planner`, `developer`, `tester`, `documenter`, `orchestrator`) owns a dedicated in-memory queue.
- **Correlated RPC (`sendAndWait`)**: Request messages automatically register an ephemeral correlation promise mapped to `correlationId`. When the recipient invokes `bus.reply()`, the reply matches the pending correlation ID and resolves the original promise with microsecond latency.
- **Configurable Timeouts & Graceful Degradation**: Protects against hung agent processes by terminating unresponsive requests after a configurable deadline (`TASK_TIMEOUT`).
- **Audit Trails**: Retains an in-memory chronological event stream of all dispatched and delivered messages for compliance and retrospective debugging.

```typescript
// RPC Request-Response Pattern on MessageBus
const request = createMessage({
  msgType: "task_assign",
  sender: "orchestrator",
  receiver: "developer",
  content: { task: taskData, language: "typescript", use_llm: true },
});

// Awaits correlated reply with automatic timeout
const reply = await this.bus.sendAndWait(request, this.TASK_TIMEOUT);
```

### 2. Autonomous Four-Tier Agent Swarm

| Agent | Responsibility | Core Methodologies | Temperature |
|---|---|---|:---:|
| **PlannerAgent** | Requirement analysis & architectural decomposition | Parses vague user intents into hierarchical Work Breakdown Structures (WBS). Defines explicit module contracts, endpoints, input/output schemas, and execution order. | `0.3` |
| **DeveloperAgent** | Production-ready code synthesis | Consults hybrid RAG index for existing repo patterns, injects strict interface stubs, and implements full source code. Features automatic fallback to deterministic AST templates when offline. | `0.5` |
| **TesterAgent** | Multi-dimensional quality & security auditing | Performs AST static pattern analysis across 6 dimensions. Assigns weighted numerical scores ($0-100$) and compiles structured remediation tickets. | `0.3` |
| **DocumenterAgent** | Technical writing & retrospective analytics | Synthesizes OpenAPI specifications, markdown user guides, comprehensive module manifests, and post-development lessons-learned reports. | `0.4` |

---

## 🔁 Self-Healing Code Review & Repair Loop

The `TesterAgent` audits code against a rigorous 6-dimension evaluation matrix:

```mermaid
graph LR
    subgraph SixDimensions["6-Dimension Review Matrix"]
        D1["1. Syntax & Types\n(Unreachable code, missing types)"]
        D2["2. Logic & Control Flow\n(Infinite loops, dead branches)"]
        D3["3. Security Vulnerabilities\n(SQLi, Secrets, Eval, XSS)"]
        D4["4. Boundary Conditions\n(Null pointers, empty collections)"]
        D5["5. Performance & Resource\n(Synchronous I/O, N+1 patterns)"]
        D6["6. Best Practices\n(Console logs, magic numbers)"]
    end

    Code["Input Source Code"] --> SixDimensions
    SixDimensions --> ScoreCalc["Weighted Scoring Engine\n(Base 100 - Penalties)"]
    ScoreCalc --> Decision{"Score >= 80 && Errors == 0?"}
    Decision -->|"Yes"| Pass["✅ Approve & Graduate"]
    Decision -->|"No"| Fail["❌ Emit Remediation Payload\n(Severity, Line, Suggestion)"]
```

### Automated Vulnerability Pattern Scanners:
- **Hardcoded Secrets**: Detects exposed API tokens, private keys, passwords, and JWT literals (`/(?:password|secret|api_key|token)\s*[:=]\s*['"][^'"]+['"]/gi`).
- **Dangerous Dynamic Execution**: Identifies arbitrary code execution vectors (`exec()`, `eval()`).
- **SQL Injection**: Scans for unparameterized raw string concatenations across `SELECT`, `INSERT`, `UPDATE`, and `DELETE` queries.
- **Cross-Site Scripting (XSS)**: Flags insecure DOM manipulation (`dangerouslySetInnerHTML`, `innerHTML =`).
- **Insecure Deserialization**: Prevents execution of unsafe object deserializers.

---

## 🌐 Zero-Dependency Declarative Graph Engine

Rather than pulling in heavy external runtime dependencies, MACA incorporates a pure TypeScript **StateGraph Engine** (`src/langgraph.ts`):

```typescript
import { StateGraph } from "./src/langgraph.js";

interface WorkflowState {
  requirement: string;
  plan?: string[];
  code?: string;
  reviewPassed?: boolean;
  retryCount: number;
}

const workflow = new StateGraph<WorkflowState>()
  .addNode("planner", async (state) => ({ plan: await runPlanner(state.requirement) }))
  .addNode("developer", async (state) => ({ code: await runDeveloper(state.plan!) }))
  .addNode("tester", async (state) => ({ 
    reviewPassed: await runTester(state.code!),
    retryCount: state.retryCount + 1 
  }))
  .addEdge("planner", "developer")
  .addEdge("developer", "tester")
  .addConditionalEdges("tester", (state) => {
    if (state.reviewPassed) return "documenter";
    if (state.retryCount >= 3) return "documenter"; // Maximum iterations ceiling
    return "developer"; // Cyclic self-healing loop
  })
  .addNode("documenter", async (state) => ({ docs: await runDocumenter(state) }))
  .setEntryPoint("planner");

const app = workflow.compile();
const finalState = await app({ requirement: "Build OAuth microservice", retryCount: 0 });
```

---

## 🛡️ Enterprise Operations & Resilience

- **Atomic Checkpointing (`src/services/checkpoint.ts`)**: Every completed task state is atomically serialized to `.maca/checkpoints/` as an immutable JSON snapshot. In the event of a system crash, network partition, or VM preemption, the orchestrator detects existing checkpoints and seamlessly resumes execution.
- **Human-in-the-Loop Approval Gate (`src/services/progress.ts`)**: When the static security scanner detects critical severity risks (e.g., shell command execution or SQL injection), the pipeline automatically suspends and triggers an approval event. The operator can approve, reject, or allow an auto-skip fallback after a 30-second grace window.
- **Hybrid RAG Knowledge Retrieval (`src/services/rag.ts`)**: Features an in-memory hybrid search system combining **BM25 term-frequency ranking** with **semantic dense embeddings**, enabling the developer agent to examine existing codebase conventions before writing code.
- **Safety-Hardened Tool Calling (`src/services/tools.ts`)**: Includes an isolated tool runtime permitting file reading/writing and safe command execution with command-line regex allowlists.

---

## 📂 Project Structure

```
multi-agent-dev/
├── src/
│   ├── agents/                   # Autonomous Agent Swarm
│   │   ├── base.ts               # BaseAgent Template Method pattern (Lifecycle & Queues)
│   │   ├── planner.ts            # Requirement decomposition & WBS tree construction
│   │   ├── developer.ts          # Code synthesis, RAG querying, AST template fallback
│   │   ├── tester.ts             # 6-dimension code auditor & vulnerability scanner
│   │   └── documenter.ts         # Technical documentation & retrospective generator
│   │
│   ├── services/                 # Enterprise Infrastructure
│   │   ├── checkpoint.ts         # Disk-backed atomic snapshot persistence
│   │   ├── llm.ts                # OpenAI/DeepSeek API wrapper with exponential retries
│   │   ├── progress.ts           # Streaming telemetry & human-in-the-loop approval gate
│   │   ├── rag.ts                # Hybrid BM25 + dense embedding retrieval engine
│   │   └── tools.ts              # Sandboxed filesystem & command execution tools
│   │
│   ├── models/                   # Formal Domain Schemas (Zod)
│   │   ├── task.ts               # Task, Message, and State schema definitions
│   │   └── index.ts              # Public domain model exports
│   │
│   ├── utils/                    # Configuration & Logging Utilities
│   │   ├── config.ts             # Environment variable loader
│   │   └── logger.ts             # Structured terminal logger
│   │
│   ├── message-bus.ts            # Event-driven asynchronous message bus (EventEmitter + RPC)
│   ├── langgraph.ts              # Pure TypeScript declarative StateGraph engine (~120 lines)
│   ├── orchestrator.ts           # Core deterministic state machine orchestrator
│   ├── enterprise-orchestrator.ts# Resilient orchestrator (Checkpoints + Tools + Approvals)
│   ├── cli.ts                    # Commander.js command-line interface
│   └── index.ts                  # Public library exports
│
├── examples/                     # Operational Examples
│   ├── demo.ts                   # End-to-end multi-agent execution pipeline
│   └── graph_demo.ts             # StateGraph cyclic workflow demonstration
│
├── tests/                        # Vitest Test Suite (100% Passing)
│   ├── message-bus.test.ts       # MessageBus queueing, RPC, and broadcast tests
│   ├── orchestrator.test.ts      # Pipeline dispatch and test-and-fix loop verification
│   └── agents/                   # Agent unit test specifications
│       ├── base.test.ts          # Agent lifecycle and message loop validation
│       ├── planner.test.ts       # WBS decomposition test suite
│       ├── developer.test.ts     # Multi-language code synthesis and filename tests
│       ├── tester.test.ts        # Vulnerability detection and scoring tests
│       └── documenter.test.ts    # Documentation generation tests
│
├── tui-pro.ts                    # Enterprise Terminal User Interface (Progress & Approvals)
├── use.ts                        # Single-command headless runner
├── package.json                  # NPM manifest (ESM, TypeScript, Vitest, Zod)
├── tsconfig.json                 # Strict TypeScript configuration
└── vitest.config.ts              # Test runner configuration
```

---

## 🚀 Quickstart & Usage

### 1. Installation
Ensure Node.js 18+ is installed:
```bash
git clone https://github.com/VISHAL9360/multi-agent-dev.git
cd multi-agent-dev
npm install
```

### 2. Configuration (Optional)
To leverage real foundation models, copy `.env.example` to `.env`:
```env
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=https://api.deepseek.com/v1 # or https://api.openai.com/v1
OPENAI_MODEL=deepseek-chat                 # or gpt-4o
```
*Note: MACA works out-of-the-box in zero-dependency offline mode using built-in AST templates and static analysis rules if no API key is configured.*

### 3. Execution Modes

#### Option A: Enterprise Interactive TUI (Recommended)
```bash
npx tsx tui-pro.ts
```
Launches a rich interactive console displaying live progress indicators, agent message exchanges, RAG index metrics, and interactive approval gates.

#### Option B: Single-Command Headless Pipeline
```bash
npx tsx use.ts "Build a resilient file upload microservice with chunked resume and checksum verification"
```

#### Option C: Declarative StateGraph Demo
```bash
npx tsx examples/graph_demo.ts
```

---

## 🧪 Test Verification & Benchmarks

MACA includes a comprehensive test suite covering message bus concurrency, RPC timeouts, agent lifecycles, static analysis heuristics, and iterative remediation loops.

### Running Test Suite:
```bash
# Run all 45 automated unit and integration tests
npm test

# Run strict TypeScript static typecheck
npm run typecheck

# Compile production distribution
npm run build
```

### Benchmark Results:
```
 ✓ tests/message-bus.test.ts (9 tests)
 ✓ tests/agents/base.test.ts (4 tests)
 ✓ tests/agents/planner.test.ts (5 tests)
 ✓ tests/agents/developer.test.ts (7 tests)
 ✓ tests/agents/tester.test.ts (9 tests)
 ✓ tests/agents/documenter.test.ts (6 tests)
 ✓ tests/orchestrator.test.ts (5 tests)

Test Files  7 passed (7)
     Tests  45 passed (45)
  Duration  2.55s
 Typecheck  0 errors (tsc --noEmit)
```

---

## 👨‍💻 Engineering Leadership & Maintainer

**Vishal K**  
Lead Architect & Systems Engineer  
- **GitHub**: [@VISHAL9360](https://github.com/VISHAL9360)  
- **Email**: [rajivishal2020@gmail.com](mailto:rajivishal2020@gmail.com)  
- **Repository**: [https://github.com/VISHAL9360/multi-agent-dev](https://github.com/VISHAL9360/multi-agent-dev)

---

## 📄 License

This platform is open-source software licensed under the **[MIT License](LICENSE)**.
