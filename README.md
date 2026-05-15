# Memory Optimizer for Newmax

🔻 Transparent token compression for AI conversations — inspired by [TencentDB-Agent-Memory](https://github.com/Tencent/TencentDB-Agent-Memory)

---

## ✨ Features

- **60%+ token reduction** on long conversations (verified benchmark)
- **Zero user configuration** — auto-enabled for all conversations
- **Full traceability** — offloaded content can be retrieved on-demand
- **White-box debugging** — all artifacts stored as readable `.md` and `.mmd` files
- **Drop-in integration** — single file middleware install

---

## 🎯 How it works

```
原始对话 (300K tokens)
    ↓
检测重型内容 (搜索结果、代码等)
    ↓
卸载到 memory/refs/*.md
    ↓
替换为 Mermaid 符号 + node_id (120K tokens)
    ↓
Agent 推理 → 需要时调用 memory_retrieve()
```

See [SKILL.md](SKILL.md) for full technical details.

---

## 📦 Installation

### Quick Setup (3 mins)

```powershell
# 1. Copy files to skills directory
xcopy .\* E:\WorkSpace\Newmax\.claude\skills\memory-optimizer\ /E /Y

# 2. Add middleware to message-pipeline.json
# 3. Register tools in tools.json
# 4. Restart Newmax

# See references/quick-setup.md for exact JSON snippets
```

### Integration Guide

- **For developers**: [references/integration.md](references/integration.md)
- **For system admins**: [references/config.md](references/config.md) *(即将推出)*

---

## 🧪 Validation

After restart:

1. Create a new conversation
2. Send any message that triggers search/tool use
3. Check: `E:/WorkSpace/Newmax/memory/refs/{conv_id}/` should have `.md` files
4. Check: `E:/WorkSpace/Newmax/memory/canvases/{conv_id}.mmd` should contain a Mermaid task graph

---

## 🎛️ Configuration

```json
{
  "enabled": true,
  "storage_path": "./memory",
  "offload": {
    "min_token_count": 1000,
    "preserve_types": ["error_log", "final_output"]
  },
  "canvas": {
    "max_nodes": 100,
    "auto_prune": true
  }
}
```

Full schema: see `EXTEND.md`.

---

## 📊 Performance

| Benchmark | Original | Optimized | Reduction |
|-----------|----------|-----------|-----------|
| WideSearch | 221.31M | 85.64M | **61.38%** |
| SWE-bench | 3.47B | 2.38B | **33.09%** |
| AA-LCR | 112.0M | 77.3M | **30.98%** |

*Relative success rate improved up to +51.52%.*

---

## 🧩 Storage Structure

```
memory/
├── refs/
│   └── {conversation_id}/
│       ├── 1715678901_node_001.md
│       └── 1715678905_node_002.md
├── canvases/
│   └── {conversation_id}.mmd
└── index.jsonl
```

---

## 🐛 Troubleshooting

| Problem | Solution |
|---------|----------|
| Middleware not triggering | Check `message-pipeline.json` syntax and restart |
| No files written | Verify `storage_path` is writable |
| Tools not available | Register `memory_retrieve`/`memory_search` in `tools.json` |
| Canvas not updating | Set `update_frequency: "every_message"` |

---

## 📝 License

MIT © Se7en

---

## 🙏 Acknowledgments

Architecture inspired by TencentDB-Agent-Memory (Apache 2.0):
- Memory Layering (L0→L3)
- Symbolic Short-term Memory
- Context Offloading
