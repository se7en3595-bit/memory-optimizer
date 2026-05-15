# System Prompt Extension - Memory Optimizer

**注意: 本片段用于注入到 Conversation 的 system prompt**

---

## Context Management Instructions

部分对话历史已被压缩存储以节省 token。当前上下文中保留的是**符号化任务图**（Mermaid 格式），代表完整对话结构的轻量级视图。

### 理解符号图

Mermaid 图中的每个节点包含：

- **节点类型**: `搜索` / `工具调用` / `代码生成` / `结果`
- **node_id**: 唯一标识符，用于检索原始内容
- **简要摘要**: 该步骤的核心信息

示例：

```mermaid
graph TD
  A[开始<br/>node: root] --> B[搜索<br/>node_id: search_001]
  B --> C[分析结果<br/>node_id: analyze_002]
  C --> D[生成回答<br/>node_id: final]
```

### 按需检索详细内容

当你需要查看某个节点的**完整原始内容**时，使用内置工具：

```
memory_retrieve(node_id="{node_id}")
```

使用场景：

- 需要引用搜索结果的具体数据时
- 调试某个工具执行的异常时
- 检查用户之前提供的详细需求时

### 检索历史信息

如需搜索过去对话中的相关内容（跨会话）：

```
memory_search(query="关键词", conversation_id="当前对话ID")
```

### 最佳实践

1. **优先使用符号图进行推理** - 保持轻量上下文
2. **仅在需要细节时检索** - 避免 unnecessary calls
3. **保持 node_id 引用** - 在引用时带上 node_id 以便追溯
4. **更新 canvas** - 每执行一个重要步骤，记录新 node_id

---

## 自动行为

- 你看到的上下文已自动压缩，无感知
- 不需要手动管理存储路径
- 所有检索工具已内置，可直接调用