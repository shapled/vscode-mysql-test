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

export interface MtrFunction {
  name: string;
  syntax: string;
  description: string;
}

export const commandMap = new Map<string, MtrCommand>();
for (const cmd of mtrCommands) {
  commandMap.set(cmd.name, cmd as MtrCommand);
}

/**
 * MTR functions used in expressions (e.g., let $var = query_get_value(...)).
 */
export const functionMap = new Map<string, MtrFunction>();
functionMap.set("query_get_value", {
  name: "query_get_value",
  syntax: "query_get_value(query, col_name, row_num)",
  description:
    "Execute a query and return the value of a specified column in a specified row.",
});
functionMap.set("convert_error", {
  name: "convert_error",
  syntax: "convert_error(error)",
  description:
    "Convert between MySQL error code numbers and their symbolic names (e.g., ER_UNKNOWN_ERROR).",
});

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
 * Find an MTR function by word (case-insensitive).
 * Returns the function info, or undefined.
 */
export function findFunctionByWord(
  word: string
): MtrFunction | undefined {
  return functionMap.get(word.toLowerCase());
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

/**
 * Build a Markdown string for an MTR function hover.
 */
export function buildFunctionHoverMarkdown(fn: MtrFunction): string {
  const lines: string[] = [];
  lines.push(`**${fn.name}**\n`);
  lines.push(`\`${fn.syntax}\`\n`);
  if (fn.description) {
    lines.push(`${fn.description}`);
  }
  return lines.join("\n");
}
