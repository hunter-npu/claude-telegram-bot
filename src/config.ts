import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Capture the bot's own directory at module load time (before any chdir)
const BOT_DIR = process.cwd();

// ---------------------------------------------------------------------------
// Environment config
// ---------------------------------------------------------------------------

export const config = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  allowedUserId: Number(process.env.ALLOWED_USER_ID) || 0,
  workingDirectory:
    process.env.WORKING_DIRECTORY || process.env.CCT_WORK_DIR || process.cwd(),
  /** HTTPS proxy URL for Telegram API access (e.g. http://127.0.0.1:7890) */
  httpsProxy:
    process.env.HTTPS_PROXY || process.env.https_proxy || "",
};

export function validateConfig(): void {
  const missing: string[] = [];
  if (!config.telegramBotToken) missing.push("TELEGRAM_BOT_TOKEN");
  // ANTHROPIC_API_KEY is optional — Claude Max subscribers authenticate via CLI login
  if (!config.allowedUserId) missing.push("ALLOWED_USER_ID");
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}\nCopy .env.example to .env and fill in the values.`
    );
  }
}

// ---------------------------------------------------------------------------
// Extended config from cct.config.json (optional)
// ---------------------------------------------------------------------------

export interface PluginConfig {
  type: "local";
  path: string;
}

export interface McpStdioServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpHttpServer {
  type: "sse" | "http";
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = McpStdioServer | McpHttpServer;

export interface AgentConfig {
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: "sonnet" | "opus" | "haiku" | "inherit";
}

export interface CctExtendedConfig {
  /** Which Claude Code settings to load: "user", "project", "local" */
  settingSources: string[];
  /** Additional plugins to load */
  plugins: PluginConfig[];
  /** Additional MCP servers */
  mcpServers: Record<string, McpServerConfig>;
  /** Custom agent definitions for /team command */
  agents: Record<string, AgentConfig>;
}

// ---------------------------------------------------------------------------
// Default agent team for /team command (shared between bot.ts and index.ts)
// ---------------------------------------------------------------------------

export const DEFAULT_TEAM_AGENTS: Record<string, AgentConfig> = {
  researcher: {
    description: "Research agent for searching code, reading files, and gathering information",
    prompt: "You are a research assistant. Search the codebase, read files, and gather information to answer questions. Do not modify any files.",
    tools: ["Read", "Grep", "Glob", "Bash", "WebSearch", "WebFetch"],
    model: "sonnet",
  },
  coder: {
    description: "Coding agent for writing and editing code",
    prompt: "You are a coding assistant. Write, edit, and create code files as needed to complete tasks.",
    model: "sonnet",
  },
};

export function loadExtendedConfig(): CctExtendedConfig {
  const defaults: CctExtendedConfig = {
    settingSources: ["user", "project", "local"],
    plugins: [],
    mcpServers: {},
    agents: {},
  };

  const configPath = resolve(BOT_DIR, "cct.config.json");
  try {
    const content = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(content) as Partial<CctExtendedConfig>;
    return {
      settingSources: parsed.settingSources ?? defaults.settingSources,
      plugins: parsed.plugins ?? defaults.plugins,
      mcpServers: parsed.mcpServers ?? defaults.mcpServers,
      agents: parsed.agents ?? defaults.agents,
    };
  } catch {
    // No config file or invalid JSON — use defaults
    return defaults;
  }
}
