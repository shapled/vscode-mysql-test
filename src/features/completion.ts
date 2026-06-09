import * as vscode from "vscode";
import {
  getCompletions,
  CompletionEntry,
} from "./completion-logic";

export class MtrCompletionProvider
  implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    _context: vscode.CompletionContext
  ): vscode.ProviderResult<vscode.CompletionItem[]> {
    const line = document.lineAt(position.line).text;
    const entries: CompletionEntry[] = getCompletions(
      document.uri.fsPath,
      line,
      position.character
    );

    if (entries.length === 0) {
      return undefined;
    }

    return entries.map((e) => {
      const item = new vscode.CompletionItem(
        e.label,
        e.isDirectory
          ? vscode.CompletionItemKind.Folder
          : vscode.CompletionItemKind.File
      );
      item.insertText = e.insertText;
      item.detail = e.detail;
      return item;
    });
  }
}
