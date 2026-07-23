import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { resolveIncPathString, findMysqlTestRoot } from "../utils/path-utils";
import { astCache } from "../ast/ast-cache";
import {
  findFilePaths,
} from "../ast/ast-query";

/**
 * Document link provider for file paths in MTR commands.
 *
 * Backed by the AST: walks all File I/O commands (source, write_file,
 * cat_file, mkdir, copy_file, ...) and emits clickable links for any
 * path that resolves to an existing file or directory.
 */
export class MtrDocumentLinkProvider
  implements vscode.DocumentLinkProvider {
  async provideDocumentLinks(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): Promise<vscode.DocumentLink[]> {
    const statements = await astCache.get(document);
    const refs = findFilePaths(statements, document.getText());

    const links: vscode.DocumentLink[] = [];

    for (const ref of refs) {
      // Resolve the path. Paths with $variables: try to resolve the literal
      // portion; if not resolvable, fall back to the document directory.
      const resolved = this.resolvePath(document.uri.fsPath, ref.path);

      if (resolved && fs.existsSync(resolved)) {
        const startPos = document.positionAt(ref.offset);
        const endPos = document.positionAt(ref.offset + ref.length);
        links.push(
          new vscode.DocumentLink(
            new vscode.Range(startPos, endPos),
            vscode.Uri.file(resolved)
          )
        );
      }
    }

    return links;
  }

  private resolvePath(currentFile: string, rawPath: string): string | undefined {
    // Paths with $variable prefix: we can't fully resolve without a runtime
    // environment, so skip variable-prefixed paths for link resolution.
    if (rawPath.includes("$")) {
      // Try the tail after the variable; common case: $MYSQL_TMP_DIR/file
      const root = findMysqlTestRoot(currentFile);
      const tail = rawPath.replace(/^\$\w+\/?/, "");
      if (tail && root) {
        return path.join(root, tail);
      }
      return undefined;
    }

    const normalized = rawPath.replace(/\\/g, "/");
    if (normalized.startsWith("./") || normalized.startsWith("../")) {
      return path.resolve(path.dirname(currentFile), normalized);
    }
    if (path.isAbsolute(normalized)) {
      return normalized;
    }

    // mysql-test root-relative
    const root = findMysqlTestRoot(currentFile);
    return root ? path.join(root, normalized) : undefined;
  }
}
