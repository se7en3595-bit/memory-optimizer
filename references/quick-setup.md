# Quick Setup - 3分钟快速集成

本指南涵盖最快的一条龙配置流程。

---

## 1️⃣ 复制 Skill

```powershell
# 确保目标目录存在
mkdir E:\WorkSpace\Newmax\.newmax\skills\memory-optimizer -Force

# 复制所有文件（假设你在当前目录）
xcopy .\* E:\WorkSpace\Newmax\.newmax\skills\memory-optimizer\ /E /Y
```

---

## 2️⃣ 修改 message-pipeline.json

打开 `E:/WorkSpace/Newmax/config/message-pipeline.json`，在 `middlewares` 数组中新增：

```json
{
  "type": "module",
  "path": "E:/WorkSpace/Newmax/.claude/skills/memory-optimizer/scripts/middleware.ts",
  "config": {
    "enabled": true,
    "storage_path": "E:/WorkSpace/Newmax/memory"
  }
}
```

---

## 3️⃣ 注册工具

打开 `E:/WorkSpace/Newmax/config/tools.json`，在 `tools` 数组中新增：

```json
{
  "name": "memory_retrieve",
  "description": "Retrieve full offloaded content",
  "handler": "E:/WorkSpace/Newmax/.claude/skills/memory-optimizer/scripts/retrieve.ts#retrieveHandler",
  "parameters": {
    "type": "object",
    "properties": {
      "node_id": { "type": "string" }
    },
    "required": ["node_id"]
  }
}
```

> 注意: `retrieveHandler` function 需要稍后在 retrieve.ts 中导出

---

## 4️⃣ 重启牛马AI

→ 菜单 → 退出 → 重新启动

---

## 5️⃣ 验证

新建对话，发送"测试"。

检查：
- ✅ 目录 `E:/WorkSpace/Newmax/memory/refs/` 出现新文件夹
- ✅ 有 `.md` 文件生成
- ✅ Canvas 文件生成为 `memory/canvases/*.mmd`

---

## 立即生效

此后所有对话自动压缩重型内容，无需额外操作。

---

## 更多配置

详见 `references/integration.md`