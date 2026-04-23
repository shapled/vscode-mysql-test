import * as vscode from "vscode";
import {
  findCommandInLine,
  buildHoverMarkdown,
  commandMap,
  type MtrCommand,
} from "./hover-logic";

export type { MtrCommand };
export { findCommandInLine, buildHoverMarkdown, commandMap };

export class MtrHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    const line = document.lineAt(position.line).text;
    const cmdName = findCommandInLine(line);
    if (!cmdName) {
      return undefined;
    }

    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) {
      return undefined;
    }

    const word = document.getText(wordRange);
    // wordPattern includes "-", so "--connect" is one word.
    // Match if word ends with the command name.
    if (!word.toLowerCase().endsWith(cmdName)) {
      return undefined;
    }

    const cmd = commandMap.get(cmdName)!;
    const md = new vscode.MarkdownString(buildHoverMarkdown(cmd));
    md.isTrusted = true;
    return new vscode.Hover(md, wordRange);
  }
}
