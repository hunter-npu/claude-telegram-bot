import * as readline from "node:readline";

/** Convert HTML markup to ANSI-colored terminal text */
export function stripHtml(html: string): string {
  return html
    .replace(/<b>(.*?)<\/b>/g, "\x1b[1m$1\x1b[22m")
    .replace(/<code>(.*?)<\/code>/g, "\x1b[36m$1\x1b[39m")
    .replace(/<pre>([\s\S]*?)<\/pre>/g, "\x1b[2m$1\x1b[22m")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** Log a message to the console, optionally converting HTML */
export function logConsole(text: string, isHtml = false): void {
  console.log(isHtml ? stripHtml(text) : text);
}

/** Create a readline interface for console input */
export function createRL(): readline.Interface {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.setPrompt("> ");
  return rl;
}
