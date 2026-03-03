// Process-level exception handlers — keep the bot alive on unexpected errors
process.on("uncaughtException", (err) => console.error("[uncaughtException]", err));
process.on("unhandledRejection", (reason) => console.error("[unhandledRejection]", reason));

import { Telegraf } from "telegraf";
import { HttpsProxyAgent } from "https-proxy-agent";
import { config, validateConfig } from "./config.js";
import { PermissionHandler } from "./permissions.js";
import { SessionManager } from "./session.js";
import { ClaudeAgent } from "./claude.js";
import { setupBot } from "./bot.js";
import { logConsole } from "./console.js";

const COMMANDS = [
  { command: "start", description: "Welcome & show help" },
  { command: "ask", description: "Send a new task to Claude" },
  { command: "chat", description: "Continue current session" },
  { command: "new", description: "Reset & start a new task" },
  { command: "team", description: "Run task with agent team" },
  { command: "model", description: "Show or switch model" },
  { command: "reset", description: "Clear current session" },
  { command: "switch", description: "Switch to a previous session" },
  { command: "status", description: "View current session status" },
  { command: "cancel", description: "Cancel running task" },
  { command: "sessions", description: "List past sessions" },
  { command: "exit", description: "Shut down the bot" },
];

async function main(): Promise<void> {
  // 1. Validate environment
  validateConfig();

  logConsole("\u{1f916} Starting Claude Telegram Bot\u{2026}");
  logConsole(`\u{1f4c1} Working directory: ${config.workingDirectory}`);

  // Switch process cwd so the Agent SDK subprocess inherits the correct directory
  process.chdir(config.workingDirectory);

  // 2. Create core instances (reused across reconnects)
  const telegrafOptions: ConstructorParameters<typeof Telegraf>[1] = {};
  if (config.httpsProxy) {
    logConsole(`\u{1f310} Using proxy: ${config.httpsProxy}`);
    const agent = new HttpsProxyAgent(config.httpsProxy);
    telegrafOptions.telegram = { agent: agent as never };
  }
  const bot = new Telegraf(config.telegramBotToken, telegrafOptions);
  const sessionManager = new SessionManager();
  const permissionHandler = new PermissionHandler(bot, config.allowedUserId);
  const claudeAgent = new ClaudeAgent(permissionHandler, sessionManager);

  // 3. Wire up Telegram bot commands and middleware (once)
  setupBot(bot, claudeAgent, sessionManager);

  bot.catch((err) =>
    logConsole(`[Telegraf error] ${err instanceof Error ? err.message : String(err)}`)
  );

  // 4. Keepalive
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  function startKeepalive(): void {
    stopKeepalive();
    keepaliveTimer = setInterval(() => {
      bot.telegram.getMe().catch((err: Error) => logConsole(`[Keepalive] ${err.message}`));
    }, 5 * 60 * 1000);
  }

  function stopKeepalive(): void {
    if (keepaliveTimer) {
      clearInterval(keepaliveTimer);
      keepaliveTimer = null;
    }
  }

  // 5. Graceful shutdown
  let stopping = false;

  const shutdown = (signal: string) => {
    stopping = true;
    logConsole(`\n\u{1f6d1} Received ${signal}, shutting down\u{2026}`);
    stopKeepalive();
    permissionHandler.cleanup();
    bot.stop(signal);
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  // 6. Infinite reconnect loop — never gives up
  let delay = 5;
  let connectCount = 0;

  while (!stopping) {
    try {
      // Recovery: clear any stale polling session before each attempt
      await bot.telegram.deleteWebhook({ drop_pending_updates: true }).catch(() => {});

      // Register commands (retried each connect in case previous attempt failed)
      await bot.telegram.setMyCommands(COMMANDS).catch(() => {});

      logConsole("\u{1f50c} Connecting to Telegram\u{2026}");
      startKeepalive();

      // Fire-and-forget: log success when getMe confirms connectivity
      const thisConnect = ++connectCount;
      bot.telegram.getMe().then(
        (me) => {
          if (thisConnect === connectCount && !stopping) {
            logConsole(`\u{2705} @${me.username} is running! Interact via Telegram.`);
            delay = 5; // reset delay on confirmed connection
          }
        },
        () => {} // ignore — launch error will handle it
      );

      // Blocks until polling ends (crash or graceful bot.stop)
      await bot.launch({ dropPendingUpdates: true });

      // Normal stop (bot.stop was called by /exit or SIGINT)
      stopKeepalive();
      break;
    } catch (err) {
      stopKeepalive();
      try { bot.stop("reconnect"); } catch { /* ignore */ }

      if (stopping) break;

      const msg = err instanceof Error ? err.message : String(err);
      logConsole(`\u{26a0}\u{fe0f} ${msg}`);
      logConsole(`\u{1f504} Retrying in ${delay}s\u{2026}`);
      await new Promise((r) => setTimeout(r, delay * 1000));
      delay = Math.min(delay + 5, 20);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
