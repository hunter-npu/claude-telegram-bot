# 系统架构

## 概述

Claude Code Telegram Bot 是一个将 Claude Code Agent SDK 与 Telegram Bot 对接的桥接应用，支持通过 Telegram 和本地终端双通道远程操控 Claude Code 执行编程任务。

## 模块依赖关系

```
index.ts  (入口 & 生命周期管理)
  ├── config.ts        (环境变量 + cct.config.json)
  ├── console.ts       (终端 readline + 输出工具)
  ├── session.ts       (会话状态管理)
  ├── permissions.ts   (工具执行权限控制)
  ├── claude.ts        (Agent SDK query() 封装)
  ├── bot.ts           (Telegram 命令 & 消息批处理)
  └── formatter.ts     (HTML 格式化 & 消息分割)
```

## 各模块职责

### `index.ts` — 入口与生命周期

- 验证环境变量，初始化所有核心实例
- 注册 Telegram 命令菜单（`setMyCommands`）
- 启动 bot 长轮询（`bot.launch`）
- 创建 readline 接口处理终端输入
- 定时保活（每 5 分钟 `getMe()`）
- 进程异常捕获（`uncaughtException` / `unhandledRejection`）
- 优雅关闭（SIGINT / SIGTERM）

### `config.ts` — 配置管理

两层配置：

| 层级 | 来源 | 内容 |
|------|------|------|
| 环境变量 | `.env` | `TELEGRAM_BOT_TOKEN`、`ANTHROPIC_API_KEY`（可选）、`ALLOWED_USER_ID`、`WORKING_DIRECTORY` |
| 扩展配置 | `cct.config.json` | `settingSources`、`plugins`、`mcpServers`、`agents` |

`BOT_DIR` 在模块加载时捕获 `process.cwd()`，确保后续 `chdir` 不影响配置文件路径解析。

### `session.ts` — 会话管理

内存中维护会话列表和当前会话指针：

- `setCurrent(id, prompt)` — 注册/切换当前会话
- `getCurrent()` — 获取当前活跃会话
- `clearCurrent()` — 清除指针（不删除历史）
- `list()` — 按时间倒序列出所有会话
- `getById(id)` — 精确查找
- `findByPrefix(prefix)` — 前缀模糊匹配（唯一匹配时返回）

### `permissions.ts` — 权限控制

实现 Agent SDK 的 `canUseTool` 回调：

- **自动放行**：只读工具（Read、Grep、Glob 等）
- **需要审批**：写操作（Edit、Write、Bash 等）
- **双通道审批**：同时向 Telegram 发送 inline 按钮 + 在终端等待输入，先到先得
- **AskUserQuestion**：将 Claude 的提问转发给用户，用户回答后传回

### `claude.ts` — Agent SDK 封装

`ClaudeAgent` 类封装 `query()` 调用：

- 单实例运行保护（`_running` 标志）
- `AbortController` 支持取消
- 流式处理三种消息：`system`（init）→ `assistant`（文本 + 工具调用）→ `result`（最终结果）
- 合并配置级和请求级 agents 定义传给 SDK

### `bot.ts` — Telegram 命令与消息

三层架构：

1. **TelegramBatcher** — 缓冲 HTML 消息，1.5 秒无新内容后批量发送，避免消息碎片化。同时维持 typing 指示器（每 4 秒刷新）
2. **DualSender** — 统一接口：console 立即输出 + Telegram 批量发送
3. **命令处理器** — 所有 `/command` 的注册和实现

### `formatter.ts` — 格式化工具

- `stripAnsi()` — 去除 ANSI 转义序列
- `escapeHtml()` — HTML 实体转义
- `splitMessage()` — 按 Telegram 4096 字符限制分割消息
- `formatToolCall()` — 将工具调用格式化为带图标的 HTML
- `formatResult()` — 将执行结果格式化为摘要（耗时、token、费用等）

### `console.ts` — 终端工具

- `stripHtml()` — HTML 标签转 ANSI 着色（`<b>` → 粗体，`<code>` → 青色等）
- `logConsole()` — 统一日志输出（可选 HTML → ANSI 转换）
- `createRL()` — 创建 readline 接口

## 数据流

### Telegram → Claude

```
用户发消息 → Telegraf middleware (鉴权)
  → bot.command / bot.on("text")
  → runTask() [fire-and-forget]
  → claudeAgent.execute()
  → SDK query() [流式]
  → 逐条处理 assistant / result 消息
  → DualSender 同时输出到 console + Telegram
```

### Console → Claude

```
终端输入 → readline handler
  → 命令匹配 (cancel/status/reset/switch/sessions)
  → 或 权限回复 (permissionHandler.resolveFromConsole)
  → 或 claudeAgent.execute() [await]
  → DualSender 同时输出
```

### 权限审批流

```
SDK canUseTool 回调触发
  → PermissionHandler 创建 Promise
  → 同时：
    ├── Telegram 发 inline keyboard (Allow/Deny)
    └── Console 打印提示等待输入
  → 用户在任一通道回复 → resolve Promise
  → SDK 继续/中止工具执行
```

## 技术选型理由

| 决策 | 选择 | 理由 |
|------|------|------|
| Bot 框架 | Telegraf | 成熟的 Node.js Telegram Bot 框架，支持 middleware、inline keyboard |
| Claude 集成 | Agent SDK `query()` | 官方流式 API，支持 resume、agents、MCP |
| 消息策略 | 批量发送 | Claude 输出快速且碎片化，逐条发送会触发 Telegram 限流 |
| 权限模型 | 双通道 | 远程使用时依赖 Telegram，本地调试时用终端更方便 |
| 会话存储 | 内存 | Bot 通常单用户使用，重启后 SDK 侧仍保留历史，内存足够 |
| 保活机制 | getMe() | 轻量无副作用，仅维持 TCP 连接 |
