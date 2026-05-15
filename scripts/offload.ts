/**
 * Context Offload Engine
 *
 * 核心逻辑：识别重型内容 → 卸载到文件 → 生成轻量级符号引用
 *
 * 参考：TencentDB-Agent-Memory 的 Context Offloading 机制
 */

import { promises as fs } from 'fs';
import path from 'path';

// ==================== 类型定义 ====================

export interface MemoryNode {
  node_id: string;
  timestamp: number;
  type: NodeType;
  summary: string;
  parent_node: string | null;
  content: string;
  metadata?: Record<string, any>;
}

export type NodeType =
  | 'search_result'
  | 'code_output'
  | 'error_log'
  | 'tool_output'
  | 'user_input'
  | 'assistant_output';

export interface OffloadConfig {
  min_token_count: number;      // 超过此token数才卸载
  storage_path: string;         // 存储根目录
  preserve_types: NodeType[];   // 始终保留原文的类型（错误日志等）
  preserve_threshold: number;   // 小内容阈值（低于此值直接保留）
}

export interface Canvas {
  conversation_id: string;
  nodes: Map<string, MemoryNode>;
  root_node: string | null;
  mermaid_graph: string;
  last_updated: number;
}

// ==================== 默认配置 ====================

const DEFAULT_CONFIG: OffloadConfig = {
  min_token_count: 1000,  // 约750英文单词
  storage_path: './memory',
  preserve_types: ['error_log', 'final_output'],
  preserve_threshold: 500
};

// ==================== 卸载引擎 ====================

export class OffloadEngine {
  private config: OffloadConfig;
  private canvas: Canvas | null = null;

  constructor(convId: string, config: Partial<OffloadConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.canvas = new Canvas(convId);
  }

  /**
   * 判断内容是否需要卸载
   */
  shouldOffload(content: string, type: NodeType): boolean {
    // 错误日志始终保留原文（佛山）
    if (this.config.preserve_types.includes(type)) {
      return false;
    }

    // 小内容直接保留
    const tokenCount = this.estimateTokens(content);
    if (tokenCount < this.config.min_token_count) {
      return false;
    }

    return true;
  }

  /**
   * 估算 token 数量（简单实现）
   */
  estimateTokens(text: string): number {
    // 简化：中文字数 * 1.5，英文单词数 * 1.3
    const chineseChars = (text.match(/[一-龥]/g) || []).length;
    const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
    return Math.floor(chineseChars * 1.5 + englishWords * 1.3);
  }

  /**
   * 卸载内容到文件系统
   */
  async offload(
    content: string,
    type: NodeType,
    summary: string,
    parentNodeId: string | null = null,
    metadata: Record<string, any> = {}
  ): Promise<MemoryNode> {
    const nodeId = this.generateNodeId(type);
    const timestamp = Date.now();

    // 创建记忆节点
    const node: MemoryNode = {
      node_id: nodeId,
      timestamp,
      type,
      summary,
      parent_node: parentNodeId,
      content,
      metadata
    };

    // 如果 canvas 初始化，添加到 canvas
    if (this.canvas) {
      this.canvas.addNode(node);
    }

    // 写入文件系统（除非 preserve_types）
    if (!this.config.preserve_types.includes(type)) {
      await this.writeNodeToFile(node);
    }

    return node;
  }

  /**
   * 生成 node_id
   * 格式: {conv_id}_{timestamp}_{index}
   */
  private generateNodeId(type: NodeType): string {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000);
    const typePrefix = this.getTypePrefix(type);
    return `${this.canvas!.conversation_id}_${timestamp}_${typePrefix}${random}`;
  }

  private getTypePrefix(type: NodeType): string {
    const map: Record<NodeType, string> = {
      search_result: 'sr',
      code_output: 'co',
      error_log: 'el',
      tool_output: 'to',
      user_input: 'ui',
      assistant_output: 'ao'
    };
    return map[type] || 'nd';
  }

  /**
   * 将节点写入文件
   */
  private async writeNodeToFile(node: MemoryNode): Promise<void> {
    const refsDir = path.join(this.config.storage_path, 'refs', this.canvas!.conversation_id);
    await fs.mkdir(refsDir, { recursive: true });

    const filePath = path.join(refsDir, `${node.timestamp}_${node.node_id}.md`);
    const content = this.formatNodeFile(node);

    await fs.writeFile(filePath, content, 'utf-8');
  }

  /**
   * 格式化节点文件内容
   */
  private formatNodeFile(node: MemoryNode): string {
    return `---
node_id: ${node.node_id}
timestamp: ${node.timestamp}
type: ${node.type}
summary: ${node.summary}
parent_node: ${node.parent_node || 'null'}
${node.metadata ? `metadata: ${JSON.stringify(node.metadata, null, 2)}` : ''}
---

## 原始内容（已卸载）

${node.content}
`;
  }

  /**
   * 检索节点（从文件或内存）
   */
  async retrieve(nodeId: string): Promise<MemoryNode | null> {
    // 先尝试从 canvas 内存中获取
    if (this.canvas?.nodes.has(nodeId)) {
      return this.canvas.nodes.get(nodeId)!;
    }

    // 从文件读取
    const filePath = await this.findNodeFile(nodeId);
    if (!filePath) {
      return null;
    }

    const content = await fs.readFile(filePath, 'utf-8');
    return this.parseNodeFile(content);
  }

  /**
   * 查找节点文件路径
   */
  private async findNodeFile(nodeId: string): Promise<string | null> {
    const convId = this.canvas?.conversation_id;
    if (!convId) return null;

    const refsDir = path.join(this.config.storage_path, 'refs', convId);
    try {
      const files = await fs.readdir(refsDir);
      const target = files.find(f => f.includes(nodeId));
      return target ? path.join(refsDir, target) : null;
    } catch {
      return null;
    }
  }

  /**
   * 解析节点文件
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
      const [key, ...rest] = line.split(': ');
      const value = rest.join(': ');
      if (key && value !== undefined) {
        if (key === 'timestamp' || key === 'parent_node') {
          node[key as keyof MemoryNode] = value === 'null' ? null : Number(value);
        } else if (key === 'metadata') {
          try {
            node.metadata = JSON.parse(value);
          } catch {
            node.metadata = {};
          }
        } else {
          node[key as keyof MemoryNode] = value as any;
        }
      }
    }

    return node as MemoryNode;
  }

  /**
   * 获取当前 canvas 的 Mermaid 表示
   */
  getMermaidCanvas(): string {
    if (!this.canvas) return '';
    return this.canvas.renderMermaid();
  }

  /**
   * 获取用于插入到 LLM 上下文的压缩表示
   */
  getCompressedContext(): string {
    if (!this.canvas) return '';
    return `\`\`\`mermaid\n${this.canvas.renderMermaid()}\n\`\`\``;
  }
}

// ==================== Canvas 类 ====================

class Canvas {
  constructor(public conversation_id: string) {
    this.nodes = new Map();
    this.root_node = null;
    this.mermaid_graph = '';
    this.last_updated = Date.now();
  }

  addNode(node: MemoryNode) {
    this.nodes.set(node.node_id, node);

    if (!this.root_node) {
      this.root_node = node.node_id;
    } else if (node.parent_node) {
      // 更新父节点的引用关系会在 render 时处理
    }

    this.updateMermaidGraph();
    this.last_updated = Date.now();
  }

  private updateMermaidGraph() {
    if (this.nodes.size === 0) {
      this.mermaid_graph = 'graph TD\n  EMPTY[无节点]';
      return;
    }

    const lines: string[] = ['graph TD'];

    for (const [nodeId, node] of this.nodes) {
      const label = this.formatNodeLabel(node);
      lines.push(`  ${this.sanitizeId(nodeId)}[${label}]`);

      if (node.parent_node) {
        lines.push(`  ${this.sanitizeId(node.parent_node)} --> ${this.sanitizeId(nodeId)}`);
      }
    }

    this.mermaid_graph = lines.join('\n');
  }

  private formatNodeLabel(node: MemoryNode): string {
    const typeIcons: Record<NodeType, string> = {
      search_result: '🔍',
      code_output: '💻',
      error_log: '❌',
      tool_output: '🔧',
      user_input: '👤',
      assistant_output: '🤖'
    };
    const icon = typeIcons[node.type] || '📄';
    return `${icon} ${node.type.replace(/_/g, ' ')}<br/>node: ${node.node_id.slice(-8)}`;
  }

  private sanitizeId(id: string): string {
    // Mermaid node ID 必须字母开头，不含特殊字符
    return 'n_' + id.replace(/[^a-zA-Z0-9]/g, '_');
  }

  renderMermaid(): string {
    return this.mermaid_graph;
  }
}

// ==================== 导出工厂函数 ====================

export function createOffloadEngine(conversationId: string, config?: Partial<OffloadConfig>) {
  return new OffloadEngine(conversationId, config);
}