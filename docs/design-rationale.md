# 设计思路与实现决策

## 整体设计原则

1. **最小侵入**：每次修改只动必要的文件，不重构已稳定的代码
2. **类型安全**：所有新增接口都有 TypeScript 类型定义，编译器保证正确性
3. **关注点分离**：session 逻辑在 session.ts，agent 配置在 config.ts，SDK 调用在 claude.ts，命令处理在 bot.ts，生命周期在 index.ts
4. **向后兼容**：所有新增字段和参数都是可选的，不影响现有行为

---

## 为什么这样分层？

### session.ts — 纯数据层

`findByPrefix()` 放在 `SessionManager` 中而不是 `bot.ts` 中的理由：

- **复用性**：Telegram 和终端都需要 switch 功能，逻辑应该在底层共享
- **单一职责**：SessionManager 管理所有会话查找逻辑，bot.ts 只负责命令解析和用户交互
- **可测试性**：纯数据操作，无 I/O 依赖，可以轻松写单元测试

### config.ts — 配置层

`AgentConfig` 放在 config.ts 而不是 claude.ts 的理由：

- agent 定义可以来自配置文件（`cct.config.json`），属于配置的范畴
- config.ts 已经负责 `loadExtendedConfig()`，新增字段自然属于这里
- claude.ts 引用 config 类型，而非反过来，保持依赖方向清晰

### claude.ts — SDK 封装层

agents 的合并逻辑（`{ ...ext.agents, ...params.agents }`）放在 `execute()` 中的理由：

- 这是所有任务执行的唯一入口，集中处理避免遗漏
- 合并策略清晰：配置文件提供基础 agents，每次调用可以覆盖或补充
- 与已有的 plugins、mcpServers 处理方式一致

### bot.ts — 命令层

默认 agents 定义放在 `/team` 命令中而非 config.ts 中的理由：

- 这是特定于 `/team` 命令的行为，不是全局默认
- 用户可以通过 `cct.config.json` 配置持久化的 agents（对所有命令生效），`/team` 的内置 agents 只是便利默认值
- 如果放在 config 层，会模糊"配置"和"命令行为"的边界

---

## 关键实现决策

### 保活：为什么用 `getMe()` 而不是其他方案？

**考虑过的方案**：

| 方案 | 问题 |
|------|------|
| WebSocket ping/pong | Telegraf 用长轮询而非 WebSocket |
| `sendMessage` 给自己 | 会产生可见的副作用消息 |
| `getUpdates` | 与 Telegraf 的长轮询冲突 |
| TCP keepalive | 需要底层 socket 访问，Telegraf 不暴露 |
| **`getMe()`** | **轻量、无副作用、无冲突** |

`getMe()` 只返回 bot 自身信息（username、id 等），不修改任何状态，也不与 Telegraf 的长轮询机制冲突。

**为什么 5 分钟间隔？**

- 大多数 NAT/防火墙的空闲超时在 5-30 分钟之间
- 5 分钟足够频繁地保持连接，又不会过度占用网络
- Telegram API 限流不会被这个频率触发

### `findByPrefix()`：为什么要求唯一匹配？

```typescript
const matches = this.sessions.filter((s) => s.id.startsWith(prefix));
return matches.length === 1 ? matches[0] : undefined;
```

如果允许多匹配返回第一个，用户可能意外切换到错误的会话。强制唯一匹配：
- 前 8 位 UUID 碰撞概率极低（约 43 亿分之一），实际使用中几乎不会出现歧义
- 万一碰撞，用户只需多输入几位就能唯一确定

### `/team` 默认 agents：为什么是 researcher + coder？

这是最通用的分工模式：
- **researcher**：只读操作，负责理解现有代码和收集信息，限制工具集防止误修改
- **coder**：全功能，负责实际编写代码

用户可以在 `cct.config.json` 中自定义 agents 来覆盖或扩展。

### agents 合并策略：为什么 params 覆盖 config？

```typescript
const agents = { ...ext.agents, ...params.agents };
```

- `ext.agents`（来自 `cct.config.json`）是用户的持久化配置，总是生效
- `params.agents`（来自 `/team` 命令）是当前任务的特定配置，优先级更高
- 如果用户在配置文件中定义了 `researcher`，`/team` 命令的默认 `researcher` 不会覆盖，因为 config 中的会被 params 展开为同名键覆盖

实际合并顺序：先 config，再 params（`/team` 的默认 agents），params 中的同名定义会覆盖 config 中的。这意味着 `/team` 命令的内置 agents 会覆盖配置文件中的同名 agents。如果用户想用自定义的 agents 替代内置的，应该使用不同的名称，或者直接用 `/ask` 命令（不传入默认 agents，只用配置文件中的）。

### 进程异常捕获：为什么放在 import 前？

```typescript
process.on("uncaughtException", ...);
process.on("unhandledRejection", ...);

import { Telegraf } from "telegraf";
```

ESM 模块的 import 是在模块加载时执行的。如果某个依赖在加载期间触发异步异常，在 import 之后注册的 handler 可能来不及捕获。放在最前面确保覆盖所有阶段。

### 终端为什么不支持 `/team`？

终端主要用于快速调试和权限审批，而 Agent Team 任务通常较复杂、耗时长，更适合在 Telegram 端发起和监控。如有需要，未来可以通过在终端输入中加 `team:` 前缀来支持。

---

## 文件修改影响分析

| 修改 | 影响范围 | 风险 |
|------|----------|------|
| `session.ts` 加 `findByPrefix()` | 仅新增方法，不影响现有 | 无 |
| `config.ts` 加 `agents` 字段 | `CctExtendedConfig` 接口扩展，默认空对象 | 无（可选字段） |
| `claude.ts` 加 agents 透传 | `ExecuteParams` 扩展，`execute()` 新增合并逻辑 | 低（空 agents 不传 SDK） |
| `bot.ts` 加 4 个命令 | 新增命令注册，`runTask` 签名扩展 | 低（新参数可选） |
| `index.ts` 加异常/保活/命令 | 进程级 handler、定时器、readline handler | 低（新增逻辑独立于现有） |

所有修改都是**增量添加**，不修改任何已有逻辑的行为。
