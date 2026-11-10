# MACA: User Guide & Operational Manual

## 1. Prerequisites
- **Node.js**: v18.0.0 or higher (v20+ / v22+ recommended)
- **Package Manager**: npm v9+

## 2. Installation & Quick Launch
```bash
# Clone the repository
git clone https://github.com/VISHAL9360/multi-agent-dev.git
cd multi-agent-dev

# Install dependencies
npm install

# Run the Enterprise TUI Console
npx tsx tui-pro.ts
```

## 3. Execution Options

### Option A: Enterprise Interactive TUI
```bash
npx tsx tui-pro.ts
```
Features real-time agent state visualization, streaming progress bars, approval gate triggers, and RAG status telemetry.

### Option B: Single-Command Headless Pipeline
```bash
npx tsx use.ts "Build a resilient file upload microservice with chunked resume and checksum verification"
```

### Option C: Declarative Graph Orchestration Demo
```bash
npx tsx examples/graph_demo.ts
```

### Option D: End-to-End Test Suite
```bash
npm test
```

## 4. LLM Provider Configuration (Optional)
Copy `.env.example` to `.env` and set your preferred model credentials:
```env
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=https://api.deepseek.com/v1 # or https://api.openai.com/v1
OPENAI_MODEL=deepseek-chat                 # or gpt-4o
```
*Note: The platform features zero-dependency offline mode and will gracefully fallback to deterministic AST & rule-based code synthesis if no API key is supplied.*

## 5. Artifact Directory
All generated code, OpenAPI contracts, and test reports are persisted atomically in `maca_output/`.
