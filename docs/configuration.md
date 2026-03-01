# 配置参考

## 环境变量 (`.env`)

| 变量 | 必填 | 说明 |
|------|------|------|
| `TELEGRAM_BOT_TOKEN` | 是 | 从 @BotFather 获取的 Bot Token |
| `ANTHROPIC_API_KEY` | 否 | Anthropic API Key。Claude Max 用户可省略（SDK 自动使用 CLI 登录凭证） |
| `ALLOWED_USER_ID` | 是 | 你的 Telegram 数字用户 ID（通过 @userinfobot 获取） |
| `WORKING_DIRECTORY` | 否 | Claude Code 的工作目录，默认为启动 bot 时的 `cwd` |

## 扩展配置 (`cct.config.json`)

放置在 bot 项目根目录，可选文件。不存在时使用默认值。

### 完整示例

```json
{
  "settingSources": ["user", "project", "local"],
  "plugins": [
    { "type": "local", "path": "./my-plugin" }
  ],
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
    },
    "remote-api": {
      "type": "sse",
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer token" }
    }
  },
  "agents": {
    "researcher": {
      "description": "Research agent for searching code and gathering information",
      "prompt": "You are a research assistant. Search the codebase and gather information.",
      "tools": ["Read", "Grep", "Glob", "Bash", "WebSearch", "WebFetch"],
      "model": "sonnet"
    },
    "coder": {
      "description": "Coding agent for writing and editing code",
      "prompt": "You are a coding assistant. Write and edit code as needed.",
      "model": "sonnet"
    },
    "reviewer": {
      "description": "Code review agent",
      "prompt": "You are a code reviewer. Review code for bugs, security issues, and best practices.",
      "tools": ["Read", "Grep", "Glob"],
      "model": "haiku"
    }
  }
}
```

### 字段说明

#### `settingSources`

控制 Claude Code 加载哪些层级的 settings 文件：

- `"user"` — 全局用户设置 (`~/.claude/settings.json`)
- `"project"` — 项目设置 (`.claude/settings.json`)，需要此项才会加载 `CLAUDE.md`
- `"local"` — 本地设置 (`.claude/settings.local.json`)

默认值：`["user", "project", "local"]`

#### `plugins`

加载本地插件，扩展 Claude Code 能力：

```json
{ "type": "local", "path": "./my-plugin" }
```

#### `mcpServers`

MCP 服务器配置。支持两种类型：

**Stdio 类型**（本地进程）：
```json
{
  "command": "node",
  "args": ["./my-server.js"],
  "env": { "API_KEY": "xxx" }
}
```

**HTTP/SSE 类型**（远程服务）：
```json
{
  "type": "sse",
  "url": "https://example.com/mcp",
  "headers": { "Authorization": "Bearer token" }
}
```

#### `agents`

自定义 Agent 定义。配置后，所有 `/ask`、`/chat`、`/team` 等命令执行时都会将这些 agent 注册到 SDK，Claude 可通过 Agent/Task 工具调度它们。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `description` | string | 是 | Agent 用途的自然语言描述，Claude 据此决定何时调用 |
| `prompt` | string | 是 | Agent 的系统提示词 |
| `tools` | string[] | 否 | 允许使用的工具列表。省略则继承父级所有工具 |
| `disallowedTools` | string[] | 否 | 明确禁止的工具列表 |
| `model` | string | 否 | 使用的模型：`"sonnet"` / `"opus"` / `"haiku"` / `"inherit"`。省略则继承主模型 |

**`/team` 命令的默认 agents**：当用户没有在 `cct.config.json` 中配置 agents 时，`/team` 命令会使用内置的 `researcher` + `coder` 两个默认 agent。配置文件中的 agents 会与默认 agents 合并（配置文件优先覆盖同名 agent）。
