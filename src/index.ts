// Process-level exception handlers — keep the bot alive on unexpected errors
process.on("uncaughtException", (err) => console.error("[uncaughtException]", err));
process.on("unhandledRejection", (reason) => console.error("[unhandledRejection]", reason));

import { Telegraf } from "telegraf";
import { config, validateConfig } from "./config.js";
import { PermissionHandler } from "./permissions.js";
import { SessionManager } from "./session.js";
import { ClaudeAgent } from "./claude.js";
import { setupBot, createDualSender } from "./bot.js";
import { createRL, logConsole } from "./console.js";

async function main(): Promise<void> {
  // 1. Validate environment
  validateConfig();

  logConsole("\u{1f916} Starting Claude Telegram Bot\u{2026}");
  logConsole(`\u{1f4c1} Working directory: ${config.workingDirectory}`);

  // Switch process cwd so the Agent SDK subprocess inherits the correct directory
  process.chdir(config.workingDirectory);

  // 2. Create core instances
  const bot = new Telegraf(config.telegramBotToken);
  const sessionManager = new SessionManager();
  const permissionHandler = new PermissionHandler(bot, config.allowedUserId);
  const claudeAgent = new ClaudeAgent(permissionHandler, sessionManager);

  // 3. Wire up Telegram bot commands and middleware
  setupBot(bot, claudeAgent, sessionManager);

  // Global Telegraf error handler
  bot.catch((err) =>
    logConsole(`[Telegraf error] ${err instanceof Error ? err.message : String(err)}`)
  );

  // 4. Graceful shutdown
  // Keepalive — ping Telegram every 5 minutes to prevent NAT/firewall timeouts
  const keepaliveTimer = setInterval(() => {
    bot.telegram.getMe().catch((err: Error) => logConsole(`[Keepalive] ${err.message}`));
  }, 5 * 60 * 1000);

  const shutdown = (signal: string) => {
    logConsole(`\n\u{1f6d1} Received ${signal}, shutting down\u{2026}`);
    clearInterval(keepaliveTimer);
    permissionHandler.cleanup();
    rl.close();
    bot.stop(signal);
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  // 5. Register command menu
  await bot.telegram.setMyCommands([
    { command: "start", description: "Welcome & show help" },
    { command: "ask", description: "Send a new task to Claude" },
    { command: "chat", description: "Continue current session" },
    { command: "new", description: "Reset & start a new task" },
    { command: "team", description: "Run task with agent team" },
    { command: "reset", description: "Clear current session" },
    { command: "switch", description: "Switch to a previous session" },
    { command: "status", description: "View current session status" },
    { command: "cancel", description: "Cancel running task" },
    { command: "sessions", description: "List past sessions" },
  ]);

  // 6. Launch Telegram bot
  await bot.launch({ dropPendingUpdates: true });
  logConsole("\u{2705} Bot is running!");
  logConsole(
    "    Input here or in Telegram. Type \x1b[1mcancel\x1b[0m to abort, \x1b[1mstatus\x1b[0m to check."
  );

  // 7. Console readline — accepts prompts, permission responses, and commands
  const rl = createRL();
  rl.prompt();

  rl.on("line", async (line: string) => {
    const input = line.trim();
    if (!input) {
      if (!claudeAgent.running) rl.prompt();
      return;
    }

    // --- Console commands ---
    if (input.toLowerCase() === "cancel") {
      if (claudeAgent.cancel()) {
        logConsole("\u{1f6d1} Cancellation requested.");
      } else {
        logConsole("No task is running.");
      }
      rl.prompt();
      return;
    }

    if (input.toLowerCase() === "status") {
      const current = sessionManager.getCurrent();
      logConsole(
        `Running: ${claudeAgent.running ? "yes" : "no"}` +
          (current
            ? ` | Session: ${current.id.slice(0, 8)}... | Task: ${current.prompt.slice(0, 80)}`
            : " | No active session")
      );
      rl.prompt();
      return;
    }

    if (input.toLowerCase() === "reset") {
      sessionManager.clearCurrent();
      logConsole("Session cleared. Next input starts a fresh conversation.");
      rl.prompt();
      return;
    }

    if (input.toLowerCase().startsWith("switch ")) {
      const prefix = input.slice(7).trim();
      if (!prefix) {
        logConsole("Usage: switch <id-prefix>");
      } else {
        const session = sessionManager.findByPrefix(prefix);
        if (session) {
          sessionManager.setCurrent(session.id, session.prompt);
          logConsole(`Switched to session ${session.id.slice(0, 8)}. Type a message to continue.`);
        } else {
          logConsole(`No session found matching "${prefix}". Type 'sessions' to list.`);
        }
      }
      rl.prompt();
      return;
    }

    if (input.toLowerCase() === "sessions") {
      const list = sessionManager.list();
      if (list.length === 0) {
        logConsole("No session history.");
      } else {
        for (const s of list.slice(0, 10)) {
          logConsole(`  ${s.id.slice(0, 8)}  ${s.prompt.slice(0, 60)}`);
        }
      }
      rl.prompt();
      return;
    }

    // --- Permission / question response ---
    if (permissionHandler.hasPending) {
      permissionHandler.resolveFromConsole(input);
      return; // task still running, no prompt
    }

    // --- Busy check ---
    if (claudeAgent.running) {
      logConsole(
        "\u{23f3} A task is already in progress. Type \x1b[1mcancel\x1b[0m to abort."
      );
      return;
    }

    // --- Execute as prompt ---
    const current = sessionManager.getCurrent();
    logConsole(
      current
        ? "\u{1f504} Continuing\u{2026}"
        : "\u{1f504} Processing\u{2026}"
    );

    // Notify Telegram that a console task was started
    try {
      await bot.telegram.sendMessage(
        config.allowedUserId,
        `\u{1f4e5} <b>[Console]</b> ${input.length > 100 ? input.slice(0, 100) + "\u{2026}" : input}`,
        { parse_mode: "HTML" }
      );
    } catch {
      /* Telegram not reachable, continue anyway */
    }

    const { sendUpdate, flush } = createDualSender(bot, config.allowedUserId);

    try {
      const result = await claudeAgent.execute({
        prompt: input,
        sendUpdate,
        flush,
        resumeSessionId: current?.id,
      });
      if (result.error) {
        logConsole(`\u{274c} Error: ${result.error}`);
      }
    } catch (err) {
      logConsole(
        `\u{274c} Unexpected error: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    rl.prompt();
  });

  rl.on("close", () => {
    shutdown("SIGINT");
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
