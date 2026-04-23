// @ts-ignore -- JSON import handled by esbuild/bundler
import mtrCommandsData from "../data/mtr-commands.json";

const mtrCommands: MtrCommand[] = mtrCommandsData;

const DOC_BASE_URL =
  "https://dev.mysql.com/doc/dev/mysql-server/8.4.8";

export interface MtrCommand {
  name: string;
  syntax: string;
  description: string;
  demos: string[];
  doc_page: string;
}

export const commandMap = new Map<string, MtrCommand>();
for (const cmd of mtrCommands) {
  commandMap.set(cmd.name, cmd as MtrCommand);
}

/**
 * Find an MTR command name at the start of a line.
 * Returns the lowercase command name, or undefined.
 */
export function findCommandInLine(line: string): string | undefined {
  // Try -- prefix: "-- command_name"
  const dashMatch = line.match(/^\s*--\s*([a-zA-Z_][a-zA-Z0-9_]*)/);
  if (dashMatch) {
    const name = dashMatch[1].toLowerCase();
    if (commandMap.has(name)) {
      return name;
    }
  }

  // Try no prefix: "command_name" at line start
  const noPrefixMatch = line.match(
    /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\b/
  );
  if (noPrefixMatch) {
    const name = noPrefixMatch[1].toLowerCase();
    if (commandMap.has(name)) {
      return name;
    }
  }

  return undefined;
}

/**
 * Build a Markdown string for an MTR command hover.
 */
export function buildHoverMarkdown(cmd: MtrCommand): string {
  const lines: string[] = [];
  lines.push(`**${cmd.name}**\n`);
  if (cmd.syntax) {
    lines.push(`\`${cmd.syntax}\`\n`);
  }
  if (cmd.description) {
    lines.push(`${cmd.description}\n`);
  }
  if (cmd.demos.length > 0) {
    lines.push("---");
    lines.push("**Example:**\n");
    lines.push("```");
    lines.push(cmd.demos[0]);
    lines.push("```");
  }
  const docUrl = `${DOC_BASE_URL}/${cmd.doc_page}.html`;
  lines.push(`\n[View documentation](${docUrl})`);

  return lines.join("\n");
}
