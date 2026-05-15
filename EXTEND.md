---
name: memory-optimizer
description: Token compression and memory optimization for AI agents
version: "0.8.0"
targets:
  - type: conversation
    events:
      - message.before_send_to_llm  # 拦截发送给LLM的消息
      - message.after_tool_call     # 工具调用后处理
      - conversation.created        # 对话创建时初始化canvas
      - conversation.deleted        # 对话删除时清理文件
capabilities:
  - name: offload
    description: 卸载重型内容到文件系统
    trigger: auto
  - name: retrieve
    description: 按node_id检索卸载的内容
    tool: true
  - name: search
    description: 全文检索历史内容
    tool: true
---

# EXTEND - Memory Optimizer Capabilities

## Event Hooks

本 skill 监听以下事件以实现透明拦截：

| 事件 | 触发时机 | 处理逻辑 |
|------|---------|---------|
| `message.before_send_to_llm` | 消息即将发送给 LLM | 压缩 tool_results、长文本，注入 canvas |
| `message.after_tool_call` | 工具执行完成 | 生成 node_id，卸载内容，更新 canvas |
| `conversation.created` | 新对话创建 | 初始化 empty canvas |
| `conversation.deleted` | 对话删除 | 清理 `memory/refs/{conv_id}` 目录 |

## Tools 导出

### memory_retrieve

检索指定 node_id 的原始内容。

```json
{
  "tool": "memory_retrieve",
  "parameters": {
    "node_id": "string (必需)",
    "include_metadata": true
  }
}
```

**返回**: 包含 `content` (原始内容) 和 `metadata` (节点元数据) 的对象。

---

### memory_search

全文检索卸载的历史内容。

```json
{
  "tool": "memory_search",
  "parameters": {
    "query": "string (必需)",
    "conversation_id": "string (可选, 默认当前对话)",
    "limit": 10,
    "min_score": 0.5
  }
}
```

**返回**: 匹配的节点列表，按相关性排序。

---

## Storage Contract

卸载文件必须符合以下结构才能被正确索引和检索：

```markdown
---
node_id: "{conv_id}_{timestamp}_{index}"
timestamp: 1715678901
type: "search_result" | "code_output" | "error_log" | "tool_output" | "user_input"
summary: "人类可读的100字内摘要"
parent_node: "parent_node_id or null"
---

## 原始内容

实际被卸载的内容（markdown或原始文本）
```

---

## Configuration Defaults

```json
{
  "storage_path": "${workspace}/memory",
  "compression": {
    "threshold": 2000,  // 超过2000 tokens的内容才卸载
    "preserve_types": ["error_log", "final_output"]
  },
  "canvas": {
    "max_nodes": 100,
    "auto_prune": true
  }
}
```