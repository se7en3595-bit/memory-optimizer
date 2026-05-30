# Memory Optimizer - 集成指南

本指南将帮助你在一分钟内将 memory-optimizer 集成到牛马AI中。

---

## 前置条件

- 牛马AI 版本 ≥ v2.5.0
- Node.js ≥ 16.x
- Git（可选，用于克隆源码）

---

## Step 1: 部署 Skill 文件

确保整个 `memory-optimizer` 目录位于以下路径之一：

**首选**（用户级配置）:
```
%APPDATA%/Newmax/skills/memory-optimizer/
```
Windows 示例: `C:\Users\YourName\AppData\Roaming\Newmax\skills\memory-optimizer\`

**全局**（所有用户）:
```
/usr/local/share/newmax/skills/memory-optimizer/
```

**工作区级**（仅当前 workspace）:
```
E:/WorkSpace/Newmax/.claude/skills/memory-optimizer/
```

---

## Step 2: 注册 Message Middleware

编辑牛马AI的 pipeline 配置文件：

### 配置文件位置

```
E:/WorkSpace/Newmax/config/message-pipeline.json  (或类似路径)
```

### 添加 middleware 引用

在 `middlewares` 数组中插入：

```json
{
  "message_pipeline": {
    "middlewares": [
      // ... 其他 middleware
      {
        "type": "module",
        "path": "~/.claude/skills/memory-optimizer/scripts/middleware.ts",
        "config": {
          "enabled": true,
          "storage_path": "${workspace}/memory",
          "offload": {
            "min_token_count": 1000,
            "preserve_types": ["error_log", "final_output"]
          },
          "canvas": {
            "update_frequency": "every_message",
            "max_nodes": 100
          }
        }
      }
    ]
  }
}
```

**配置说明**：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `storage_path` | `./memory` | 卸载文件存储根目录，可用 `${workspace}` 变量 |
| `offload.min_token_count` | `1000` | 超过此token数才触发卸载 |
| `offload.preserve_types` | `["error_log","final_output"]` | 总是保留原文的类型 |
| `canvas.max_nodes` | `100` | Canvas最大节点数，超过自动修剪 |

---

## Step 3: 注册 Tools（可选但推荐）

为了让 Agent 能调用 `memory_retrieve` 等工具，需要将工具的 handler 注册到 Tool Registry：

### 编辑 tools 注册文件

```
E:/WorkSpace/Newmax/config/tools.json
```

添加：

```json
{
  "tools": [
    // ... 其他工具
    {
      "name": "memory_retrieve",
      "description": "Retrieve full content of an offloaded memory node by node_id",
      "handler": "~/.claude/skills/memory-optimizer/scripts/retrieve.ts#retrieveHandler",
      "parameters": {
        "type": "object",
        "properties": {
          "node_id": {
            "type": "string",
            "description": "The node_id of the offloaded content"
          },
          "include_metadata": {
            "type": "boolean",
            "default": true
          }
        },
        "required": ["node_id"]
      }
    },
    {
      "name": "memory_search",
      "description": "Full-text search across offloaded memory contents",
      "handler": "~/.claude/skills/memory-optimizer/scripts/retrieve.ts#searchHandler",
      "parameters": {
        "type": "object",
        "properties": {
          "query": {
            "type": "string",
            "description": "Search query"
          },
          "conversation_id": {
            "type": "string",
            "description": "Optional: limit search to current conversation"
          },
          "limit": {
            "type": "number",
            "default": 10
          }
        },
        "required": ["query"]
      }
    }
  ]
}
```

---

## Step 4: 重启牛马AI

重启后，所有新对话将自动启用 Memory Optimizer。

### 验证安装

创建一个新对话，发送任何消息。然后检查：

1. **文件系统**:
   目录 `E:/WorkSpace/Newmax/memory/refs/{conversation_id}/` 应该出现 `.md` 文件。

2. **日志输出**: 在开发者工具控制台查看：
   ```
   [MemoryOptimizer] Initialized for conversation: conv-xxx
   [MemoryOptimizer] Offloaded node: search_001 (was 5,200 tokens, now 45)
   [MemoryOptimizer] Canvas persistence: /memory/canvases/conv-xxx.mmd
   ```

3. **Mermaid Canvas**: 打开 `memory/canvases/{conversation_id}.mmd`，应该看到任务图。

---

## 不修改核心代码的方案（Skill Marketplace）

如果希望以更标准的方式集成，可以将此 skill 发布到 Newmax Skill Marketplace：

1. 创建 `SKILL.md` 已包含必要元数据
2. 用户通过「雇佣牛马」→「Marketplace」安装
3. 安装后自动启用（`auto: true`）
4. 无需任何配置

这种方案的复用性更好，适合作为开源 skill 分发。

---

## 故障排查

### 问题：Middlewares 配置不生效

**检查**:
- 配置 JSON 格式是否正确
- middleware `path` 是否是绝对路径或可解析的 `~` 路径
- 牛马AI是否重新启动

### 问题：卸载文件没有创建

**检查**:
```bash
# 查看是否有写入权限
echo "test" > E:/WorkSpace/Newmax/memory/test.txt

# 检查 storage_path 是否指向可写目录
# 建议使用绝对路径: "E:/WorkSpace/Newmax/memory"
```

### 问题：memory_retrieve 工具未注册

**检查**:
- `tools.json` 中 `handler` 路径是否正确
- 是否需要重启牛马AI的 Tool Service

### 问题：Canvas 未更新

**检查**:
- `canvas.update_frequency` 是否设为 `every_message`
- 查看 offload 日志，确认引擎是否被调用

---

## 性能调优

### 场景：需要更高压缩比

```json
{
  "offload": {
    "min_token_count": 500  // 更激进：500 tokens 就卸载
  }
}
```

### 场景：长任务（>100 node）

```json
{
  "canvas": {
    "max_nodes": 200,
    "auto_prune": true
  }
}
```

### 场景：需要全文搜索

本 skill 暂未内置向量检索，但可通过 `enable_fulltext: true` 升级为 BM25 检索（需要外部依赖）。

---

## 已知限制

1. **不支持跨进程共享 canvas**：每个对话的 canvas 是独立文件，无法在多个对话间共享。
2. **异步写入可能丢失**：如果进程异常退出，未持久化的 canvas 节点可能丢失（但已卸载的文件不受影响）。
3. **检索性能**：当前基于文件遍历， conversations 数量大时较慢，建议配合数据库索引。

---

## 下一步

- 查看 `SKILL.md` 了解完整的参数和功能
- 参考 `scripts/offload.ts` 进行二次开发
- Bonus: 实现基于 TencentDB 的后端存储，实现云同步
