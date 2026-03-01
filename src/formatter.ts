const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]/g;

/** Remove ANSI escape codes from text */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "");
}

/** Split long text into chunks respecting Telegram's 4096 char limit */
export function splitMessage(text: string, maxLen = 4000): string[] {
  if (text.length <= maxLen) return [text];

  const parts: string[] = [];
  let rest = text;

  while (rest.length > 0) {
    if (rest.length <= maxLen) {
      parts.push(rest);
      break;
    }
    // Try to split at a newline boundary
    let idx = rest.lastIndexOf("\n", maxLen);
    if (idx < maxLen * 0.3) idx = maxLen;
    parts.push(rest.slice(0, idx));
    rest = rest.slice(idx).replace(/^\n/, "");
  }

  return parts;
}

/** Escape HTML special characters for Telegram HTML parse mode */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Format a tool call as a human-readable HTML line */
export function formatToolCall(
  name: string,
  input: Record<string, unknown>
): string {
  const icons: Record<string, string> = {
    Read: "\u{1f4d6}",
    Write: "\u{1f4dd}",
    Edit: "\u{270f}\u{fe0f}",
    Bash: "\u{1f4bb}",
    Glob: "\u{1f50d}",
    Grep: "\u{1f50e}",
    WebSearch: "\u{1f310}",
    WebFetch: "\u{1f310}",
    Agent: "\u{1f916}",
    NotebookEdit: "\u{1f4d3}",
  };
  const icon = icons[name] || "\u{1f527}";

  let detail = "";
  if (name === "Bash" && input.command) {
    detail = `: ${String(input.command).slice(0, 80)}`;
  } else if (["Read", "Write", "Edit"].includes(name) && input.file_path) {
    detail = `: ${input.file_path}`;
  } else if (name === "Glob" && input.pattern) {
    detail = `: ${input.pattern}`;
  } else if (name === "Grep" && input.pattern) {
    detail = `: ${input.pattern}`;
  } else if (name === "WebSearch" && input.query) {
    detail = `: ${input.query}`;
  }

  return `${icon} <b>${escapeHtml(name)}</b>${escapeHtml(detail)}`;
}

/** Format a query result as an HTML summary */
export function formatResult(result: {
  subtype: string;
  result?: string;
  total_cost_usd?: number;
  num_turns?: number;
  duration_ms?: number;
}): string {
  const lines: string[] = [];

  if (result.subtype === "success") {
    lines.push("\u{2705} <b>Task completed</b>");
    if (result.result) {
      const text = stripAnsi(result.result);
      if (text.trim()) {
        lines.push("");
        lines.push(escapeHtml(text));
      }
    }
  } else {
    lines.push(
      `\u{274c} <b>Task ended:</b> ${escapeHtml(result.subtype)}`
    );
  }

  const stats: string[] = [];
  if (result.num_turns) stats.push(`${result.num_turns} turns`);
  if (result.duration_ms)
    stats.push(`${(result.duration_ms / 1000).toFixed(1)}s`);
  // cost is informational only (not billed for Max subscribers)
  if (stats.length > 0) {
    lines.push("");
    lines.push(`\u{1f4ca} ${stats.join(" \u{00b7} ")}`);
  }

  return lines.join("\n");
}
