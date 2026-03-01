# 更新日志

## v2 — 连接稳定性 + 新命令 + 会话切换 + Agent Team

### 变更概览

| 文件 | 变更内容 |
|------|----------|
| `src/session.ts` | 新增 `findByPrefix()` 方法 |
| `src/config.ts` | 新增 `AgentConfig` 接口和 `agents` 配置字段 |
| `src/claude.ts` | `ExecuteParams` 新增 `agents` 字段，`execute()` 合并 agents 传给 SDK |
| `src/bot.ts` | 4 个新命令 (`/reset`、`/new`、`/switch`、`/team`)，`runTask` 支持 agents，帮助文本更新 |
| `src/index.ts` | 进程异常捕获、Telegraf 错误处理、定时保活、终端 reset/switch 命令、菜单更新 |

### 详细说明

---

### 1. 连接稳定性增强 (`src/index.ts`)

#### 问题

长时间空闲后，Telegram 长轮询连接可能被防火墙/NAT 超时断开，导致 bot 无响应。同时，未捕获的异常会直接导致进程崩溃。

#### 实现

**A. 进程级异常捕获**

在所有 import 之前注册：

```typescript
process.on("uncaughtException", (err) => console.error("[uncaughtException]", err));
process.on("unhandledRejection", (reason) => console.error("[unhandledRejection]", reason));
```

确保任何未处理的异常不会导致进程退出，而是记录到终端。

**B. Telegraf 全局错误处理**

```typescript
bot.catch((err) => logConsole(`[Telegraf error] ${err.message}`));
```

Telegraf 的 middleware 异常如果没有 `bot.catch()` 会抛到进程级别。加上这层可以优雅地捕获并记录。

**C. 定时保活**

```typescript
const keepaliveTimer = setInterval(() => {
  bot.telegram.getMe().catch((err) => logConsole(`[Keepalive] ${err.message}`));
}, 5 * 60 * 1000);
```

- 每 5 分钟调用一次 `getMe()`
- **为什么用 `getMe()`**：这是最轻量的 Telegram API 调用，无副作用，不会给用户发消息，只返回 bot 自身信息
- **为什么需要**：Telegraf 自带长轮询重连机制，但底层 TCP 连接可能被中间网络设备（防火墙、NAT 路由器）的空闲超时策略断开。定期发送请求可以保持连接活跃
- 在 shutdown 时 `clearInterval(keepaliveTimer)` 清理

---

### 2. `/reset` 命令 (`src/bot.ts`)

#### 需求

用户想切断当前会话上下文，下一条消息开始全新对话，但不想立即发送 prompt。

#### 实现

```typescript
bot.command("reset", async (ctx) => {
  sessionManager.clearCurrent();
  await ctx.reply("Session cleared. Next message starts a fresh conversation.");
});
```

只清除 `currentId` 指针，不删除会话历史。用户稍后可以通过 `/switch` 回到该会话。

终端也支持 `reset` 命令（`index.ts` readline handler）。

---

### 3. `/new` 命令 (`src/bot.ts`)

#### 需求

`/reset` + `/ask` 的快捷合体。用户不想分两步操作。

#### 实现

```typescript
bot.command("new", async (ctx) => {
  const prompt = ctx.message.text.replace(/^\/new\s*/, "").trim();
  if (!prompt) { /* 提示用法 */ return; }
  if (claudeAgent.running) { /* 提示等待 */ return; }

  sessionManager.clearCurrent();
  await ctx.reply("🔄 Starting fresh…");
  runTask(bot, ctx.chat.id, claudeAgent, prompt);
});
```

与 `/ask` 的区别：语义更明确，强调"全新开始"。实际逻辑相同（`/ask` 也会 `clearCurrent()`）。

---

### 4. 会话切换 `/switch` (`src/session.ts` + `src/bot.ts`)

#### 需求

用户在多个任务间切换：先做任务 A，中途去做任务 B，然后想回到 A 继续。

#### 实现

**session.ts** — `findByPrefix(prefix)`：

```typescript
findByPrefix(prefix: string): SessionRecord | undefined {
  const matches = this.sessions.filter((s) => s.id.startsWith(prefix));
  return matches.length === 1 ? matches[0] : undefined;
}
```

- 按前缀过滤所有会话
- **只有唯一匹配时才返回**，避免歧义。如果多个会话匹配同一前缀，返回 `undefined`，用户需要输入更长的前缀
- 用户只需输入 `/sessions` 显示的前 8 位 ID

**bot.ts** — `/switch <id>` 命令：

```typescript
bot.command("switch", async (ctx) => {
  const session = sessionManager.findByPrefix(idPrefix);
  if (!session) { /* 报错 */ return; }
  sessionManager.setCurrent(session.id, session.prompt);
  await ctx.reply(`Switched to session ${session.id.slice(0, 8)}. Use /chat to continue.`);
});
```

切换后，用户用 `/chat` 或直接发文本继续该会话。

**`/sessions` 输出**末尾新增提示：

```
Use /switch <id> to resume a session.
```

终端也支持 `switch <id>` 命令。

---

### 5. Agent Team (`src/config.ts` + `src/claude.ts` + `src/bot.ts`)

#### 需求

让 Claude 能调度多个子 Agent 协作完成复杂任务（如一个负责调研、一个负责编码）。

#### 设计思路

Claude Agent SDK 原生支持 `options.agents` 字段，传入 `Record<string, AgentDefinition>`。SDK 内部处理所有团队编排逻辑（Agent/Task 工具调用），不需要应用层做多进程管理。我们只需要：

1. 定义 agent 描述和能力
2. 传给 `query()` 的 options
3. Claude 自己决定何时、如何调用子 agent

#### 实现

**config.ts** — 新增 `AgentConfig` 接口：

```typescript
export interface AgentConfig {
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: "sonnet" | "opus" | "haiku" | "inherit";
}
```

`CctExtendedConfig` 新增 `agents: Record<string, AgentConfig>` 字段，从 `cct.config.json` 读取用户自定义 agent。

**claude.ts** — `ExecuteParams` 新增可选 `agents` 字段，`execute()` 中合并：

```typescript
const agents = { ...ext.agents, ...params.agents };
if (Object.keys(agents).length > 0) {
  options.agents = agents;
}
```

合并策略：配置文件 agents 为底层，请求级 agents 覆盖同名定义。

**bot.ts** — `/team <prompt>` 命令：

```typescript
const defaultAgents = {
  researcher: {
    description: "Research agent for searching code, reading files, and gathering information",
    prompt: "You are a research assistant...",
    tools: ["Read", "Grep", "Glob", "Bash", "WebSearch", "WebFetch"],
    model: "sonnet",
  },
  coder: {
    description: "Coding agent for writing and editing code",
    prompt: "You are a coding assistant...",
    model: "sonnet",
  },
};

runTask(bot, ctx.chat.id, claudeAgent, prompt, undefined, defaultAgents);
```

`runTask()` 签名新增 `agents` 参数，透传给 `claudeAgent.execute()`。

用户也可在 `cct.config.json` 中定义自定义 agents，这些 agents 在所有命令中都会生效。

---

### 6. 命令菜单与帮助更新

**`setMyCommands()`** 新增 4 个命令注册：

```typescript
{ command: "new", description: "Reset & start a new task" },
{ command: "team", description: "Run task with agent team" },
{ command: "reset", description: "Clear current session" },
{ command: "switch", description: "Switch to a previous session" },
```

**`/start` 帮助文本** 更新为完整命令列表。

---

## v1 — 初始版本

首次实现的核心功能：

- Telegram Bot 与 Claude Code Agent SDK 对接
- 双通道 I/O（Telegram + 终端）
- 智能消息批处理（TelegramBatcher，1.5s 缓冲）
- Typing 指示器（每 4s 刷新）
- 工具执行权限控制（双通道审批）
- 会话管理（/ask、/chat、/status、/cancel、/sessions）
- 纯文本自动路由（有会话则继续，无则新建）
- MCP 服务器和插件支持
- 3 次重试的 Telegram 消息发送
- 优雅关闭（SIGINT/SIGTERM）
