import * as vscode from "vscode";
import { astCache } from "../ast/ast-cache";
import { findVariableOccurrences } from "../ast/ast-query";

export class MtrDocumentHighlightProvider
  implements vscode.DocumentHighlightProvider {
  async provideDocumentHighlights(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): Promise<vscode.DocumentHighlight[]> {
    const line = document.lineAt(position.line).text;
    const varName = variableAtPosition(line, position.character);
    if (!varName) return [];

    const statements = await astCache.get(document);
    const sourceText = document.getText();
    const occurrences = findVariableOccurrences(
      statements,
      varName,
      sourceText
    );

    return occurrences.map((occ) => {
      const start = document.positionAt(occ.offset);
      const end = document.positionAt(occ.offset + occ.length);
      const kind = occ.isDeclaration
        ? vscode.DocumentHighlightKind.Write
        : vscode.DocumentHighlightKind.Read;
      return new vscode.DocumentHighlight(
        new vscode.Range(start, end),
        kind
      );
    });
  }
}

/** Return the variable name under the cursor (without $), if any. */
function variableAtPosition(
  line: string,
  column: number
): string | undefined {
  const re = /\$([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (column >= start && column <= end) {
      return m[1];
    }
  }
  return undefined;
}
