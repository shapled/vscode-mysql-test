import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { resolveIncPathString, findMysqlTestRoot } from "../utils/path-utils";

const PATH_COMMANDS = [
  "source",
  "write_file",
  "append_file",
  "copy_file",
  "copy_files_wildcard",
  "move_file",
  "remove_file",
  "remove_files_wildcard",
  "cat_file",
  "mkdir",
  "rmdir",
  "chmod",
  "file_exists",
  "diff_files",
  "list_files",
  "list_files_append_file",
  "list_files_write_file",
];

const COMMAND_RE = new RegExp(
  `^\\s*(?:--\\s*)?(${PATH_COMMANDS.join("|")})\\b\\s*(.+)`,
  "i"
);

export class MtrDocumentLinkProvider
  implements vscode.DocumentLinkProvider {
  provideDocumentLinks(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.DocumentLink[] {
    const links: vscode.DocumentLink[] = [];

    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i).text;
      const match = line.match(COMMAND_RE);
      if (!match) {
        continue;
      }

      const argsPart = match[2].replace(/;\s*$/, "").trim();
      if (!argsPart) {
        continue;
      }

      // Build the full argument span (after command name)
      const fullArgsStart = line.indexOf(argsPart);
      if (fullArgsStart < 0) {
        continue;
      }

      const argRange = new vscode.Range(
        i,
        fullArgsStart,
        i,
        fullArgsStart + argsPart.length
      );

      // Try to resolve as .inc path (for source command)
      const resolved = resolveIncPathString(
        document.uri.fsPath,
        argsPart
      );

      if (resolved && fs.existsSync(resolved)) {
        const uri = vscode.Uri.file(resolved);
        links.push(new vscode.DocumentLink(argRange, uri));
        continue;
      }

      // For other file commands, try resolving relative to current file dir
      const root = findMysqlTestRoot(document.uri.fsPath);
      let filePath = argsPart;

      // Handle paths that start with $variable - skip variable prefix
      const varPrefixMatch = filePath.match(
        /^(\$\w+\s*)(.+)/
      );
      if (varPrefixMatch) {
        filePath = varPrefixMatch[2];
        // Adjust range to exclude the variable prefix
        const varLen = varPrefixMatch[1].length;
        const adjustedRange = new vscode.Range(
          i,
          fullArgsStart + varLen,
          i,
          fullArgsStart + argsPart.length
        );
        const resolvedPath = root
          ? path.join(root, filePath)
          : path.resolve(
              path.dirname(document.uri.fsPath),
              filePath
            );
        if (fs.existsSync(resolvedPath)) {
          links.push(
            new vscode.DocumentLink(
              adjustedRange,
              vscode.Uri.file(resolvedPath)
            )
          );
        }
        continue;
      }

      // Try resolving as relative path
      const basePath = root
        ? path.join(root, filePath)
        : path.resolve(
            path.dirname(document.uri.fsPath),
            filePath
          );
      if (fs.existsSync(basePath)) {
        links.push(
          new vscode.DocumentLink(
            argRange,
            vscode.Uri.file(basePath)
          )
        );
      }
    }

    return links;
  }
}
