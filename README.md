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

- **Node.js** 20+ — [download](https://nodejs.org/)
- **Claude Code** CLI installed and logged in — [install guide](https://docs.anthropic.com/en/docs/claude-code)
- A **Telegram Bot Token** — create one via [@BotFather](https://t.me/BotFather) on Telegram
- Your **Telegram User ID** — get it from [@userinfobot](https://t.me/userinfobot) on Telegram

## Quick Start (One-Click Setup)

### Windows

```cmd
git clone https://github.com/hunter-npu/claude-telegram-bot.git
cd claude-telegram-bot
setup.bat
```

### macOS / Linux

```bash
git clone https://github.com/hunter-npu/claude-telegram-bot.git
cd claude-telegram-bot
chmod +x setup.sh
./setup.sh
```

The setup script will:
1. Check that Node.js 20+ and Claude Code CLI are installed
2. Run `npm install` to download all dependencies
3. Prompt you for your **Telegram Bot Token** and **User ID**, then create the `.env` config file

Once setup is complete, `cd` into your project directory and start the bot:

```cmd
cct.bat                &REM Windows
```
```bash
./cct.sh               # macOS / Linux (chmod +x cct.sh if needed)
```

Both scripts capture the **current working directory** as Claude's workspace, then launch the bot from the script's own directory. This means you can place the bot repo anywhere and run `cct.bat` / `cct.sh` from whichever project folder you want Claude to work on.

## Manual Setup

If you prefer to configure manually:

1. Clone and install:

```bash
git clone https://github.com/hunter-npu/claude-telegram-bot.git
cd claude-telegram-bot
npm install
```

2. Create a `.env` file (copy from the template):

```bash
cp .env.example .env
```

3. Edit `.env` and fill in your values:

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from [@BotFather](https://t.me/BotFather) |
| `ALLOWED_USER_ID` | Yes | Your Telegram numeric user ID |
| `ANTHROPIC_API_KEY` | No | Not needed for [Claude Max](https://claude.ai) subscribers (SDK uses CLI login) |
| `WORKING_DIRECTORY` | No | Defaults to the directory where you launch the bot |

4. Start the bot from your project directory:

```cmd
path\to\claude-telegram-bot\cct.bat          &REM Windows
```
```bash
/path/to/claude-telegram-bot/cct.sh          # macOS / Linux
```

Or launch directly (working directory = current directory):

```bash
npx tsx src/index.ts
```

## Usage

### Telegram Commands

| Command | Description |
|---|---|
| `/start` | Welcome message and command list |
| `/ask <prompt>` | Start a new task |
| `/chat <message>` | Continue the current session |
| `/new <prompt>` | Clear session and start a new task in one step |
| `/team <prompt>` | Run a task with an agent team (researcher + coder) |
| `/reset` | Clear current session (next message starts fresh) |
| `/switch <id>` | Switch to a previous session by ID prefix |
| `/status` | View current session info |
| `/cancel` | Cancel a running task |
| `/sessions` | List recent sessions |

You can also send plain text directly — it will continue the current session or start a new one.

### Console Commands

While the bot is running, you can also type directly in the terminal:

| Input | Action |
|---|---|
| Any text | Send as a prompt (continues current session if active) |
| `cancel` | Abort the running task |
| `status` | Show current session info |
| `reset` | Clear current session |
| `switch <id>` | Switch to a previous session by ID prefix |
| `sessions` | List recent sessions |
| `y` / `n` | Approve or deny a pending permission request |

### Permission Approval

When Claude requests a write operation (editing files, running shell commands, etc.), you'll see an approval prompt with **Allow / Deny** buttons in Telegram:

> **Permission Request**
> Tool: Bash
> Command: `npm test`
> [ Allow ] [ Deny ]

You can approve from either Telegram (tap the button) or the console (type `y`).

## Advanced Configuration

Create `cct.config.json` in the bot directory to load additional plugins, MCP servers, or custom agents:

```json
{
  "settingSources": ["user", "project", "local"],
  "plugins": [],
  "mcpServers": {},
  "agents": {}
}
```

See `cct.config.example.json` for reference, or check the [docs/](docs/) folder for detailed documentation:

- [Architecture](docs/architecture.md) — System design and module overview
- [Commands](docs/commands.md) — Full command reference with examples
- [Configuration](docs/configuration.md) — All config options explained
- [Changelog](docs/changelog.md) — Version history and what changed
- [Design Rationale](docs/design-rationale.md) — Why things are built this way

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
