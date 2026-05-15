/**
 * Memory Optimizer - Entry Point
 *
 * 导出所有公共接口供牛马AI调用
 */

export { OffloadEngine, Canvas, type MemoryNode, type NodeType, type OffloadConfig } from './offload.js';
export { RetrievalEngine, type RetrievalConfig } from './retrieve.js';
export { MemoryOptimizerMiddleware, createMiddleware, type MemoryOptimizerConfig } from './middleware.js';

/**
 * 工厂函数：创建并返回所有必需组件
 */
export function createMemoryOptimizer(config?: any) {
  const middleware = createMiddleware(config);
  const retrieval = middleware.getTools();

  return {
    middleware,
    tools: retrieval,
    version: '0.8.0'
  };
}

/**
 * 工具注册辅助函数
 * 用于将 memory_retrieve/memory_search 注册到 Newmax Tool Registry
 */
export async function registerTools(registry: any) {
  const { tools } = createMemoryOptimizer();

  await registry.register('memory_retrieve', {
    handler: tools.memory_retrieve,
    description: 'Retrieve full content of an offloaded memory node',
    parameters: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: 'Node ID of the offloaded content' },
        include_metadata: { type: 'boolean', default: true }
      },
      required: ['node_id']
    }
  });

  await registry.register('memory_search', {
    handler: tools.memory_search,
    description: 'Full-text search across memory contents',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        conversation_id: { type: 'string' },
        limit: { type: 'number', default: 10 }
      },
      required: ['query']
    }
  });
}

// Default export for quick integration
export default createMemoryOptimizer;