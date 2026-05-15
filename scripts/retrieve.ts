/**
 * Retrieval Engine
 *
 * 提供 memory_retrieve 和 memory_search 工具
 * 用于按需访问卸载的原始内容
 */

import { promises as fs } from 'fs';
import path from 'path';
import { OffloadEngine, MemoryNode } from './offload.js';

// ==================== 检索配置 ====================

export interface RetrievalConfig {
  storage_path: string;
  max_results: number;
  enable_fulltext: boolean;  // 是否启用全文检索（需要external）
}

const DEFAULT_RETRIEVAL_CONFIG: RetrievalConfig = {
  storage_path: './memory',
  max_results: 10,
  enable_fulltext: false
};

// ==================== 检索引擎 ====================

export class RetrievalEngine {
  private config: RetrievalConfig;

  constructor(config: Partial<RetrievalConfig> = {}) {
    this.config = { ...DEFAULT_RETRIEVAL_CONFIG, ...config };
  }

  /**
   * 处理 memory_retrieve 工具调用
   * @param params { node_id: string, include_metadata?: boolean }
   */
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
      // 从文件系统查找
      const filePath = await this.findNodeFile(node_id, conversation_id);
      if (!filePath) {
        return {
          success: false,
          error: `Node ${node_id} not found in storage`
        };
      }

      const fullContent = await fs.readFile(filePath, 'utf-8');
      const node = this.parseNodeFile(fullContent);

      // 返回结果
      const result: any = {
        success: true,
        content: node.content
      };

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

    } catch (error) {
      return {
        success: false,
        error: `Retrieval failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * 处理 memory_search 工具调用
   * 全文搜索（简化版：基于关键词匹配）
   */
  async search(params: {
    query: string;
    conversation_id?: string;  // 为空则搜索所有对话
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
      // 确定搜索范围
      const baseDir = path.join(this.config.storage_path, 'refs');
      const targetDirs = conversation_id
        ? [path.join(baseDir, conversation_id)]
        : await this.getAllRefsDirs(baseDir);

      // 收集匹配结果
      const matches: any[] = [];

      for (const dir of targetDirs) {
        try {
          const files = await fs.readdir(dir);

          for (const file of files) {
            if (!file.endsWith('.md')) continue;

            const filePath = path.join(dir, file);
            const content = await fs.readFile(filePath, 'utf-8');
            const node = this.parseNodeFile(content);

            // 简单关键词匹配（可替换为 BM25/向量搜索）
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
          // 目录不存在或无权限，跳过
          continue;
        }
      }

      // 按分数排序
      matches.sort((a, b) => b.score - a.score);

      return {
        success: true,
        results: matches.slice(0, limit),
        total: matches.length
      };

    } catch (error) {
      return {
        success: false,
        results: [],
        total: 0,
        error: `Search failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * 计算匹配分数（简化版：关键词出现次数）
   */
  private calculateMatchScore(query: string, node: MemoryNode): number {
    const keywords = query.toLowerCase().split(/\s+/);
    const content = (node.summary + ' ' + node.content).toLowerCase();
    let score = 0;

    for (const kw of keywords) {
      if (!kw) continue;
      const matches = (content.match(new RegExp(kw, 'g')) || []).length;
      score += matches;
      // summary 中的权重更高
      if (node.summary.toLowerCase().includes(kw)) {
        score += 2;
      }
    }

    return score;
  }

  /**
   * 提取摘要片段
   */
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

  /**
   * 获取所有 conversation 的 refs 目录
   */
  private async getAllRefsDirs(baseDir: string): Promise<string[]> {
    try {
      const convIds = await fs.readdir(baseDir);
      return convIds.map(id => path.join(baseDir, id));
    } catch {
      return [];
    }
  }

  /**
   * 根据 node_id 查找文件路径
   */
  private async findNodeFile(nodeId: string, conversationId?: string): Promise<string | null> {
    const baseDir = path.join(this.config.storage_path, 'refs');

    // 如果指定了 conversation_id，只搜索该目录
    if (conversationId) {
      const dir = path.join(baseDir, conversationId);
      return this.scanDirectoryForNode(dir, nodeId);
    }

    // 搜索所有对话目录
    try {
      const convDirs = await fs.readdir(baseDir);
      for (const convId of convDirs) {
        const dir = path.join(baseDir, convId);
        const found = await this.scanDirectoryForNode(dir, nodeId);
        if (found) return found;
      }
    } catch {
      // 目录不存在
    }

    return null;
  }

  /**
   * 扫描目录查找特定 node_id
   */
  private async scanDirectoryForNode(dir: string, nodeId: string): Promise<string | null> {
    try {
      const files = await fs.readdir(dir);
      const target = files.find(f => f.includes(nodeId));
      return target ? path.join(dir, target) : null;
    } catch {
      return null;
    }
  }

  /**
   * 解析节点文件（复制 offload 中的逻辑）
   */
  private parseNodeFile(content: string): MemoryNode {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!frontmatterMatch) {
      throw new Error('Invalid node file format');
    }

    const [, fm, rawContent] = frontmatterMatch;
    const fmLines = fm.split('\n');
    const node: Partial<MemoryNode> = { content: rawContent.trim() };

    for (const line of fmLines) {
      if (!line.trim()) continue;
      const idx = line.indexOf(': ');
      if (idx === -1) continue;

      const key = line.slice(0, idx);
      const value = line.slice(idx + 2);

      if (key === 'timestamp' || key === 'parent_node') {
        node[key as keyof MemoryNode] = value === 'null' ? null : Number(value);
      } else if (key === 'metadata') {
        try {
          node.metadata = JSON.parse(value);
        } catch {
          node.metadata = {};
        }
      } else {
        (node as any)[key] = value;
      }
    }

    return node as MemoryNode;
  }

  /**
   * 列出某个 conversation 的所有节点
   */
  async listNodes(conversationId: string): Promise<MemoryNode[]> {
    const dir = path.join(this.config.storage_path, 'refs', conversationId);
    try {
      const files = await fs.readdir(dir);
      const nodes: MemoryNode[] = [];

      for (const file of files) {
        if (!file.endsWith('.md')) continue;

        const content = await fs.readFile(path.join(dir, file), 'utf-8');
        try {
          const node = this.parseNodeFile(content);
          nodes.push(node);
        } catch {
          // 解析失败，跳过
        }
      }

      return nodes.sort((a, b) => a.timestamp - b.timestamp);

    } catch {
      return [];
    }
  }

  /**
   * 删除 conversation 的所有卸载文件
   */
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

// ==================== 导出工厂函数 ====================

export function createRetrievalEngine(config?: Partial<RetrievalConfig>) {
  return new RetrievalEngine(config);
}

// ==================== Tool Handlers ====================

/**
 * memory_retrieve 工具处理器
 * 供 Newmax Tool Registry 调用
 */
export async function retrieveHandler(params: any): Promise<any> {
  const engine = createRetrievalEngine();
  return await engine.retrieve(params);
}

/**
 * memory_search 工具处理器
 */
export async function searchHandler(params: any): Promise<any> {
  const engine = createRetrievalEngine();
  return await engine.search(params);
}