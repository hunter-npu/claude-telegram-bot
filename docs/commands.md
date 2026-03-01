# 命令参考

## Telegram 命令

| 命令 | 参数 | 说明 |
|------|------|------|
| `/start` | — | 显示欢迎信息和完整命令列表 |
| `/ask <prompt>` | 必填 | 清除当前会话，开始全新任务 |
| `/chat <message>` | 必填 | 在当前会话中继续对话（需要已有活跃会话） |
| `/new <prompt>` | 必填 | `/reset` + `/ask` 的合体：清除会话后立即开始新任务 |
| `/team <prompt>` | 必填 | 以 Agent Team 模式执行任务（带 researcher + coder 子 agent） |
| `/reset` | — | 清除当前会话指针，下次消息将开启全新对话 |
| `/switch <id>` | 必填 | 按 ID 前缀切换到历史会话，之后用 `/chat` 继续 |
| `/status` | — | 查看当前运行状态和会话信息 |
| `/cancel` | — | 取消正在运行的任务 |
| `/sessions` | — | 列出最近 10 个会话（含 ID 前 8 位和任务摘要） |

**纯文本消息**：直接发送文本（不带 `/` 前缀），bot 会自动路由——有活跃会话则继续，否则开启新对话。

## 终端命令

| 命令 | 说明 |
|------|------|
| `cancel` | 取消当前任务 |
| `status` | 查看运行状态 |
| `reset` | 清除当前会话 |
| `switch <id-prefix>` | 切换到历史会话 |
| `sessions` | 列出会话历史 |
| *其他输入* | 作为 prompt 发送给 Claude（有活跃会话则继续，否则新建） |

## 命令对照

| 功能 | Telegram | 终端 |
|------|----------|------|
| 新任务 | `/ask <prompt>` | 直接输入 prompt |
| 继续对话 | `/chat <msg>` 或直接发文本 | 直接输入 |
| 重置+新任务 | `/new <prompt>` | `reset` → 输入 prompt |
| Agent Team | `/team <prompt>` | —（暂不支持） |
| 清除会话 | `/reset` | `reset` |
| 切换会话 | `/switch <id>` | `switch <id>` |
| 取消任务 | `/cancel` | `cancel` |
| 查看状态 | `/status` | `status` |
| 会话列表 | `/sessions` | `sessions` |

## 典型工作流

### 基本任务

```
/ask 读取 src/index.ts 并总结其功能
→ Claude 执行，输出结果
```

### 多轮对话

```
/ask 分析这个项目的测试覆盖率
→ (Claude 执行完毕)
/chat 帮我补充缺失的单元测试
→ (继续同一会话上下文)
```

### 会话切换

```
/sessions
→ 显示: a1b2c3d4 — 分析测试覆盖率
         e5f6g7h8 — 重构数据库层

/switch a1b2c3d4
→ 切换到 "分析测试覆盖率" 会话

/chat 之前分析的结果有哪些改进建议？
→ 在该历史会话上下文中继续
```

### Agent Team 模式

```
/team 重构 src/utils 目录，提取公共函数并添加测试
→ Claude 自动调度 researcher 和 coder 子 agent 协作完成
```
