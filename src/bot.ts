import type { Telegraf } from "telegraf";
import type { ClaudeAgent } from "./claude.js";
import type { SessionManager } from "./session.js";
import { config, DEFAULT_TEAM_AGENTS, type AgentConfig } from "./config.js";
import { escapeHtml, splitMessage } from "./formatter.js";
import { logConsole } from "./console.js";

// ---------------------------------------------------------------------------
// Telegram send with retry
// ---------------------------------------------------------------------------

async function sendTelegram(
  bot: Telegraf,
  chatId: number,
  text: string,
  parseMode?: "HTML"
): Promise<void> {
  for (let i = 1; i <= 3; i++) {
    try {
      await bot.telegram.sendMessage(
        chatId,
        text,
        parseMode ? { parse_mode: parseMode } : {}
      );
      return;
    } catch (err) {
      if (i === 3) {
        console.error("[Telegram send error]", (err as Error).message);
        return;
      }
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

// ---------------------------------------------------------------------------
// TelegramBatcher — buffers HTML chunks and flushes as a single message
// ---------------------------------------------------------------------------

class TelegramBatcher {
  private chunks: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private typingInterval: ReturnType<typeof setInterval> | null = null;
  private bot: Telegraf;
  private chatId: number;
  private delayMs: number;

  constructor(bot: Telegraf, chatId: number, delayMs = 1500) {
    this.bot = bot;
    this.chatId = chatId;
    this.delayMs = delayMs;
  }

  /** Send "typing…" chat action — shows native indicator in Telegram */
  private sendTyping(): void {
    this.bot.telegram.sendChatAction(this.chatId, "typing").catch(() => {});
  }

  /** Start the typing indicator loop (every 4s; Telegram auto-expires at ~5s) */
  private startTyping(): void {
    if (this.typingInterval) return;
    this.sendTyping();
    this.typingInterval = setInterval(() => this.sendTyping(), 4000);
  }

  /** Stop the typing indicator loop */
  private stopTyping(): void {
    if (this.typingInterval) {
      clearInterval(this.typingInterval);
      this.typingInterval = null;
    }
  }

  /** Add HTML content to the buffer; auto-flushes after idle delay */
  add(html: string): void {
    this.chunks.push(html);
    this.startTyping();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.flush().catch(() => {});
    }, this.delayMs);
  }

  /** Flush the buffer immediately — call before result/permission messages */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.stopTyping();
    if (this.chunks.length === 0) return;

    const combined = this.chunks.join("\n");
    this.chunks = [];

    for (const part of splitMessage(combined)) {
      await sendTelegram(this.bot, this.chatId, part, "HTML");
    }
  }
}

// ---------------------------------------------------------------------------
// DualSender — console (immediate) + Telegram (batched)
// ---------------------------------------------------------------------------

interface DualSender {
  /** Log to console immediately AND queue for Telegram */
  sendUpdate: (text: string, parseMode?: "HTML" | "text") => void;
  /** Flush the Telegram buffer right now */
  flush: () => Promise<void>;
}

function createDualSender(
  bot: Telegraf,
  chatId: number
): DualSender {
  const batcher = new TelegramBatcher(bot, chatId);

  return {
    sendUpdate(text: string, parseMode?: "HTML" | "text") {
      // Console: always immediate
      logConsole(text, parseMode === "HTML");
      // Telegram: batched
      batcher.add(text);
    },
    flush: () => batcher.flush(),
  };
}

// ---------------------------------------------------------------------------
// setupBot — registers middleware and command handlers
// ---------------------------------------------------------------------------

interface QueuedTask {
  prompt: string;
  resumeSessionId?: string;
  agents?: Record<string, AgentConfig>;
  clearSession: boolean;
}

export function setupBot(
  bot: Telegraf,
  claudeAgent: ClaudeAgent,
  sessionManager: SessionManager
): void {
  // ---- Message queue ----
  const taskQueue: QueuedTask[] = [];

  function runTask(
    chatId: number,
    prompt: string,
    resumeSessionId?: string,
    agents?: Record<string, AgentConfig>
  ): void {
    const { sendUpdate, flush } = createDualSender(bot, chatId);

    claudeAgent
      .execute({ prompt, sendUpdate, flush, resumeSessionId, agents })
      .then((result) => {
        if (result.error) {
          sendTelegram(
            bot,
            chatId,
            `\u{274c} Error: ${escapeHtml(result.error)}`,
            "HTML"
          ).catch(() => {});
        }
        // Process next queued task, if any
        if (taskQueue.length > 0) {
          const next = taskQueue.shift()!;
          const preview = escapeHtml(next.prompt.slice(0, 60));
          sendTelegram(
            bot,
            chatId,
            `\u{25b6}\u{fe0f} Starting queued task: <i>${preview}${next.prompt.length > 60 ? "\u{2026}" : ""}</i>`,
            "HTML"
          ).catch(() => {});
          if (next.clearSession) sessionManager.clearCurrent();
          const resumeId = next.clearSession
            ? undefined
            : next.resumeSessionId ?? sessionManager.getCurrent()?.id;
          runTask(chatId, next.prompt, resumeId, next.agents);
        }
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        sendTelegram(
          bot,
          chatId,
          `\u{274c} Unexpected error: ${escapeHtml(msg)}`,
          "HTML"
        ).catch(() => {});
        // Still drain queue on error
        if (taskQueue.length > 0) {
          const next = taskQueue.shift()!;
          const preview = escapeHtml(next.prompt.slice(0, 60));
          sendTelegram(
            bot,
            chatId,
            `\u{25b6}\u{fe0f} Starting queued task: <i>${preview}${next.prompt.length > 60 ? "\u{2026}" : ""}</i>`,
            "HTML"
          ).catch(() => {});
          if (next.clearSession) sessionManager.clearCurrent();
          const resumeId = next.clearSession
            ? undefined
            : next.resumeSessionId ?? sessionManager.getCurrent()?.id;
          runTask(chatId, next.prompt, resumeId, next.agents);
        }
      });
  }
  // ---- Auth middleware ----
  bot.use(async (ctx, next) => {
    if (ctx.from?.id !== config.allowedUserId) {
      await ctx.reply(
        `\u{26d4} Unauthorized. Your user ID (${ctx.from?.id}) is not in the allowlist.`
      );
      return;
    }
    return next();
  });

  // ---- /start ----
  bot.command("start", async (ctx) => {
    await ctx.reply(
      "\u{1f916} <b>Claude Code Telegram Bot</b>\n\n" +
        "Available commands:\n" +
        "/ask &lt;prompt&gt; \u{2014} Send a task to Claude\n" +
        "/chat &lt;message&gt; \u{2014} Continue the current session\n" +
        "/new &lt;prompt&gt; \u{2014} Reset session and start a new task\n" +
        "/team &lt;prompt&gt; \u{2014} Run task with agent team\n" +
        "/reset \u{2014} Clear current session\n" +
        "/switch &lt;id&gt; \u{2014} Switch to a previous session\n" +
        "/status \u{2014} View current session info\n" +
        "/cancel \u{2014} Cancel a running task\n" +
        "/queue \u{2014} View or clear the message queue\n" +
        "/sessions \u{2014} List past sessions\n" +
        "/model [name] \u{2014} Show or switch model\n" +
        "/exit \u{2014} Shut down the bot\n\n" +
        "You can also send plain text directly.\n" +
        "Messages sent while a task is running are queued automatically.",
      { parse_mode: "HTML" }
    );
  });

  // ---- /ask ----
  bot.command("ask", async (ctx) => {
    const prompt = ctx.message.text.replace(/^\/ask\s*/, "").trim();
    if (!prompt) {
      await ctx.reply("Usage: /ask &lt;prompt&gt;", { parse_mode: "HTML" });
      return;
    }
    if (claudeAgent.running) {
      taskQueue.push({ prompt, clearSession: true });
      await ctx.reply(`\u{1f4ec} Queued (position ${taskQueue.length}). Will run after the current task.`);
      return;
    }

    logConsole(`\n\x1b[1m[Telegram] /ask ${prompt}\x1b[0m`);
    sessionManager.clearCurrent();
    await ctx.reply("\u{1f504} Starting\u{2026}");
    runTask(ctx.chat.id, prompt);
  });

  // ---- /chat ----
  bot.command("chat", async (ctx) => {
    const message = ctx.message.text.replace(/^\/chat\s*/, "").trim();
    if (!message) {
      await ctx.reply("Usage: /chat &lt;message&gt;", { parse_mode: "HTML" });
      return;
    }
    const current = sessionManager.getCurrent();
    if (!current) {
      await ctx.reply("No active session. Use /ask to start one.");
      return;
    }
    if (claudeAgent.running) {
      taskQueue.push({ prompt: message, resumeSessionId: current.id, clearSession: false });
      await ctx.reply(`\u{1f4ec} Queued (position ${taskQueue.length}). Will run after the current task.`);
      return;
    }

    logConsole(`\n\x1b[1m[Telegram] /chat ${message}\x1b[0m`);
    await ctx.reply("\u{1f504} Continuing\u{2026}");
    runTask(ctx.chat.id, message, current.id);
  });

  // ---- /status ----
  bot.command("status", async (ctx) => {
    const current = sessionManager.getCurrent();
    let text = "\u{1f4ca} <b>Status</b>\n\n";
    text += `<b>Running:</b> ${claudeAgent.running ? "\u{2705} Yes" : "\u{274c} No"}\n`;
    if (current) {
      text += `<b>Session:</b> <code>${current.id.slice(0, 8)}\u{2026}</code>\n`;
      text += `<b>Task:</b> ${escapeHtml(current.prompt.slice(0, 100))}\n`;
      text += `<b>Started:</b> ${current.createdAt.toLocaleString()}`;
    } else {
      text += "No active session.";
    }
    await ctx.reply(text, { parse_mode: "HTML" });
  });

  // ---- /cancel ----
  bot.command("cancel", async (ctx) => {
    if (claudeAgent.cancel()) {
      const queueNote =
        taskQueue.length > 0
          ? ` Queue has ${taskQueue.length} pending task(s). Use /queue clear to discard.`
          : "";
      await ctx.reply(`\u{1f6d1} Cancelling\u{2026}${queueNote}`);
    } else {
      await ctx.reply("No task running.");
    }
  });

  // ---- /sessions ----
  bot.command("sessions", async (ctx) => {
    const sessions = sessionManager.list();
    if (sessions.length === 0) {
      await ctx.reply("No session history.");
      return;
    }
    const current = sessionManager.getCurrent();
    let text = "\u{1f4cb} <b>Sessions</b>\n\n";
    for (const s of sessions.slice(0, 10)) {
      const mark = s.id === current?.id ? " \u{1f448}" : "";
      text += `<code>${s.id.slice(0, 8)}</code> \u{2014} ${escapeHtml(s.prompt.slice(0, 60))}${mark}\n`;
    }
    text += "\nUse /switch &lt;id&gt; to resume a session.";
    await ctx.reply(text, { parse_mode: "HTML" });
  });

  // ---- /reset ----
  bot.command("reset", async (ctx) => {
    sessionManager.clearCurrent();
    await ctx.reply("Session cleared. Next message starts a fresh conversation.");
  });

  // ---- /new ----
  bot.command("new", async (ctx) => {
    const prompt = ctx.message.text.replace(/^\/new\s*/, "").trim();
    if (!prompt) {
      await ctx.reply("Usage: /new &lt;prompt&gt;", { parse_mode: "HTML" });
      return;
    }
    if (claudeAgent.running) {
      taskQueue.push({ prompt, clearSession: true });
      await ctx.reply(`\u{1f4ec} Queued (position ${taskQueue.length}). Will run after the current task.`);
      return;
    }

    logConsole(`\n\x1b[1m[Telegram] /new ${prompt}\x1b[0m`);
    sessionManager.clearCurrent();
    await ctx.reply("\u{1f504} Starting fresh\u{2026}");
    runTask(ctx.chat.id, prompt);
  });

  // ---- /switch ----
  bot.command("switch", async (ctx) => {
    const idPrefix = ctx.message.text.replace(/^\/switch\s*/, "").trim();
    if (!idPrefix) {
      await ctx.reply("Usage: /switch &lt;id-prefix&gt;", { parse_mode: "HTML" });
      return;
    }
    const session = sessionManager.findByPrefix(idPrefix);
    if (!session) {
      await ctx.reply(`No session found matching <code>${escapeHtml(idPrefix)}</code>. Use /sessions to list.`, { parse_mode: "HTML" });
      return;
    }
    sessionManager.setCurrent(session.id, session.prompt);
    await ctx.reply(
      `Switched to session <code>${session.id.slice(0, 8)}</code>. Use /chat to continue.`,
      { parse_mode: "HTML" }
    );
  });

  // ---- /team ----
  bot.command("team", async (ctx) => {
    const prompt = ctx.message.text.replace(/^\/team\s*/, "").trim();
    if (!prompt) {
      await ctx.reply("Usage: /team &lt;prompt&gt;", { parse_mode: "HTML" });
      return;
    }
    if (claudeAgent.running) {
      taskQueue.push({ prompt, clearSession: true, agents: DEFAULT_TEAM_AGENTS });
      await ctx.reply(`\u{1f4ec} Queued (position ${taskQueue.length}). Will run after the current task.`);
      return;
    }

    logConsole(`\n\x1b[1m[Telegram] /team ${prompt}\x1b[0m`);
    sessionManager.clearCurrent();
    await ctx.reply("\u{1f504} Starting with agent team\u{2026}");
    runTask(ctx.chat.id, prompt, undefined, DEFAULT_TEAM_AGENTS);
  });

  // ---- /queue ----
  bot.command("queue", async (ctx) => {
    const arg = ctx.message.text.replace(/^\/queue\s*/, "").trim().toLowerCase();
    if (arg === "clear") {
      const count = taskQueue.length;
      taskQueue.length = 0;
      await ctx.reply(count > 0 ? `\u{1f5d1}\u{fe0f} Cleared ${count} queued task(s).` : "Queue is already empty.");
      return;
    }
    if (taskQueue.length === 0) {
      await ctx.reply("\u{1f4ed} Queue is empty.");
      return;
    }
    let text = `\u{1f4ec} <b>Queue (${taskQueue.length} task${taskQueue.length > 1 ? "s" : ""})</b>\n\n`;
    taskQueue.forEach((t, i) => {
      const preview = escapeHtml(t.prompt.slice(0, 80));
      const suffix = t.prompt.length > 80 ? "\u{2026}" : "";
      text += `${i + 1}. ${preview}${suffix}\n`;
    });
    text += "\nUse /queue clear to discard all queued tasks.";
    await ctx.reply(text, { parse_mode: "HTML" });
  });

  // ---- /model ----
  bot.command("model", async (ctx) => {
    const arg = ctx.message.text.replace(/^\/model\s*/, "").trim().toLowerCase();
    if (arg) {
      try {
        claudeAgent.setModel(arg);
        const label = arg === "default" ? "default (CLI)" : arg;
        await ctx.reply(`Model set to <b>${label}</b>.`, { parse_mode: "HTML" });
      } catch {
        await ctx.reply("Unknown model. Use: sonnet, opus, haiku, or default.");
      }
      return;
    }

    // No arg — show inline keyboard
    const current = claudeAgent.modelOverride ?? "default";
    const choices = ["sonnet", "opus", "haiku", "default"] as const;
    const buttons = choices.map((m) => ({
      text: m === current ? `\u{2705} ${m}` : m,
      callback_data: `m:${m}`,
    }));
    await ctx.reply(`Current model: <b>${current}</b>`, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [buttons] },
    });
  });

  // ---- /exit ----
  bot.command("exit", async (ctx) => {
    if (claudeAgent.running) {
      claudeAgent.cancel();
    }
    await ctx.reply("\u{1f6d1} Bot shutting down\u{2026}");
    setTimeout(() => process.exit(0), 500);
  });

  // ---- Model callback ----
  bot.action(/^m:(.+)$/, async (ctx) => {
    const alias = ctx.match[1];
    try {
      claudeAgent.setModel(alias);
      const label = alias === "default" ? "default (CLI)" : alias;
      await ctx.editMessageText(`Model set to <b>${label}</b>.`, { parse_mode: "HTML" });
    } catch {
      await ctx.answerCbQuery("Unknown model.");
    }
  });

  // ---- Plain text → smart routing ----
  bot.on("text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) return;
    const current = sessionManager.getCurrent();
    if (claudeAgent.running) {
      taskQueue.push({ prompt: text, resumeSessionId: current?.id, clearSession: false });
      await ctx.reply(`\u{1f4ec} Queued (position ${taskQueue.length}). Will run after the current task.`);
      return;
    }

    logConsole(`\n\x1b[1m[Telegram] ${text}\x1b[0m`);
    await ctx.reply(current ? "\u{1f504} Continuing\u{2026}" : "\u{1f504} Processing\u{2026}");
    runTask(ctx.chat.id, text, current?.id);
  });
}
