import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import {
  pairTestResult,
  pairOptTest,
  pairCnfTest,
  resolveIncPath,
} from "../utils/test-file";
import {
  findVariableDeclarationInLines,
  getVariableAtPosition,
} from "./variable-logic";
import { findMysqlTestRoot } from "../utils/path-utils";

export class MtrDefinitionProvider implements vscode.DefinitionProvider {
  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Definition> {
    const line = document.lineAt(position.line).text;

    // --source / --include: jump to .inc file
    const sourceMatch = line.match(
      /^\s*--\s*(?:source|include)\s+(\S+)/
    );
    if (sourceMatch) {
      const incPath = sourceMatch[1];
      const uri = resolveIncPath(document.uri.fsPath, incPath);
      if (uri) {
        return [
          new vscode.Location(
            uri,
            new vscode.Position(0, 0)
          ),
        ];
      }
    }

    // $variable: try to find --let declaration
    const varName = getVariableAtPosition(
      line,
      position.character
    );
    if (varName) {
      const declLocation = findVariableDeclaration(
        document,
        varName
      );
      if (declLocation) {
        return declLocation;
      }
    }

    return undefined;
  }
}

function findVariableDeclaration(
  document: vscode.TextDocument,
  varName: string
): vscode.Location | undefined {
  const lines: string[] = [];
  for (let i = 0; i < document.lineCount; i++) {
    lines.push(document.lineAt(i).text);
  }
  const decl = findVariableDeclarationInLines(lines, varName);
  if (decl) {
    return new vscode.Location(
      document.uri,
      new vscode.Range(
        new vscode.Position(decl.lineIndex, decl.startCol),
        new vscode.Position(decl.lineIndex, decl.endCol)
      )
    );
  }
  return undefined;
}

/**
 * Get platform-appropriate keybinding label for Alt+O.
 */
function altOKeybinding(): string {
  return process.platform === "darwin" ? "⌥O" : "Alt+O";
}

/**
 * Derive the MTR fully qualified test name from a .test file path.
 * e.g. /repo/mysql-test/suite/innodb/t/alias.test → "innodb.alias"
 *       /repo/mysql-test/t/alias.test               → "main.alias"
 * Returns undefined if the path doesn't match the expected structure.
 */
function deriveTestName(fsPath: string): string | undefined {
  const root = findMysqlTestRoot(fsPath);
  if (!root) return undefined;

  const normalized = fsPath.replace(/\\/g, "/");
  const normalizedRoot = root.replace(/\\/g, "/");
  const relative = normalized.substring(normalizedRoot.length);

  // suite/innodb/t/alias.test → suite=innodb, name=alias
  const suiteMatch = relative.match(/^\/suite\/([^/]+)\/t\/([^/]+)\.test$/);
  if (suiteMatch) {
    return `${suiteMatch[1]}.${suiteMatch[2]}`;
  }

  // t/alias.test → suite=main
  const mainMatch = relative.match(/^\/t\/([^/]+)\.test$/);
  if (mainMatch) {
    return `main.${mainMatch[1]}`;
  }

  return undefined;
}

interface PairedTarget {
  label: string;
  uri: vscode.Uri;
}

/**
 * Get all paired files for the current document, checking existence.
 * .test files can pair to .result, .opt, .cnf (multiple).
 * Other files (.result, .opt, .cnf) can only pair back to .test (one).
 */
function getPairedFiles(
  document: vscode.TextDocument
): PairedTarget[] {
  const uri = document.uri;
  const fsPath = uri.fsPath;
  const targets: PairedTarget[] = [];

  const tryAdd = (
    target: vscode.Uri | undefined,
    label: string
  ) => {
    if (target && fs.existsSync(target.fsPath)) {
      targets.push({ label, uri: target });
    }
  };

  if (fsPath.endsWith(".test")) {
    tryAdd(pairTestResult(uri), "result");
    // Try -master.opt, then plain .opt
    const baseName = path.basename(fsPath, ".test");
    const dir = path.dirname(fsPath);
    const tryOpt = (name: string) =>
      vscode.Uri.file(path.join(dir, `${name}.opt`));
    const tryCnf = (name: string) =>
      vscode.Uri.file(path.join(dir, `${name}.cnf`));
    tryAdd(tryOpt(`${baseName}-master`), "opt (master)");
    tryAdd(tryOpt(`${baseName}-slave`), "opt (slave)");
    tryAdd(tryOpt(baseName), "opt");
    tryAdd(tryCnf(`${baseName}-master`), "cnf (master)");
    tryAdd(tryCnf(`${baseName}-slave`), "cnf (slave)");
    tryAdd(tryCnf(baseName), "cnf");
  } else if (fsPath.endsWith(".result")) {
    tryAdd(pairTestResult(uri), "test");
  } else if (fsPath.endsWith(".opt")) {
    tryAdd(pairOptTest(uri), "test");
  } else if (fsPath.endsWith(".cnf")) {
    tryAdd(pairCnfTest(uri), "test");
  }

  return targets;
}

/**
 * Command that opens a specific paired file URI.
 */
function registerOpenPairedFileCommand(
  context: vscode.ExtensionContext
) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "mysql-test.openPairedFile",
      async (targetUri: vscode.Uri) => {
        const doc =
          await vscode.workspace.openTextDocument(targetUri);
        await vscode.window.showTextDocument(doc);
      }
    )
  );
}

/**
 * CodeLens provider: shows links to paired files at the top.
 * .test files show multiple links (result, opt, cnf) + Run/Debug buttons.
 * Others show a single link back to .test.
 */
export class MtrPairedFileCodeLensProvider
  implements vscode.CodeLensProvider {
  provideCodeLenses(
    document: vscode.TextDocument
  ): vscode.CodeLens[] {
    const targets = getPairedFiles(document);
    const range = new vscode.Range(0, 0, 0, 0);
    const lenses: vscode.CodeLens[] = [];

    // Run button for .test files (before paired file links)
    if (document.uri.fsPath.endsWith(".test")) {
      const testName = deriveTestName(document.uri.fsPath);
      if (testName) {
        lenses.push(new vscode.CodeLens(range, {
          title: "$(play) Run Test",
          tooltip: `Run ${testName}`,
          command: "mysql-test.runTestFromFile",
          arguments: [testName],
        }));
      }
    }

    // Paired file links
    for (const t of targets) {
      const basename = path.basename(t.uri.fsPath);
      lenses.push(new vscode.CodeLens(range, {
        title: basename,
        tooltip: `Open ${t.label}`,
        command: "mysql-test.openPairedFile",
        arguments: [t.uri],
      }));
    }

    return lenses;
  }
}

/**
 * Register the "Go to Paired File" command and CodeLens provider.
 */
export function registerPairFileFeatures(
  context: vscode.ExtensionContext
) {
  // Alt+O: jump to the primary paired file
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "mysql-test.goToPairedFile",
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          return;
        }

        const targets = getPairedFiles(editor.document);
        if (targets.length === 0) {
          vscode.window.showInformationMessage(
            "No paired file found"
          );
          return;
        }

        // For .test files, prefer .result; otherwise take the first
        const primary =
          targets.find((t) => t.label === "result") ||
          targets[0];
        const doc =
          await vscode.workspace.openTextDocument(primary.uri);
        await vscode.window.showTextDocument(doc);
      }
    )
  );

  // Click handler for CodeLens links
  registerOpenPairedFileCommand(context);

  // CodeLens
  const selector: vscode.DocumentSelector = [
    { language: "mysql-test" },
    { language: "mysql-result" },
    { language: "mysql-opt" },
    { language: "mysql-cnf" },
  ];

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      selector,
      new MtrPairedFileCodeLensProvider()
    )
  );
}
