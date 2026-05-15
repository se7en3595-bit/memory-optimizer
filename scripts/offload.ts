/**
 * Context Offload Engine
 * 核心逻辑：识别重型内容 → 卸载到文件 → 生成轻量级符号引用
 */

import { promises as fs } from 'fs';
import path from 'path';

// ==================== 类型定义 ====================

export type NodeType =
  | 'search_result'
  | 'code_output'
  | 'error_log'
  | 'tool_output'
  | 'user_input'
  | 'assistant_output'
  | 'final_output';

export interface MemoryNode {
  node_id: string;
  timestamp: number;
  type: NodeType;
  summary: string;
  parent_node: string | null;
  content: string;
  metadata?: Record<string, any>;
}

export interface OffloadConfig {
  min_token_count: number;
  storage_path: string;
  preserve_types: NodeType[];
  preserve_threshold: number;
}

export interface CanvasData {
  conversation_id: string;
  nodes: Map<string, MemoryNode>;
  root_node: string | null;
  mermaid_graph: string;
  last_updated: number;
}

// ==================== 默认配置 ====================

const DEFAULT_CONFIG: OffloadConfig = {
  min_token_count: 1000,
  storage_path: './memory',
  preserve_types: ['error_log', 'final_output'],
  preserve_threshold: 500
};

// ==================== Canvas 类 ====================

class Canvas implements CanvasData {
  conversation_id: string;
  nodes: Map<string, MemoryNode>;
  root_node: string | null;
  mermaid_graph: string;
  last_updated: number;

  constructor(convId: string) {
    this.conversation_id = convId;
    this.nodes = new Map();
    this.root_node = null;
    this.mermaid_graph = '';
    this.last_updated = Date.now();
  }

  addNode(node: MemoryNode): void {
    this.nodes.set(node.node_id, node);
    if (!this.root_node) {
      this.root_node = node.node_id;
    }
    this.updateMermaidGraph();
    this.last_updated = Date.now();
  }

  private updateMermaidGraph(): void {
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
    const typeIcons: Record<string, string> = {
      search_result: '[搜索]',
      code_output: '[代码]',
      error_log: '[错误]',
      tool_output: '[工具]',
      user_input: '[用户]',
      assistant_output: '[AI]',
      final_output: '[最终]'
    };
    const icon = typeIcons[node.type] || '[?]';
    return `${icon} ${node.type.replace(/_/g, ' ')}<br/>node: ${node.node_id.slice(-8)}`;
  }

  private sanitizeId(id: string): string {
    return 'n_' + id.replace(/[^a-zA-Z0-9]/g, '_');
  }

  renderMermaid(): string {
    return this.mermaid_graph;
  }
}

// ==================== 卸载引擎 ====================

export class OffloadEngine {
  private config: OffloadConfig;
  private canvas: Canvas;

  constructor(convId: string, config: Partial<OffloadConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.canvas = new Canvas(convId);
  }

  getCanvas(): Canvas {
    return this.canvas;
  }

  shouldOffload(content: string, type: NodeType): boolean {
    if (this.config.preserve_types.includes(type)) {
      return false;
    }
    const tokenCount = this.estimateTokens(content);
    if (tokenCount < this.config.min_token_count) {
      return false;
    }
    return true;
  }

  estimateTokens(text: string): number {
    const chineseChars = (text.match(/[一-鿿]/g) || []).length;
    const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
    return Math.floor(chineseChars * 1.5 + englishWords * 1.3);
  }

  async offload(
    content: string,
    type: NodeType,
    summary: string,
    parentNodeId: string | null = null,
    metadata: Record<string, any> = {}
  ): Promise<MemoryNode> {
    const nodeId = this.generateNodeId(type);
    const timestamp = Date.now();

    const node: MemoryNode = {
      node_id: nodeId,
      timestamp,
      type,
      summary,
      parent_node: parentNodeId,
      content,
      metadata
    };

    this.canvas.addNode(node);

    if (!this.config.preserve_types.includes(type)) {
      await this.writeNodeToFile(node);
    }

    return node;
  }

  private generateNodeId(type: NodeType): string {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000);
    const typePrefix = this.getTypePrefix(type);
    return `${this.canvas.conversation_id}_${timestamp}_${typePrefix}${random}`;
  }

  private getTypePrefix(type: NodeType): string {
    const map: Record<NodeType, string> = {
      search_result: 'sr',
      code_output: 'co',
      error_log: 'el',
      tool_output: 'to',
      user_input: 'ui',
      assistant_output: 'ao',
      final_output: 'fo'
    };
    return map[type] || 'nd';
  }

  private async writeNodeToFile(node: MemoryNode): Promise<void> {
    const refsDir = path.join(this.config.storage_path, 'refs', this.canvas.conversation_id);
    await fs.mkdir(refsDir, { recursive: true });
    const filePath = path.join(refsDir, `${node.timestamp}_${node.node_id}.md`);
    const content = this.formatNodeFile(node);
    await fs.writeFile(filePath, content, 'utf-8');
  }

  private formatNodeFile(node: MemoryNode): string {
    const meta = node.metadata ? `metadata: ${JSON.stringify(node.metadata, null, 2)}` : '';
    return `---
node_id: ${node.node_id}
timestamp: ${node.timestamp}
type: ${node.type}
summary: ${node.summary}
parent_node: ${node.parent_node || 'null'}
${meta}
---

## Original Content (Offloaded)

${node.content}
`;
  }

  async retrieve(nodeId: string): Promise<MemoryNode | null> {
    if (this.canvas.nodes.has(nodeId)) {
      return this.canvas.nodes.get(nodeId) || null;
    }
    const filePath = await this.findNodeFile(nodeId);
    if (!filePath) return null;
    const content = await fs.readFile(filePath, 'utf-8');
    return this.parseNodeFile(content);
  }

  private async findNodeFile(nodeId: string): Promise<string | null> {
    const convId = this.canvas.conversation_id;
    const refsDir = path.join(this.config.storage_path, 'refs', convId);
    try {
      const files = await fs.readdir(refsDir);
      const target = files.find((f: string) => f.includes(nodeId));
      return target ? path.join(refsDir, target) : null;
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
      const idx = line.indexOf(': ');
      if (idx === -1) continue;
      const key = line.slice(0, idx);
      const value = line.slice(idx + 2);
      if (key === 'timestamp') {
        node[key] = Number(value);
      } else if (key === 'parent_node') {
        node[key] = value === 'null' ? null : Number(value);
      } else if (key === 'metadata') {
        try { node.metadata = JSON.parse(value); } catch { node.metadata = {}; }
      } else {
        node[key] = value;
      }
    }
    return node as MemoryNode;
  }

  getMermaidCanvas(): string {
    return this.canvas.renderMermaid();
  }

  getCompressedContext(): string {
    return `\`\`\`mermaid\n${this.canvas.renderMermaid()}\n\`\`\``;
  }
}

export function createOffloadEngine(conversationId: string, config?: Partial<OffloadConfig>): OffloadEngine {
  return new OffloadEngine(conversationId, config);
}
