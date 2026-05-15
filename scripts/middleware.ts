/**
 * Memory Optimizer Middleware
 *
 * 透明拦截消息 pipeline，实现自动上下文卸载与压缩
 *
 * 工作原理:
 * 1. 监听 message.before_send_to_llm 事件
 * 2. 扫描 messages 数组中的 assistant tool_results
 * 3. 识别重型内容 → 卸载到的文件
 * 4. 替换为轻量级 Mermaid 符号引用
 * 5. 注入系统指令，使 Agent 知道如何检索
 *
 * 本 middleware 应注册到牛马AI的 MessagePipeline 中
 */

import { promises as fs } from 'fs';
import path from 'path';
import { OffloadEngine, Canvas } from './offload.js';
import { RetrievalEngine } from './retrieve.js';
import type { Message } from 'newmax-types';  // 假设的消息类型

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

// ==================== Middleware 主类 ====================

export class MemoryOptimizerMiddleware {
  private config: MemoryOptimizerConfig;
  private engine: OffloadEngine | null = null;
  private retrieval: RetrievalEngine;
  private conversationId: string | null = null;

  constructor(config: Partial<MemoryOptimizerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.retrieval = new RetrievalEngine({ storage_path: this.config.storage_path });
  }

  /**
   * Middleware 入口点
   * @param messages 即将发送给 LLM 的消息数组
   * @param context 对话上下文（包含 conversation_id 等）
   */
  async process(messages: Message[], context: {
    conversation_id: string;
    user_id: string;
  }): Promise<Message[]> {
    if (!this.config.enabled) {
      return messages;
    }

    this.conversationId = context.conversation_id;

    //  lazy initialize OffloadEngine（需要 conversationId）
    if (!this.engine) {
      this.engine = new OffloadEngine(context.conversation_id, {
        storage_path: this.config.storage_path,
        min_token_count: this.config.offload.min_token_count,
        preserve_types: this.config.offload.preserve_types as any
      });
    }

    // Step 1: 扫描并压缩 messages
    const compressedMessages = await this.compressMessages(messages);

    // Step 2: 在 system message 中注入压缩上下文
    const finalMessages = this.injectSystemInstructions(compressedMessages);

    // Step 3: 保存 canvas 到文件（异步）
    await this.persistCanvas();

    return finalMessages;
  }

  /**
   * 压缩消息：卸载 tool_results 和长content
   */
  private async compressMessages(messages: Message[]): Promise<Message[]> {
    const result: Message[] = [];

    for (const msg of messages) {
      // 只处理 assistant 消息中的 tool_results
      if (msg.role === 'assistant' && msg.tool_results) {
        const compressedToolResults = await Promise.all(
          msg.tool_results.map(tr => this.processToolResult(tr))
        );

        result.push({
          ...msg,
          tool_results: compressedToolResults
        });
      } else {
        // 检查普通 content 是否过长需要压缩（可选）
        if (msg.content && this.shouldCompressContent(msg.content)) {
          const compressed = await this.compressContent(msg.content, 'user_input');
          result.push({ ...msg, content: compressed });
        } else {
          result.push(msg);
        }
      }
    }

    // 自动修剪过长的 canvas
    if (this.engine && this.engine.getCanvas().nodes.size > this.config.canvas.max_nodes) {
      this.pruneOldNodes();
    }

    return result;
  }

  /**
   * 处理单个 tool_result
   */
  private async processToolResult(toolResult: any): Promise<any> {
    const content = typeof toolResult.content === 'string'
      ? toolResult.content
      : JSON.stringify(toolResult.content);

    const nodeType = this.inferNodeType(toolResult.tool_name, content);
    const summary = this.generateSummary(content, nodeType);

    // 决定是否卸载
    const wasOffloaded = this.engine!.shouldOffload(content, nodeType);

    if (wasOffloaded) {
      // 执行卸载
      const parentNodeId = this.getParentNodeId();  // 可能需要追踪 parent
      const node = await this.engine!.offload(
        content,
        nodeType,
        summary,
        parentNodeId,
        { tool_name: toolResult.tool_name }
      );

      // 返回轻量级引用
      return {
        ...toolResult,
        content: this.formatCompressedContent(node, summary)
      };
    }

    // 保留原文
    return toolResult;
  }

  /**
   * 推断节点类型
   */
  private inferNodeType(toolName: string, content: string): any {
    const lowerContent = content.toLowerCase();

    if (content.includes('Error:') || content.includes('Exception')) {
      return 'error_log';
    }

    if (toolName.includes('search') || lowerContent.includes('results:')) {
      return 'search_result';
    }

    if (content.includes('```')) {
      return 'code_output';
    }

    if (toolName.startsWith('tdai_')) {
      return 'tool_output';
    }

    return 'tool_output';
  }

  /**
   * 生成摘要（AI质量）
   */
  private generateSummary(content: string, type: any): string {
    // 基础摘要：取前200字符，并标注类型
    const maxLen = 200;
    let summary = content.slice(0, maxLen).replace(/\n/g, ' ');

    if (content.length > maxLen) {
      summary += '...';
    }

    // 根据类型调整前缀
    const prefixes: Record<string, string> = {
      search_result: '🔍 搜索结果: ',
      code_output: '💻 代码输出: ',
      error_log: '❌ 错误日志: ',
      tool_output: '🔧 工具输出: '
    };

    return (prefixes[type] || '📄 ') + summary;
  }

  /**
   * 格式化压缩后的内容（可见给 Agent）
   */
  private formatCompressedContent(node: any, summary: string): string {
    return `[CONTEXT OFFLOADED - full content stored at node_id: ${node.node_id}]

${summary}

📌 To retrieve the full content, call: \`memory_retrieve(node_id="${node.node_id}")\`
`;
  }

  /**
   * 检查普通 content 是否需要压缩
   */
  private shouldCompressContent(content: string): boolean {
    // 暂时不压缩普通 content，只处理 tool_results
    // 可扩展：对超长 user/assistant 内容启用压缩
    return false;
  }

  /**
   * 压缩普通内容（未实装）
   */
  private async compressContent(content: string, type: any): Promise<string> {
    return content;  // placeholder
  }

  /**
   * 获取父节点 ID（用于构建图结构）
   */
  private getParentNodeId(): string | null {
    const nodes = this.engine!.getCanvas().nodes;
    if (nodes.size === 0) return null;

    // 简单策略：取最近添加的节点作为父节点
    const nodeArray = Array.from(nodes.values());
    return nodeArray[nodeArray.length - 1].node_id;
  }

  /**
   * 在 canvas 中修剪旧节点（保持大小）
   */
  private pruneOldNodes(): void {
    const canvas = this.engine!.getCanvas();
    const nodes = Array.from(canvas.nodes.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    // 保留最近 N 个节点，旧节点标记为 archived
    const keepCount = this.config.canvas.max_nodes * 0.8; // 保留80%
    const toArchive = nodes.slice(0, nodes.length - keepCount);

    for (const node of toArchive) {
      // 从 canvas 移除但文件保留
      canvas.nodes.delete(node.node_id);
    }
  }

  /**
   * 将 canvas 持久化到文件
   */
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

  /**
   * 注入 system 说明（如果第一条不是system消息，或追加到已有system）
   */
  private injectSystemInstructions(messages: Message[]): Message[] {
    const systemInstruction = `\n\n[MEMORY OPTIMIZER ACTIVE]\n部分对话历史已符号化压缩。当前上下文包含一个Mermaid任务图，代表完整对话结构。当你需要查看某个node的原始内容时，使用 \`memory_retrieve(node_id="...")\` 工具。`;

    // 找到第一条 system 消息
    const sysIndex = messages.findIndex(m => m.role === 'system');

    if (sysIndex >= 0) {
      const sysMsg = messages[sysIndex];
      if (!sysMsg.content.includes('[MEMORY OPTIMIZER')) {
        messages[sysIndex] = {
          ...sysMsg,
          content: sysMsg.content + systemInstruction
        };
      }
    } else {
      // 没有system消息，在第一条消息前插入一个
      messages.unshift({
        role: 'system',
        content: `You are a helpful AI assistant.\n${systemInstruction}`
      });
    }

    return messages;
  }

  /**
   * 提供检索方法给外部调用（工具注册）
   */
  getTools() {
    return {
      memory_retrieve: async (params: any) => {
        return this.retrieval.retrieve(params);
      },
      memory_search: async (params: any) => {
        return this.retrieval.search(params);
      }
    };
  }

  /**
   * 对话结束时清理资源
   */
  async cleanup(conversationId: string): Promise<void> {
    await this.retrieval.cleanupConversation(conversationId);
    this.engine = null;
  }
}

// ==================== 工厂函数 ====================

export function createMiddleware(config?: Partial<MemoryOptimizerConfig>): MemoryOptimizerMiddleware {
  return new MemoryOptimizerMiddleware(config);
}