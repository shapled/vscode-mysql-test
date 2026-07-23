import * as vscode from "vscode";
import type { Statement } from "@shapled/mtparser";
import { astCache } from "../ast/ast-cache";
import {
  extractTokens,
  T,
  M,
} from "./token-extractor";

/**
 * Semantic tokens provider backed by the mtparser AST.
 *
 * Uses standard VS Code token types so the active color theme controls
 * the actual colours — no hard-coded hex values.
 *
 * Coverage (same as token-extractor):
 *   - command keywords (source/let/echo/...) → macro
 *   - $variable references → variable (declaration: bold modifier)
 *   - literal text / backtick SQL → string
 *   - `#` comments → comment
 *   - `--` / `;` / `{}` / end markers → operator
 */

const TOKEN_TYPES = [
  "function",  // 0: mysqltest command keyword (source/let/echo/...)
  "variable",  // 1: $variable reference
  "string",    // 2: literal text, backtick SQL
  "comment",   // 3: # comment
  "operator",  // 4: --, ;, {}, end markers
] as const;

const TOKEN_MODIFIERS = [
  "declaration", // 0: variable declaration (LHS of --let)
] as const;

export const legend = new vscode.SemanticTokensLegend(
  [...TOKEN_TYPES],
  [...TOKEN_MODIFIERS]
);

export class MtrSemanticTokensProvider
  implements vscode.DocumentSemanticTokensProvider {
  async provideDocumentSemanticTokens(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): Promise<vscode.SemanticTokens | undefined> {
    let statements: Statement[];
    try {
      statements = await astCache.get(document);
    } catch (err) {
      console.error("[mtr/semantic-tokens] AST parse failed:", err);
      return undefined;
    }

    const source = document.getText();
    const tokens = extractTokens(statements, source);
    tokens.sort((a, b) => a.offset - b.offset);

    const builder = new vscode.SemanticTokensBuilder(legend);
    for (const t of tokens) {
      if (t.length <= 0) continue;
      const startPos = document.positionAt(t.offset);
      const endPos = document.positionAt(t.offset + t.length);
      if (startPos.line === endPos.line) {
        // Single-line token
        builder.push(startPos.line, startPos.character, t.length, t.type, t.modifiers);
      } else {
        // Multi-line token: split into one push per line (VS Code semantic
        // tokens don't span lines — each push is within a single line).
        for (let line = startPos.line; line <= endPos.line; line++) {
          const lineStart = line === startPos.line ? startPos.character : 0;
          const lineEnd = line === endPos.line ? endPos.character : document.lineAt(line).text.length;
          const len = lineEnd - lineStart;
          if (len > 0) {
            builder.push(line, lineStart, len, t.type, t.modifiers);
          }
        }
      }
    }
    return builder.build();
  }
}
