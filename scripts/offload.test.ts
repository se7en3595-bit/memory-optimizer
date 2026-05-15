import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OffloadEngine, createOffloadEngine } from './offload.js';
import { promises as fs } from 'fs';
import path from 'path';

const TEST_STORAGE = path.join(__dirname, '..', '.test-memory');

describe('OffloadEngine', () => {
  let engine: OffloadEngine;

  beforeEach(() => {
    engine = createOffloadEngine('test-conv-001', {
      storage_path: TEST_STORAGE,
      min_token_count: 100,
      preserve_types: ['error_log']
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(TEST_STORAGE, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('estimateTokens', () => {
    it('should return 0 for empty string', () => {
      expect(engine.estimateTokens('')).toBe(0);
    });

    it('should estimate tokens for English text', () => {
      const tokens = engine.estimateTokens('hello world test');
      expect(tokens).toBeGreaterThan(0);
    });

    it('should estimate tokens for Chinese text', () => {
      const tokens = engine.estimateTokens('你好世界测试');
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('shouldOffload', () => {
    it('should not offload short content', () => {
      expect(engine.shouldOffload('short', 'tool_output')).toBe(false);
    });

    it('should offload long content', () => {
      const longContent = 'a'.repeat(500);
      expect(engine.shouldOffload(longContent, 'tool_output')).toBe(true);
    });

    it('should never offload error_log (preserve_types)', () => {
      const longContent = 'a'.repeat(500);
      expect(engine.shouldOffload(longContent, 'error_log')).toBe(false);
    });
  });

  describe('offload', () => {
    it('should create a node with correct structure', async () => {
      const content = 'This is a long test content that should be offloaded to the file system for testing purposes.';
      const node = await engine.offload(content, 'search_result', 'Test summary');

      expect(node.node_id).toBeDefined();
      expect(node.timestamp).toBeGreaterThan(0);
      expect(node.type).toBe('search_result');
      expect(node.summary).toBe('Test summary');
      expect(node.content).toBe(content);
    });

    it('should persist node to file system', async () => {
      const content = 'Persistent test content for file system verification.';
      const node = await engine.offload(content, 'tool_output', 'File test');

      const refsDir = path.join(TEST_STORAGE, 'refs', 'test-conv-001');
      const files = await fs.readdir(refsDir);
      expect(files.length).toBe(1);
      expect(files[0]).toContain(node.node_id);
    });
  });

  describe('retrieve', () => {
    it('should retrieve a previously offloaded node', async () => {
      const content = 'Retrievable content for testing the retrieval mechanism.';
      const node = await engine.offload(content, 'code_output', 'Retrieve test');

      const retrieved = await engine.retrieve(node.node_id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.content).toBe(content);
      expect(retrieved!.type).toBe('code_output');
    });

    it('should return null for non-existent node', async () => {
      const result = await engine.retrieve('non-existent-node-id');
      expect(result).toBeNull();
    });
  });

  describe('getMermaidCanvas', () => {
    it('should return empty string for empty canvas', () => {
      expect(engine.getMermaidCanvas()).toBe('');
    });

    it('should include node info after offloading', async () => {
      await engine.offload('Test content for canvas', 'tool_output', 'Canvas test');
      const canvas = engine.getMermaidCanvas();
      expect(canvas).toContain('graph TD');
      expect(canvas).toContain('tool');
    });
  });
});
