import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RetrievalEngine, createRetrievalEngine } from './retrieve.js';
import { promises as fs } from 'fs';
import path from 'path';

const TEST_STORAGE = path.join(__dirname, '..', '.test-memory');

function createNodeFile(nodeId: string, type: string, summary: string, content: string) {
  return `---
node_id: ${nodeId}
timestamp: ${Date.now()}
type: ${type}
summary: ${summary}
parent_node: null
---

## 原始内容（已卸载）

${content}
`;
}

describe('RetrievalEngine', () => {
  let engine: RetrievalEngine;

  beforeEach(() => {
    engine = createRetrievalEngine({ storage_path: TEST_STORAGE });
  });

  afterEach(async () => {
    try {
      await fs.rm(TEST_STORAGE, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('retrieve', () => {
    it('should return success=false for non-existent node', async () => {
      const result = await engine.retrieve({ node_id: 'nonexistent' });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should retrieve existing node by nodeId', async () => {
      const convId = 'test-conv-002';
      const nodeId = `${convId}_12345_sr_001`;
      const content = 'Full original content here';

      const refsDir = path.join(TEST_STORAGE, 'refs', convId);
      await fs.mkdir(refsDir, { recursive: true });
      await fs.writeFile(
        path.join(refsDir, `12345_${nodeId}.md`),
        createNodeFile(nodeId, 'search_result', 'Test', content),
        'utf-8'
      );

      const result = await engine.retrieve({ node_id: nodeId, conversation_id: convId });
      expect(result.success).toBe(true);
      expect(result.content).toBe(content);
    });

    it('should include metadata when requested', async () => {
      const convId = 'test-conv-003';
      const nodeId = `${convId}_12345_sr_002`;

      const refsDir = path.join(TEST_STORAGE, 'refs', convId);
      await fs.mkdir(refsDir, { recursive: true });
      await fs.writeFile(
        path.join(refsDir, `12345_${nodeId}.md`),
        createNodeFile(nodeId, 'search_result', 'Meta test', 'Content'),
        'utf-8'
      );

      const result = await engine.retrieve({ node_id: nodeId, conversation_id: convId, include_metadata: true });
      expect(result.success).toBe(true);
      expect(result.metadata).toBeDefined();
      expect(result.metadata!.type).toBe('search_result');
    });
  });

  describe('search', () => {
    it('should return empty results for empty storage', async () => {
      const result = await engine.search({ query: 'anything' });
      expect(result.success).toBe(true);
      expect(result.results).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should find nodes matching query', async () => {
      const convId = 'test-conv-004';
      const nodeId = `${convId}_12345_sr_003`;

      const refsDir = path.join(TEST_STORAGE, 'refs', convId);
      await fs.mkdir(refsDir, { recursive: true });
      await fs.writeFile(
        path.join(refsDir, `12345_${nodeId}.md`),
        createNodeFile(nodeId, 'search_result', 'React hooks tutorial', 'Learn about useEffect and useState hooks in React'),
        'utf-8'
      );

      const result = await engine.search({ query: 'React hooks', conversation_id: convId });
      expect(result.success).toBe(true);
      expect(result.total).toBeGreaterThan(0);
      expect(result.results[0].node_id).toBe(nodeId);
    });
  });

  describe('listNodes', () => {
    it('should return empty array for non-existent conversation', async () => {
      const nodes = await engine.listNodes('nonexistent-conv');
      expect(nodes).toEqual([]);
    });

    it('should list all nodes for a conversation', async () => {
      const convId = 'test-conv-005';
      const refsDir = path.join(TEST_STORAGE, 'refs', convId);
      await fs.mkdir(refsDir, { recursive: true });

      for (let i = 0; i < 3; i++) {
        const nodeId = `${convId}_12345_sr_00${i}`;
        await fs.writeFile(
          path.join(refsDir, `12345_${nodeId}.md`),
          createNodeFile(nodeId, 'tool_output', `Node ${i}`, `Content ${i}`),
          'utf-8'
        );
      }

      const nodes = await engine.listNodes(convId);
      expect(nodes.length).toBe(3);
    });
  });

  describe('cleanupConversation', () => {
    it('should delete all files for a conversation', async () => {
      const convId = 'test-conv-006';
      const refsDir = path.join(TEST_STORAGE, 'refs', convId);
      await fs.mkdir(refsDir, { recursive: true });
      await fs.writeFile(path.join(refsDir, 'test.md'), 'test', 'utf-8');

      const result = await engine.cleanupConversation(convId);
      expect(result).toBe(true);

      await expect(fs.readdir(refsDir)).rejects.toThrow();
    });
  });
});
