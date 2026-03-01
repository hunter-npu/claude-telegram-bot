# Claude Telegram Bot

A Telegram bot that lets you interact with [Claude Code](https://docs.anthropic.com/en/docs/claude-code) remotely via the [Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk). Monitor tasks, approve file changes, and chat with Claude — all from your phone.

## Features

- **Dual I/O** — Send prompts and receive results from both the terminal console and Telegram
- **Permission control** — Read-only tools auto-approved; write operations (Edit, Bash, Write, etc.) require your explicit approval via inline buttons or console input
- **Session management** — Continue multi-turn conversations with `/chat`, view history with `/sessions`
- **Smart message batching** — Consecutive outputs are merged into a single Telegram message for cleaner reading, with a native "typing…" indicator while working
- **Skills, Plugins & MCP** — Automatically loads your Claude Code settings (user/project/local), with optional `cct.config.json` for extra plugins and MCP servers
- **Cancel anytime** — Abort a running task with `/cancel` or typing `cancel` in the console

## Prerequisites

- **Node.js** 20+
- **Claude Code** CLI installed and logged in (`claude --version`)
- A **Telegram Bot Token** from [@BotFather](https://t.me/BotFather)
- Your **Telegram User ID** (get it from [@userinfobot](https://t.me/userinfobot))

## Setup

1. Clone the repo and install dependencies:

```bash
git clone https://github.com/your-username/claude-telegram-bot.git
cd claude-telegram-bot
npm install
```

2. Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from @BotFather |
| `ALLOWED_USER_ID` | Yes | Your Telegram numeric user ID |
| `ANTHROPIC_API_KEY` | No | Not needed for Claude Max subscribers |
| `WORKING_DIRECTORY` | No | Defaults to the directory where you launch the bot |

3. Run the bot:

```bash
npx tsx src/index.ts
```

Or on Windows, use the provided batch file — the working directory will be wherever you run it from:

```cmd
cct.bat
```

## Telegram Commands

| Command | Description |
|---|---|
| `/start` | Welcome message and command list |
| `/ask <prompt>` | Start a new task |
| `/chat <message>` | Continue the current session |
| `/status` | View current session info |
| `/cancel` | Cancel a running task |
| `/sessions` | List recent sessions |

You can also send plain text directly — it will continue the current session or start a new one.

## Console Commands

While the bot is running, you can also type directly in the terminal:

- Any text → sent as a prompt (continues current session if one exists)
- `cancel` → abort the running task
- `status` → show current session info
- `sessions` → list recent sessions
- `y` / `n` → approve or deny a pending permission request

## Configuration (optional)

Create `cct.config.json` in the bot directory to load additional plugins or MCP servers:

```json
{
  "settingSources": ["user", "project", "local"],
  "plugins": [],
  "mcpServers": {}
}
```

See `cct.config.example.json` for reference.

## Architecture

```
src/
├── index.ts          # Entry point — starts bot and console readline
├── bot.ts            # Telegram command handlers + message batcher
├── claude.ts         # Agent SDK query() wrapper
├── permissions.ts    # canUseTool callback — dual-channel approval
├── session.ts        # In-memory session store
├── formatter.ts      # HTML formatting + message splitting
├── config.ts         # Environment and extended config loading
└── console.ts        # Terminal output helpers + readline
```

## License

MIT
