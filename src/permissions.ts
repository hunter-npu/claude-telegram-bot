import type { Telegraf } from "telegraf";
import { escapeHtml } from "./formatter.js";
import { logConsole } from "./console.js";

// ---------------------------------------------------------------------------
// Types (mirrors the Agent SDK's canUseTool contract)
// ---------------------------------------------------------------------------

type PermissionAllow = {
  behavior: "allow";
  updatedInput?: Record<string, unknown>;
};

type PermissionDeny = {
  behavior: "deny";
  message: string;
};

export type PermissionResult = PermissionAllow | PermissionDeny;

// ---------------------------------------------------------------------------
// Read-only / non-destructive tools that are always auto-approved
// ---------------------------------------------------------------------------

const AUTO_ALLOW = new Set([
  "Read",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
  "Agent",
  "EnterPlanMode",
  "ExitPlanMode",
  "TaskCreate",
  "TaskGet",
  "TaskUpdate",
  "TaskList",
  "TaskOutput",
  "Skill",
  "EnterWorktree",
  "TeamCreate",
  "TeamDelete",
  "SendMessage",
]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface QuestionDef {
  question: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}

interface PendingRequest {
  resolve: (result: PermissionResult) => void;
  type: "permission" | "question";
  context?: {
    input: Record<string, unknown>;
    questions: QuestionDef[];
    answers: Record<string, string>;
  };
}

// ---------------------------------------------------------------------------
// PermissionHandler
// ---------------------------------------------------------------------------

export class PermissionHandler {
  private pending = new Map<string, PendingRequest>();
  private bot: Telegraf;
  private chatId: number;
  /** The most recent pending request ID (for console input routing) */
  private latestPendingId: string | null = null;

  /** Send a Telegram message with retry for transient network errors */
  private async sendTg(
    text: string,
    extra?: Record<string, unknown>
  ): Promise<void> {
    for (let i = 1; i <= 3; i++) {
      try {
        await this.bot.telegram.sendMessage(this.chatId, text, extra as never);
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

  constructor(bot: Telegraf, chatId: number) {
    this.bot = bot;
    this.chatId = chatId;
    this.registerHandlers();
  }

  /** Whether there is a pending permission/question awaiting response */
  get hasPending(): boolean {
    return this.latestPendingId !== null;
  }

  // ---- Console input: resolve the latest pending request ------------------

  resolveFromConsole(input: string): boolean {
    if (!this.latestPendingId) return false;

    const id = this.latestPendingId;
    const req = this.pending.get(id);
    if (!req) {
      this.latestPendingId = null;
      return false;
    }

    if (req.type === "permission") {
      const allow = /^y(es)?$/i.test(input.trim());
      const deny = /^n(o)?$/i.test(input.trim());
      if (!allow && !deny) {
        logConsole("  Type y(es) or n(o):");
        return true; // consumed input, but keep waiting
      }
      this.pending.delete(id);
      this.latestPendingId = null;
      if (allow) {
        logConsole("\x1b[32m  \u{2705} Allowed\x1b[0m");
        req.resolve({ behavior: "allow" });
      } else {
        logConsole("\x1b[31m  \u{274c} Denied\x1b[0m");
        req.resolve({ behavior: "deny", message: "User denied from console" });
      }
      return true;
    }

    if (req.type === "question" && req.context) {
      const idx = parseInt(input.trim(), 10) - 1;
      const question = req.context.questions[0];
      if (!question || idx < 0 || idx >= question.options.length) {
        logConsole(
          `  Enter a number 1-${question?.options.length ?? "?"}:`
        );
        return true;
      }
      const selected = question.options[idx];
      this.pending.delete(id);
      this.latestPendingId = null;
      req.context.answers[question.question] = selected.label;
      logConsole(`  \u{2714} Selected: ${selected.label}`);
      req.resolve({
        behavior: "allow",
        updatedInput: { ...req.context.input, answers: req.context.answers },
      });
      return true;
    }

    return false;
  }

  // ---- Callback-query handlers (inline keyboard responses) ----------------

  private registerHandlers(): void {
    // Permission allow / deny  —  callback_data = "p:<id>:a" or "p:<id>:d"
    this.bot.action(/^p:([^:]+):([ad])$/, async (ctx) => {
      const id = ctx.match![1];
      const action = ctx.match![2];
      const req = this.pending.get(id);

      if (!req) {
        await ctx.answerCbQuery("Request expired");
        return;
      }

      this.pending.delete(id);
      if (this.latestPendingId === id) this.latestPendingId = null;

      if (action === "a") {
        req.resolve({ behavior: "allow" });
        logConsole("\x1b[32m  \u{2705} Allowed (via Telegram)\x1b[0m");
        await ctx.answerCbQuery("\u{2705} Allowed");
      } else {
        req.resolve({
          behavior: "deny",
          message: "User denied the operation",
        });
        logConsole("\x1b[31m  \u{274c} Denied (via Telegram)\x1b[0m");
        await ctx.answerCbQuery("\u{274c} Denied");
      }

      try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      } catch {
        /* already edited or message too old */
      }
    });

    // AskUserQuestion answer  —  callback_data = "q:<id>:<optionIndex>"
    this.bot.action(/^q:([^:]+):(\d+)$/, async (ctx) => {
      const id = ctx.match![1];
      const optIdx = parseInt(ctx.match![2], 10);
      const req = this.pending.get(id);

      if (!req?.context) {
        await ctx.answerCbQuery("Request expired");
        return;
      }

      this.pending.delete(id);
      if (this.latestPendingId === id) this.latestPendingId = null;

      const question = req.context.questions[0];
      const selectedOption = question?.options[optIdx];

      if (question && selectedOption) {
        req.context.answers[question.question] = selectedOption.label;
      }

      req.resolve({
        behavior: "allow",
        updatedInput: {
          ...req.context.input,
          answers: req.context.answers,
        },
      });

      logConsole(
        `  \u{2714} Selected: ${selectedOption?.label ?? "Unknown"} (via Telegram)`
      );
      await ctx.answerCbQuery(
        `Selected: ${selectedOption?.label ?? "Unknown"}`
      );
      try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      } catch {
        /* ignore */
      }
    });
  }

  // ---- Main entry: the canUseTool callback --------------------------------

  canUseTool = async (
    toolName: string,
    input: Record<string, unknown>,
    options: { signal: AbortSignal; toolUseID: string }
  ): Promise<PermissionResult> => {
    // Auto-allow read-only / non-destructive tools
    if (AUTO_ALLOW.has(toolName)) {
      return { behavior: "allow" };
    }

    // AskUserQuestion → render as Telegram inline keyboard + console
    if (toolName === "AskUserQuestion") {
      return this.handleAskUserQuestion(input, options.toolUseID);
    }

    // Everything else (Edit, Write, Bash, NotebookEdit, …) needs approval
    return this.requestPermission(toolName, input, options.toolUseID);
  };

  // ---- Permission confirmation for write tools ----------------------------

  private async requestPermission(
    toolName: string,
    input: Record<string, unknown>,
    toolUseID: string
  ): Promise<PermissionResult> {
    const id = this.shortId(toolUseID);

    // ---- Console output ----
    logConsole(`\n\x1b[33m\u{1f510} Permission: ${toolName}\x1b[0m`);
    if (toolName === "Bash" && input.command) {
      logConsole(`  Command: ${String(input.command).slice(0, 200)}`);
    } else if (input.file_path) {
      logConsole(`  File: ${input.file_path}`);
    }
    logConsole("  \x1b[33mAllow? (y/n):\x1b[0m");

    // ---- Telegram output ----
    let text = `\u{1f510} <b>Permission Request</b>\n\n`;
    text += `<b>Tool:</b> ${escapeHtml(toolName)}\n`;

    if (toolName === "Bash" && input.command) {
      text += `<b>Command:</b>\n<pre>${escapeHtml(
        String(input.command).slice(0, 500)
      )}</pre>`;
    } else if (toolName === "Edit" && input.file_path) {
      text += `<b>File:</b> <code>${escapeHtml(
        String(input.file_path)
      )}</code>\n`;
      if (input.old_string != null) {
        text += `<b>Replace:</b>\n<pre>${escapeHtml(
          String(input.old_string).slice(0, 200)
        )}</pre>\n`;
        text += `<b>With:</b>\n<pre>${escapeHtml(
          String(input.new_string ?? "").slice(0, 200)
        )}</pre>`;
      }
    } else if (toolName === "Write" && input.file_path) {
      text += `<b>File:</b> <code>${escapeHtml(
        String(input.file_path)
      )}</code>\n`;
      if (input.content) {
        text += `<b>Content length:</b> ${String(input.content).length} chars`;
      }
    } else if (toolName === "NotebookEdit" && input.notebook_path) {
      text += `<b>Notebook:</b> <code>${escapeHtml(
        String(input.notebook_path)
      )}</code>`;
    } else {
      const json = JSON.stringify(input, null, 2).slice(0, 500);
      text += `<pre>${escapeHtml(json)}</pre>`;
    }

    await this.sendTg(text, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "\u{2705} Allow", callback_data: `p:${id}:a` },
            { text: "\u{274c} Deny", callback_data: `p:${id}:d` },
          ],
        ],
      },
    });

    this.latestPendingId = id;
    return new Promise<PermissionResult>((resolve) => {
      this.pending.set(id, { resolve, type: "permission" });
    });
  }

  // ---- AskUserQuestion → inline keyboard + console -----------------------

  private async handleAskUserQuestion(
    input: Record<string, unknown>,
    toolUseID: string
  ): Promise<PermissionResult> {
    const questions = input.questions as QuestionDef[] | undefined;
    if (!questions || questions.length === 0) {
      return { behavior: "allow" };
    }

    const id = this.shortId(toolUseID);
    const question = questions[0];

    // ---- Console output ----
    logConsole(`\n\x1b[36m\u{2753} ${question.question}\x1b[0m`);
    question.options.forEach((opt, i) => {
      const desc = opt.description ? ` \u{2014} ${opt.description}` : "";
      logConsole(`  [${i + 1}] ${opt.label}${desc}`);
    });
    logConsole("  \x1b[36mEnter number:\x1b[0m");

    // ---- Telegram output ----
    let text = `\u{2753} <b>${escapeHtml(question.question)}</b>\n`;
    for (const opt of question.options) {
      if (opt.description) {
        text += `\n\u{2022} <b>${escapeHtml(opt.label)}</b> \u{2014} ${escapeHtml(
          opt.description
        )}`;
      }
    }

    const buttons = question.options.map((opt, i) => [
      { text: opt.label, callback_data: `q:${id}:${i}` },
    ]);

    await this.sendTg(text, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: buttons },
    });

    this.latestPendingId = id;
    return new Promise<PermissionResult>((resolve) => {
      this.pending.set(id, {
        resolve,
        type: "question",
        context: { input, questions, answers: {} },
      });
    });
  }

  // ---- Helpers ------------------------------------------------------------

  private shortId(toolUseID: string): string {
    return toolUseID.replace(/-/g, "").slice(-8);
  }

  /** Cancel all pending requests (used during shutdown) */
  cleanup(): void {
    for (const [, req] of this.pending) {
      req.resolve({ behavior: "deny", message: "Bot shutting down" });
    }
    this.pending.clear();
    this.latestPendingId = null;
  }
}
