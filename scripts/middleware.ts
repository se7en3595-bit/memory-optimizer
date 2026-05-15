/**
 * Memory Optimizer Middleware
 * 透明拦截消息 pipeline，实现自动上下文卸载与压缩
 */

import { promises as fs } from 'fs';
import path from 'path';
import { OffloadEngine, createOffloadEngine, MemoryNode, NodeType } from './offload.js';
import { RetrievalEngine, createRetrievalEngine } from './retrieve.js';

// ==================== 配置接口 ====================

export interface MemoryOptimizerConfig {
  enabled: boolean;
  storage_path: string;
  offload: {
    min_token_count: number;
    preserve_types: string[];
  };
  canvas: {
    update_frequency: 'every_message' | 'on_completion';
    max_nodes: number;
  };
}

const DEFAULT_CONFIG: MemoryOptimizerConfig = {
  enabled: true,
  storage_path: './memory',
  offload: {
    min_token_count: 1000,
    preserve_types: ['error_log', 'final_output']
  },
  canvas: {
    update_frequency: 'every_message',
    max_nodes: 100
  }
};

// ==================== 消息类型 ====================

interface Message {
  role: string;
  content: string;
  tool_results?: any[];
  [key: string]: any;
}

interface ConversationContext {
  conversation_id: string;
  user_id: string;
}

// ==================== Middleware 主类 ====================

export class MemoryOptimizerMiddleware {
  private config: MemoryOptimizerConfig;
  private engine: OffloadEngine | null = null;
  private retrieval: RetrievalEngine;
  private conversationId: string | null = null;

  constructor(config: Partial<MemoryOptimizerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.retrieval = createRetrievalEngine({ storage_path: this.config.storage_path });
  }

  async process(messages: Message[], context: ConversationContext): Promise<Message[]> {
    if (!this.config.enabled) return messages;

    this.conversationId = context.conversation_id;

    if (!this.engine) {
      this.engine = createOffloadEngine(context.conversation_id, {
        storage_path: this.config.storage_path,
        min_token_count: this.config.offload.min_token_count,
        preserve_types: this.config.offload.preserve_types as NodeType[]
      });
    }

    const compressedMessages = await this.compressMessages(messages);
    const finalMessages = this.injectSystemInstructions(compressedMessages);
    await this.persistCanvas();

    return finalMessages;
  }

  private async compressMessages(messages: Message[]): Promise<Message[]> {
    const result: Message[] = [];

    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.tool_results) {
        const compressedToolResults = await Promise.all(
          msg.tool_results.map((tr: any) => this.processToolResult(tr))
        );
        result.push({ ...msg, tool_results: compressedToolResults });
      } else {
        result.push(msg);
      }
    }

    if (this.engine && this.engine.getCanvas().nodes.size > this.config.canvas.max_nodes) {
      this.pruneOldNodes();
    }

    return result;
  }

  private async processToolResult(toolResult: any): Promise<any> {
    const content = typeof toolResult.content === 'string'
      ? toolResult.content
      : JSON.stringify(toolResult.content);

    const nodeType = this.inferNodeType(toolResult.tool_name, content) as NodeType;
    const summary = this.generateSummary(content, nodeType);

    if (!this.engine) return toolResult;

    const wasOffloaded = this.engine.shouldOffload(content, nodeType);

    if (wasOffloaded) {
      const parentNodeId = this.getParentNodeId();
      const node = await this.engine.offload(content, nodeType, summary, parentNodeId, {
        tool_name: toolResult.tool_name
      });
      return {
        ...toolResult,
        content: this.formatCompressedContent(node, summary)
      };
    }

    return toolResult;
  }

  private inferNodeType(toolName: string, content: string): string {
    const lowerContent = content.toLowerCase();
    if (content.includes('Error:') || content.includes('Exception')) return 'error_log';
    if (toolName.includes('search') || lowerContent.includes('results:')) return 'search_result';
    if (content.includes('```')) return 'code_output';
    return 'tool_output';
  }

  private generateSummary(content: string, type: string): string {
    const maxLen = 200;
    let summary = content.slice(0, maxLen).replace(/\n/g, ' ');
    if (content.length > maxLen) summary += '...';

    const prefixes: Record<string, string> = {
      search_result: '[Search] ',
      code_output: '[Code] ',
      error_log: '[Error] ',
      tool_output: '[Tool] '
    };

    return (prefixes[type] || '[Content] ') + summary;
  }

  private formatCompressedContent(node: MemoryNode, summary: string): string {
    return `[CONTEXT OFFLOADED - node_id: ${node.node_id}]

${summary}

To retrieve: memory_retrieve(node_id="${node.node_id}")
`;
  }

  private getParentNodeId(): string | null {
    if (!this.engine) return null;
    const nodes = this.engine.getCanvas().nodes;
    if (nodes.size === 0) return null;
    const nodeArray = Array.from(nodes.values());
    return nodeArray[nodeArray.length - 1].node_id;
  }

  private pruneOldNodes(): void {
    if (!this.engine) return;
    const canvas = this.engine.getCanvas();
    const nodes = Array.from(canvas.nodes.entries());
    if (nodes.length <= this.config.canvas.max_nodes * 0.8) return;
    const toRemove = nodes.slice(0, nodes.length - Math.floor(this.config.canvas.max_nodes * 0.8));
    for (const [id] of toRemove) {
      canvas.nodes.delete(id);
    }
  }

  private async persistCanvas(): Promise<void> {
    if (!this.engine) return;
    const canvas = this.engine.getCanvas();
    if (canvas.nodes.size === 0) return;

    const canvasDir = path.join(this.config.storage_path, 'canvases');
    await fs.mkdir(canvasDir, { recursive: true });
    const filePath = path.join(canvasDir, `${canvas.conversation_id}.mmd`);
    const mermaid = canvas.renderMermaid();
    await fs.writeFile(filePath, mermaid, 'utf-8');
  }

  private injectSystemInstructions(messages: Message[]): Message[] {
    const systemInstruction = `\n\n[MEMORY OPTIMIZER ACTIVE]\nConversation history is symbolically compressed via Mermaid. Use memory_retrieve(node_id="...") to access offloaded content.`;

    const sysIndex = messages.findIndex((m: Message) => m.role === 'system');

    if (sysIndex >= 0) {
      const sysMsg = messages[sysIndex];
      if (!sysMsg.content.includes('[MEMORY OPTIMIZER')) {
        messages[sysIndex] = { ...sysMsg, content: sysMsg.content + systemInstruction };
      }
    } else {
      messages.unshift({
        role: 'system',
        content: `You are a helpful AI assistant.\n${systemInstruction}`
      });
    }

    return messages;
  }

  getTools() {
    return {
      memory_retrieve: async (params: any) => this.retrieval.retrieve(params),
      memory_search: async (params: any) => this.retrieval.search(params)
    };
  }

  async cleanup(conversationId: string): Promise<void> {
    await this.retrieval.cleanupConversation(conversationId);
    this.engine = null;
  }
}

export function createMiddleware(config?: Partial<MemoryOptimizerConfig>): MemoryOptimizerMiddleware {
  return new MemoryOptimizerMiddleware(config);
}
