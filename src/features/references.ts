import * as vscode from "vscode";
import * as fs from "fs";
import type { Statement$ as Statement } from "@shapled/mtparser/ast";
import { astCache } from "../ast/ast-cache";
import { parseMt } from "../ast/parse";
import { interpolatedToRaw } from "../ast/helpers";
import {
  findVariableOccurrences,
  findSourceCommands,
} from "../ast/ast-query";
import { resolveIncPathString } from "../utils/path-utils";

const MAX_INCLUDE_DEPTH = 16;

interface FileVariableLocation {
  filePath: string;
  offset: number;
  length: number;
  isDeclaration: boolean;
}

export class MtrReferenceProvider implements vscode.ReferenceProvider {
  async provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.ReferenceContext,
    _token: vscode.CancellationToken
  ): Promise<vscode.Location[]> {
    const line = document.lineAt(position.line).text;
    const varName = variableAtPosition(line, position.character);
    if (!varName) return [];

    const refs = findReferencesRecursive(
      document.uri.fsPath,
      varName,
      new Set()
    );

    return refs.map((ref) => {
      const uri = vscode.Uri.file(ref.filePath);
      const content = readText(ref.filePath) ?? "";
      const pos = offsetToPosition(content, ref.offset, ref.length);
      return new vscode.Location(uri, pos);
    });
  }
}

/** Find references recursively, following Source/Include directives. */
function findReferencesRecursive(
  filePath: string,
  varName: string,
  visited: Set<string>,
  depth = 0
): FileVariableLocation[] {
  if (depth > MAX_INCLUDE_DEPTH) return [];
  if (visited.has(filePath)) return [];
  visited.add(filePath);

  const content = readText(filePath);
  if (content === undefined) return [];

  let statements: Statement[];
  try {
    statements = parseMt(content);
  } catch {
    // The parser is fail-fast; a syntax error in one file of the include
    // graph shouldn't kill reference lookup for the rest.
    return [];
  }

  const results: FileVariableLocation[] = [];

  // References in this file
  const occurrences = findVariableOccurrences(statements, varName, content);
  for (const occ of occurrences) {
    results.push({
      filePath,
      offset: occ.offset,
      length: occ.length,
      isDeclaration: occ.isDeclaration,
    });
  }

  // Recurse into sourced files
  const sources = findSourceCommands(statements);
  for (const src of sources) {
    const rawPath = interpolatedToRaw(src.file);
    // Skip $variable-prefixed paths (can't resolve statically)
    if (rawPath.includes("$")) continue;
    const resolved = resolveIncPathString(filePath, rawPath);
    if (!resolved || !fs.existsSync(resolved)) continue;
    results.push(
      ...findReferencesRecursive(resolved, varName, visited, depth + 1)
    );
  }

  return results;
}

function readText(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }
}

/** Convert byte offset to a VS Code Range by counting newlines. */
function offsetToPosition(
  content: string,
  offset: number,
  length: number
): vscode.Range {
  let line = 0;
  let lastNL = -1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content.charCodeAt(i) === 10) {
      line++;
      lastNL = i;
    }
  }
  const character = offset - lastNL - 1;
  const endChar = character + length;
  return new vscode.Range(line, character, line, endChar);
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
