import { query } from "@anthropic-ai/claude-agent-sdk";
import type { PermissionHandler } from "./permissions.js";
import type { SessionManager } from "./session.js";
import { config, loadExtendedConfig, type AgentConfig } from "./config.js";
import { logConsole } from "./console.js";
import {
  formatToolCall,
  formatResult,
  stripAnsi,
  splitMessage,
  escapeHtml,
} from "./formatter.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecuteParams {
  prompt: string;
  /** Queue content to console (immediate) + Telegram (batched) */
  sendUpdate: (text: string, parseMode?: "HTML" | "text") => void;
  /** Flush the Telegram buffer immediately */
  flush: () => Promise<void>;
  /** If set, resume an existing session instead of starting a new one */
  resumeSessionId?: string;
  /** If set, pass agent definitions for team mode */
  agents?: Record<string, AgentConfig>;
}

export interface ExecuteResult {
  sessionId: string;
  success: boolean;
  result?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// ClaudeAgent — wraps the Agent SDK's query() function
// ---------------------------------------------------------------------------

export class ClaudeAgent {
  private permissionHandler: PermissionHandler;
  private sessionManager: SessionManager;
  private abortController: AbortController | null = null;
  private _running = false;
  private _modelOverride: string | undefined;

  constructor(
    permissionHandler: PermissionHandler,
    sessionManager: SessionManager
  ) {
    this.permissionHandler = permissionHandler;
    this.sessionManager = sessionManager;
  }

  get running(): boolean {
    return this._running;
  }

  get modelOverride(): string | undefined {
    return this._modelOverride;
  }

  /** Set model override. Accepts "sonnet", "opus", "haiku", or "default" (clears override). */
  setModel(alias: string): void {
    const lower = alias.toLowerCase();
    if (lower === "default") {
      this._modelOverride = undefined;
    } else if (["sonnet", "opus", "haiku"].includes(lower)) {
      this._modelOverride = lower;
    } else {
      throw new Error(`Unknown model alias: "${alias}". Use sonnet, opus, haiku, or default.`);
    }
  }

  async execute(params: ExecuteParams): Promise<ExecuteResult> {
    if (this._running) {
      throw new Error("A task is already running. Cancel it first.");
    }

    this._running = true;
    this.abortController = new AbortController();
    let sessionId = "";

    try {
      const ext = loadExtendedConfig();

      const options: Record<string, unknown> = {
        cwd: config.workingDirectory,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        canUseTool: this.permissionHandler.canUseTool,
        abortController: this.abortController,
        settingSources: ext.settingSources,
      };

      if (ext.plugins.length > 0) {
        options.plugins = ext.plugins;
      }
      if (Object.keys(ext.mcpServers).length > 0) {
        options.mcpServers = ext.mcpServers;
      }
      if (params.resumeSessionId) {
        options.resume = params.resumeSessionId;
      }

      // Merge agents from config + params
      const agents: Record<string, AgentConfig> = {
        ...ext.agents,
        ...params.agents,
      };
      if (Object.keys(agents).length > 0) {
        options.agents = agents;
      }

      if (this._modelOverride) {
        options.model = this._modelOverride;
      }

      const stream = query({
        prompt: params.prompt,
        options: options as never,
      });

      for await (const message of stream) {
        // ---- system init ----
        if (
          message.type === "system" &&
          (message as Record<string, unknown>).subtype === "init"
        ) {
          const msg = message as Record<string, unknown>;
          sessionId = (msg.session_id as string) ?? "";
          this.sessionManager.setCurrent(sessionId, params.prompt);

          const skills = msg.skills as string[] | undefined;
          const plugins = msg.plugins as Array<{ name: string }> | undefined;
          const mcpServers = msg.mcp_servers as
            | Array<{ name: string; status: string }>
            | undefined;

          if (skills && skills.length > 0)
            logConsole(`\x1b[2m  Skills: ${skills.join(", ")}\x1b[0m`);
          if (plugins && plugins.length > 0)
            logConsole(
              `\x1b[2m  Plugins: ${plugins.map((p) => p.name).join(", ")}\x1b[0m`
            );
          if (mcpServers && mcpServers.length > 0)
            logConsole(
              `\x1b[2m  MCP: ${mcpServers.map((s) => `${s.name}(${s.status})`).join(", ")}\x1b[0m`
            );
          continue;
        }

        // ---- assistant message → combine text + tool calls into ONE block --
        if (message.type === "assistant") {
          const content = (
            message as Record<string, unknown> & {
              message?: { content?: unknown[] };
            }
          ).message?.content;

          if (Array.isArray(content)) {
            const sections: string[] = [];

            // Collect text blocks
            const texts: string[] = [];
            const tools: string[] = [];

            for (const block of content) {
              const b = block as Record<string, unknown>;
              if (b.type === "text" && typeof b.text === "string" && b.text) {
                texts.push(b.text);
              } else if (b.type === "tool_use" && typeof b.name === "string") {
                tools.push(
                  formatToolCall(
                    b.name,
                    (b.input as Record<string, unknown>) ?? {}
                  )
                );
              }
            }

            if (texts.length > 0) {
              sections.push(escapeHtml(stripAnsi(texts.join("\n"))));
            }
            if (tools.length > 0) {
              sections.push(tools.join("\n"));
            }

            if (sections.length > 0) {
              const combined = sections.join("\n\n");
              for (const seg of splitMessage(combined)) {
                params.sendUpdate(seg, "HTML");
              }
            }
          }
          continue;
        }

        // ---- result → flush buffer, then send result as a standalone msg --
        if (message.type === "result") {
          // Flush any buffered content first
          await params.flush();

          const r = message as Record<string, unknown>;
          const formatted = formatResult({
            subtype: r.subtype as string,
            result: r.result as string | undefined,
            total_cost_usd: r.total_cost_usd as number | undefined,
            num_turns: r.num_turns as number | undefined,
            duration_ms: r.duration_ms as number | undefined,
          });

          // Send result directly (not batched)
          params.sendUpdate(formatted, "HTML");
          await params.flush();

          return {
            sessionId,
            success: r.subtype === "success",
            result: r.result as string | undefined,
          };
        }
      }

      await params.flush();
      return { sessionId, success: true };
    } catch (err) {
      await params.flush().catch(() => {});
      if (this.abortController?.signal.aborted) {
        return { sessionId, success: false, error: "Cancelled by user" };
      }
      const errMsg = err instanceof Error ? err.message : String(err);

      // Auto-retry: if resuming a stale session failed, start fresh
      if (params.resumeSessionId && errMsg.includes("exited with code")) {
        logConsole("[Auto-retry] Session resume failed, starting fresh\u{2026}");
        this.sessionManager.clearCurrent();
        this._running = false;
        this.abortController = null;
        return this.execute({ ...params, resumeSessionId: undefined });
      }

      return { sessionId, success: false, error: errMsg };
    } finally {
      this._running = false;
      this.abortController = null;
    }
  }

  cancel(): boolean {
    if (this.abortController && this._running) {
      this.abortController.abort();
      return true;
    }
    return false;
  }
}
