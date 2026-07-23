import * as vscode from "vscode";
import {
  getCommandDoc,
  getFunctionDoc,
  getVariableDoc,
  commandDocUrl,
  RichCommandDoc,
  MtrFunction,
} from "./command-docs";

/**
 * Hover provider backed by the unified command-docs data source.
 *
 * Resolves three kinds of hover targets:
 *   1. MTR command keyword at line start → rich docs
 *   2. MTR function (query_get_value, convert_error) anywhere
 *   3. Built-in $variable (e.g. $MYSQL_TMP_DIR)
 */
export class MtrHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) return undefined;

    const word = document.getText(wordRange);

    // 1. Command hover: cursor on the command keyword at line start.
    const line = document.lineAt(position.line).text;
    const cmdName = commandAtLineStart(line);
    if (cmdName && word.toLowerCase() === cmdName) {
      const doc = getCommandDoc(cmdName);
      if (doc) {
        return new vscode.Hover(renderCommandHover(doc), wordRange);
      }
    }

    // 2. Function hover.
    const fn = getFunctionDoc(word);
    if (fn) {
      return new vscode.Hover(renderFunctionHover(fn), wordRange);
    }

    // 3. Built-in variable hover ($name).
    const varRange = document.getWordRangeAtPosition(
      position,
      /\$?[A-Za-z_][A-Za-z0-9_]*/
    );
    if (varRange) {
      const varText = document.getText(varRange);
      const varName = varText.startsWith("$") ? varText.slice(1) : varText;
      const varDoc = getVariableDoc(varName);
      if (varDoc) {
        const md = new vscode.MarkdownString(
          `**\`$${varName}\`**\n\n${varDoc}`
        );
        md.isTrusted = true;
        return new vscode.Hover(md, varRange);
      }
    }

    return undefined;
  }
}

/** Match a command keyword at the start of a line (-- prefix optional). */
function commandAtLineStart(line: string): string | undefined {
  const m = line.match(/^\s*(?:--\s*)?([a-zA-Z_][a-zA-Z0-9_]*)/);
  if (!m) return undefined;
  const name = m[1].toLowerCase();
  return getCommandDoc(name) ? name : undefined;
}

function renderCommandHover(doc: RichCommandDoc): vscode.MarkdownString {
  const lines: string[] = [];
  lines.push(`**${doc.name}**\n`);
  if (doc.syntax) lines.push(`\`${doc.syntax}\`\n`);
  if (doc.description) lines.push(`${doc.description}\n`);
  if (doc.demos && doc.demos.length > 0) {
    lines.push("---");
    lines.push("**Example:**\n");
    lines.push("```");
    lines.push(doc.demos[0]);
    lines.push("```");
  }
  const url = commandDocUrl(doc);
  if (url) lines.push(`\n[View documentation](${url})`);
  const md = new vscode.MarkdownString(lines.join("\n"));
  md.isTrusted = true;
  return md;
}

function renderFunctionHover(fn: MtrFunction): vscode.MarkdownString {
  const lines: string[] = [];
  lines.push(`**${fn.name}**\n`);
  lines.push(`\`${fn.syntax}\`\n`);
  if (fn.description) lines.push(fn.description);
  const md = new vscode.MarkdownString(lines.join("\n"));
  md.isTrusted = true;
  return md;
}
