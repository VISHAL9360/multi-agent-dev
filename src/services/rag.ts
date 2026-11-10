/**
 * RAG 检索增强模块
 *
 * 核心功能：Agent 做决策前，先从知识库检索相关上下文，注入到 Prompt 里
 *
 * 两种检索模式：
 *   1. 关键词检索（BM25 风格，零依赖）
 *   2. 向量检索（需 OpenAI/DeepSeek embedding API）
 *
 * 知识源：
 *   - 项目已有代码文件
 *   - 技术文档
 *   - 历史任务记录
 */

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, mkdirSync } from "fs";
import { resolve, relative, extname } from "path";
import { config } from "../utils/config.js";

// ── 文档块 ────────────────────────────────────

export interface Document {
  id: string;
  content: string;
  metadata: {
    source: string;       // 来源文件路径
    type: string;         // code / doc / log
    language?: string;
    timestamp: number;
  };
  embedding?: number[];
}

// ── 索引 ──────────────────────────────────────

export class RAGIndex {
  private documents: Document[] = [];
  private keywordIndex = new Map<string, Set<number>>();  // 词 → 文档索引集合
  private indexPath: string;

  constructor(indexPath = ".maca/rag_index.json") {
    this.indexPath = indexPath;
    this.load();
  }

  // ── 文档管理 ────────────────────────────────

  /** 添加文档 */
  add(doc: Document): void {
    const idx = this.documents.length;
    this.documents.push(doc);
    this.indexDocument(idx, doc.content);
  }

  /** 从目录批量索引 */
  indexDirectory(dirPath: string, extensions = [".ts", ".tsx", ".js", ".py", ".md"]): number {
    if (!existsSync(dirPath)) return 0;
    let count = 0;

    const walk = (path: string) => {
      const entries = readdirSync(path, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = resolve(path, entry.name);
        if (entry.isDirectory()) {
          if (!["node_modules", ".git", "dist", ".maca"].includes(entry.name)) {
            walk(fullPath);
          }
        } else if (extensions.includes(extname(entry.name))) {
          try {
            const content = readFileSync(fullPath, "utf-8");
            if (content.length > 0 && content.length < 100_000) {
              this.add({
                id: `doc-${count}`,
                content,
                metadata: {
                  source: relative(process.cwd(), fullPath),
                  type: extname(entry.name) === ".md" ? "doc" : "code",
                  language: extname(entry.name).slice(1),
                  timestamp: statSync(fullPath).mtimeMs,
                },
              });
              count++;
            }
          } catch { /* skip unreadable files */ }
        }
      }
    };

    walk(dirPath);
    this.save();
    return count;
  }

  // ── 检索 ────────────────────────────────────

  /** 关键词检索（BM25 简化版） */
  search(query: string, topK = 5): Document[] {
    const queryTerms = this.tokenize(query);
    if (queryTerms.length === 0) return [];

    const scores: Array<{ idx: number; score: number }> = [];

    for (let i = 0; i < this.documents.length; i++) {
      const doc = this.documents[i]!;
      const docTerms = this.tokenize(doc.content);

      // 计算 TF-IDF 简化分数
      let score = 0;
      const docTermSet = new Set(docTerms);

      for (const term of queryTerms) {
        if (docTermSet.has(term)) {
          const tf = docTerms.filter((t) => t === term).length / Math.max(docTerms.length, 1);
          const df = this.keywordIndex.get(term)?.size ?? 1;
          const idf = Math.log((this.documents.length + 1) / (df + 1));
          score += tf * idf;
        }
      }

      // 标题匹配加分
      if (doc.metadata.source.toLowerCase().includes(query.toLowerCase())) {
        score += 2;
      }

      if (score > 0) scores.push({ idx: i, score });
    }

    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((s) => this.documents[s.idx]!);
  }

  /** 获取检索结果的上下文文本（可直接注入 Prompt） */
  getContext(query: string, topK = 3, maxChars = 3000): string {
    const docs = this.search(query, topK);
    if (docs.length === 0) return "";

    const parts = ["## 项目已有相关代码（从知识库检索）\n"];
    for (const doc of docs) {
      const preview = doc.content.slice(0, maxChars / topK);
      parts.push(`### ${doc.metadata.source} (${doc.metadata.type})`);
      parts.push("```" + (doc.metadata.language ?? "") + "\n" + preview + "\n```\n");
    }
    return parts.join("\n");
  }

  // ── 向量检索（需 API） ──────────────────────

  /** 使用 DeepSeek Embedding 做语义检索 */
  async semanticSearch(query: string, topK = 5): Promise<Document[]> {
    if (!config.openaiApiKey) return this.search(query, topK); // 降级到关键词

    try {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({
        apiKey: config.openaiApiKey,
        baseURL: config.openaiBaseUrl,
      });

      // 获取 query embedding
      const qResp = await client.embeddings.create({
        model: "text-embedding-3-small",
        input: query,
      });
      const queryVec = qResp.data[0]?.embedding;
      if (!queryVec) throw new Error("Embedding failed");

      // 计算余弦相似度
      const scores = this.documents.map((doc, idx) => {
        if (!doc.embedding) return { idx, score: 0 };
        return { idx, score: cosineSimilarity(queryVec, doc.embedding) };
      });

      return scores
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .map((s) => this.documents[s.idx]!);
    } catch {
      return this.search(query, topK);
    }
  }

  // ── 持久化 ──────────────────────────────────

  private save(): void {
    try {
      mkdirSync(".maca", { recursive: true });
      writeFileSync(this.indexPath, JSON.stringify({
        documents: this.documents.map((d) => ({
          ...d,
          embedding: undefined, // embedding 太大，不持久化
        })),
      }, null, 2), "utf-8");
    } catch { /* ignore */ }
  }

  private load(): void {
    try {
      if (existsSync(this.indexPath)) {
        const data = JSON.parse(readFileSync(this.indexPath, "utf-8"));
        this.documents = (data.documents ?? []).map((d: Document) => {
          if (d.content?.length > 0) {
            this.indexDocument(this.documents.length, d.content);
          }
          return d;
        });
      }
    } catch { /* ignore */ }
  }

  // ── 分词 ────────────────────────────────────

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2);
  }

  private indexDocument(idx: number, content: string): void {
    const terms = this.tokenize(content);
    for (const term of terms) {
      if (!this.keywordIndex.has(term)) {
        this.keywordIndex.set(term, new Set());
      }
      this.keywordIndex.get(term)!.add(idx);
    }
  }
}

// ── 余弦相似度 ────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! ** 2;
    normB += b[i]! ** 2;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
}

// ── 全局单例 ──────────────────────────────────

export const ragIndex = new RAGIndex();
