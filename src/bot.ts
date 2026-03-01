import type { Telegraf } from "telegraf";
import type { ClaudeAgent } from "./claude.js";
import type { SessionManager } from "./session.js";
import { config } from "./config.js";
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

export interface DualSender {
  /** Log to console immediately AND queue for Telegram */
  sendUpdate: (text: string, parseMode?: "HTML" | "text") => void;
  /** Flush the Telegram buffer right now */
  flush: () => Promise<void>;
}

export function createDualSender(
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
// Fire-and-forget: run a Claude task without blocking the Telegraf handler
// ---------------------------------------------------------------------------

function runTask(
  bot: Telegraf,
  chatId: number,
  claudeAgent: ClaudeAgent,
  prompt: string,
  resumeSessionId?: string
): void {
  const { sendUpdate, flush } = createDualSender(bot, chatId);

  claudeAgent
    .execute({ prompt, sendUpdate, flush, resumeSessionId })
    .then((result) => {
      if (result.error) {
        sendTelegram(
          bot,
          chatId,
          `\u{274c} Error: ${escapeHtml(result.error)}`,
          "HTML"
        ).catch(() => {});
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
    });
}

// ---------------------------------------------------------------------------
// setupBot — registers middleware and command handlers
// ---------------------------------------------------------------------------

export function setupBot(
  bot: Telegraf,
  claudeAgent: ClaudeAgent,
  sessionManager: SessionManager
): void {
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
        "/status \u{2014} View current session info\n" +
        "/cancel \u{2014} Cancel a running task\n" +
        "/sessions \u{2014} List past sessions\n\n" +
        "You can also send plain text directly.",
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
      await ctx.reply("\u{23f3} A task is already running. /cancel to abort.");
      return;
    }

    logConsole(`\n\x1b[1m[Telegram] /ask ${prompt}\x1b[0m`);
    sessionManager.clearCurrent();
    await ctx.reply("\u{1f504} Starting\u{2026}");
    runTask(bot, ctx.chat.id, claudeAgent, prompt);
  });

  // ---- /chat ----
  bot.command("chat", async (ctx) => {
    const message = ctx.message.text.replace(/^\/chat\s*/, "").trim();
    if (!message) {
      await ctx.reply("Usage: /chat &lt;message&gt;", { parse_mode: "HTML" });
      return;
    }
    if (claudeAgent.running) {
      await ctx.reply("\u{23f3} A task is already running. /cancel to abort.");
      return;
    }
    const current = sessionManager.getCurrent();
    if (!current) {
      await ctx.reply("No active session. Use /ask to start one.");
      return;
    }

    logConsole(`\n\x1b[1m[Telegram] /chat ${message}\x1b[0m`);
    await ctx.reply("\u{1f504} Continuing\u{2026}");
    runTask(bot, ctx.chat.id, claudeAgent, message, current.id);
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
      await ctx.reply("\u{1f6d1} Cancelling\u{2026}");
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
    await ctx.reply(text, { parse_mode: "HTML" });
  });

  // ---- Plain text → smart routing ----
  bot.on("text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) return;
    if (claudeAgent.running) {
      await ctx.reply("\u{23f3} A task is already running. /cancel to abort.");
      return;
    }

    logConsole(`\n\x1b[1m[Telegram] ${text}\x1b[0m`);
    const current = sessionManager.getCurrent();
    await ctx.reply(current ? "\u{1f504} Continuing\u{2026}" : "\u{1f504} Processing\u{2026}");
    runTask(bot, ctx.chat.id, claudeAgent, text, current?.id);
  });
}
