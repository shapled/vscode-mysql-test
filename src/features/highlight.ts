import * as vscode from "vscode";
import {
  findVariableOccurrencesInLines,
  getVariableAtPosition,
} from "./variable-logic";

export class MtrDocumentHighlightProvider
  implements vscode.DocumentHighlightProvider {
  provideDocumentHighlights(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.DocumentHighlight[] {
    const line = document.lineAt(position.line).text;
    const varName = getVariableAtPosition(
      line,
      position.character
    );
    if (!varName) {
      return [];
    }

    const lines: string[] = [];
    for (let i = 0; i < document.lineCount; i++) {
      lines.push(document.lineAt(i).text);
    }

    const occurrences = findVariableOccurrencesInLines(lines, varName);
    return occurrences.map((occ) => {
      const range = new vscode.Range(
        new vscode.Position(occ.lineIndex, occ.startCol),
        new vscode.Position(occ.lineIndex, occ.endCol)
      );
      const isDeclaration = /^\s*(--\s*)?let\s+/.test(
        lines[occ.lineIndex]
      );
      const kind = isDeclaration
        ? vscode.DocumentHighlightKind.Write
        : vscode.DocumentHighlightKind.Read;
      return new vscode.DocumentHighlight(range, kind);
    });
  }
}
