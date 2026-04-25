import * as vscode from "vscode";
import {
  findVariableReferencesRecursive,
  getVariableAtPosition,
} from "./variable-logic";

export class MtrReferenceProvider
  implements vscode.ReferenceProvider {
  provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.ReferenceContext,
    _token: vscode.CancellationToken
  ): vscode.Location[] {
    const line = document.lineAt(position.line).text;
    const varName = getVariableAtPosition(
      line,
      position.character
    );
    if (!varName) {
      return [];
    }

    const refs = findVariableReferencesRecursive(
      document.uri.fsPath,
      varName
    );

    return refs.map((ref) => {
      return new vscode.Location(
        vscode.Uri.file(ref.filePath),
        new vscode.Range(
          new vscode.Position(ref.lineIndex, ref.startCol),
          new vscode.Position(ref.lineIndex, ref.endCol)
        )
      );
    });
  }
}
