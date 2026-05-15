/**
 * Memory Optimizer - Factory & Registration
 */

import { MemoryOptimizerMiddleware, createMiddleware, MemoryOptimizerConfig } from './middleware.js';

export function createMemoryOptimizer(config?: Partial<MemoryOptimizerConfig>) {
  const middleware: MemoryOptimizerMiddleware = createMiddleware(config);
  const tools = middleware.getTools();
  return { middleware, tools, version: '0.8.0' };
}

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
