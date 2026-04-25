import * as vscode from "vscode";
import {
  findCommandInLine,
  buildHoverMarkdown,
  commandMap,
  findFunctionByWord,
  buildFunctionHoverMarkdown,
  functionMap,
  type MtrCommand,
  type MtrFunction,
} from "./hover-logic";

export type { MtrCommand, MtrFunction };
export {
  findCommandInLine,
  buildHoverMarkdown,
  commandMap,
  findFunctionByWord,
  buildFunctionHoverMarkdown,
  functionMap,
};

export class MtrHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    const line = document.lineAt(position.line).text;
    const cmdName = findCommandInLine(line);

    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) {
      return undefined;
    }

    const word = document.getText(wordRange);

    // Try MTR command (line-starting)
    if (cmdName && word.toLowerCase().endsWith(cmdName)) {
      const cmd = commandMap.get(cmdName)!;
      const md = new vscode.MarkdownString(buildHoverMarkdown(cmd));
      md.isTrusted = true;
      return new vscode.Hover(md, wordRange);
    }

    // Try MTR function (any position in line)
    const fn = findFunctionByWord(word);
    if (fn) {
      const md = new vscode.MarkdownString(buildFunctionHoverMarkdown(fn));
      md.isTrusted = true;
      return new vscode.Hover(md, wordRange);
    }

    return undefined;
  }
}
