/**
 * Retrieval Engine
 * 提供 memory_retrieve 和 memory_search 工具
 */

import { promises as fs } from 'fs';
import path from 'path';
import { MemoryNode } from './offload.js';

export interface RetrievalConfig {
  storage_path: string;
  max_results: number;
  enable_fulltext: boolean;
}

const DEFAULT_RETRIEVAL_CONFIG: RetrievalConfig = {
  storage_path: './memory',
  max_results: 10,
  enable_fulltext: false
};

export class RetrievalEngine {
  private config: RetrievalConfig;

  constructor(config: Partial<RetrievalConfig> = {}) {
    this.config = { ...DEFAULT_RETRIEVAL_CONFIG, ...config };
  }

  async retrieve(params: {
    node_id: string;
    include_metadata?: boolean;
    conversation_id?: string;
  }): Promise<{
    success: boolean;
    content?: string;
    metadata?: Record<string, any>;
    error?: string;
  }> {
    const { node_id, include_metadata = true, conversation_id } = params;
    try {
      const filePath = await this.findNodeFile(node_id, conversation_id);
      if (!filePath) {
        return { success: false, error: `Node ${node_id} not found in storage` };
      }
      const fullContent = await fs.readFile(filePath, 'utf-8');
      const node = this.parseNodeFile(fullContent);
      const result: any = { success: true, content: node.content };
      if (include_metadata) {
        result.metadata = {
          node_id: node.node_id,
          timestamp: node.timestamp,
          type: node.type,
          summary: node.summary,
          parent_node: node.parent_node
        };
      }
      return result;
    } catch (error: any) {
      return { success: false, error: `Retrieval failed: ${error.message}` };
    }
  }

  async search(params: {
    query: string;
    conversation_id?: string;
    limit?: number;
  }): Promise<{
    success: boolean;
    results: Array<{
      node_id: string;
      summary: string;
      type: string;
      snippet: string;
      conversation_id?: string;
      score: number;
    }>;
    total: number;
  }> {
    const { query, conversation_id, limit = this.config.max_results } = params;
    try {
      const baseDir = path.join(this.config.storage_path, 'refs');
      const targetDirs = conversation_id
        ? [path.join(baseDir, conversation_id)]
        : await this.getAllRefsDirs(baseDir);

      const matches: any[] = [];

      for (const dir of targetDirs) {
        try {
          const files = await fs.readdir(dir);
          for (const file of files) {
            if (!file.endsWith('.md')) continue;
            const filePath = path.join(dir, file);
            const content = await fs.readFile(filePath, 'utf-8');
            const node = this.parseNodeFile(content);
            const score = this.calculateMatchScore(query, node);
            if (score > 0) {
              const convId = path.basename(dir);
              matches.push({
                node_id: node.node_id,
                summary: node.summary,
                type: node.type,
                snippet: this.extractSnippet(node.content, query, 200),
                conversation_id: convId,
                score
              });
            }
          }
        } catch {
          continue;
        }
      }

      matches.sort((a, b) => b.score - a.score);

      return {
        success: true,
        results: matches.slice(0, limit),
        total: matches.length
      };
    } catch (error: any) {
      return { success: false, results: [], total: 0 };
    }
  }

  private calculateMatchScore(query: string, node: MemoryNode): number {
    const keywords = query.toLowerCase().split(/\s+/);
    const content = (node.summary + ' ' + node.content).toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (!kw) continue;
      const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      const matches = (content.match(re) || []).length;
      score += matches;
      if (node.summary.toLowerCase().includes(kw)) {
        score += 2;
      }
    }
    return score;
  }

  private extractSnippet(content: string, query: string, maxLength: number): string {
    const index = content.toLowerCase().indexOf(query.toLowerCase());
    if (index === -1) return content.slice(0, maxLength) + '...';
    const start = Math.max(0, index - 50);
    const end = Math.min(content.length, index + query.length + 150);
    let snippet = content.slice(start, end);
    if (start > 0) snippet = '...' + snippet;
    if (end < content.length) snippet = snippet + '...';
    return snippet;
  }

  private async getAllRefsDirs(baseDir: string): Promise<string[]> {
    try {
      const convIds = await fs.readdir(baseDir);
      return convIds.map((id: string) => path.join(baseDir, id));
    } catch {
      return [];
    }
  }

  private async findNodeFile(nodeId: string, conversationId?: string): Promise<string | null> {
    const baseDir = path.join(this.config.storage_path, 'refs');
    if (conversationId) {
      const dir = path.join(baseDir, conversationId);
      return this.scanDirectoryForNode(dir, nodeId);
    }
    try {
      const convDirs = await fs.readdir(baseDir);
      for (const convId of convDirs) {
        const dir = path.join(baseDir, convId);
        const found = await this.scanDirectoryForNode(dir, nodeId);
        if (found) return found;
      }
    } catch {
      // ignore
    }
    return null;
  }

  private async scanDirectoryForNode(dir: string, nodeId: string): Promise<string | null> {
    try {
      const files = await fs.readdir(dir);
      const target = files.find((f: string) => f.includes(nodeId));
      return target ? path.join(dir, target) : null;
    } catch {
      return null;
    }
  }

  private parseNodeFile(content: string): MemoryNode {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!frontmatterMatch) throw new Error('Invalid node file format');
    const [, fm, rawContent] = frontmatterMatch;
    const fmLines = fm.split('\n');
    const node: any = { content: rawContent.trim() };
    for (const line of fmLines) {
      if (!line.trim()) continue;
      const idx = line.indexOf(': ');
      if (idx === -1) continue;
      const key = line.slice(0, idx);
      const value = line.slice(idx + 2);
      if (key === 'timestamp') {
        node[key] = Number(value);
      } else if (key === 'parent_node') {
        node[key] = value === 'null' ? null : value;
      } else if (key === 'metadata') {
        try { node.metadata = JSON.parse(value); } catch { node.metadata = {}; }
      } else {
        node[key] = value;
      }
    }
    return node as MemoryNode;
  }

  async listNodes(conversationId: string): Promise<MemoryNode[]> {
    const dir = path.join(this.config.storage_path, 'refs', conversationId);
    try {
      const files = await fs.readdir(dir);
      const nodes: MemoryNode[] = [];
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const content = await fs.readFile(path.join(dir, file), 'utf-8');
        try { nodes.push(this.parseNodeFile(content)); } catch { /* skip */ }
      }
      return nodes.sort((a, b) => a.timestamp - b.timestamp);
    } catch {
      return [];
    }
  }

  async cleanupConversation(conversationId: string): Promise<boolean> {
    const dir = path.join(this.config.storage_path, 'refs', conversationId);
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }
}

export function createRetrievalEngine(config?: Partial<RetrievalConfig>): RetrievalEngine {
  return new RetrievalEngine(config);
}

export async function retrieveHandler(params: any): Promise<any> {
  const engine = createRetrievalEngine();
  return engine.retrieve(params);
}

export async function searchHandler(params: any): Promise<any> {
  const engine = createRetrievalEngine();
  return engine.search(params);
}
