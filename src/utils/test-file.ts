import * as vscode from "vscode";
import {
  pairTestResultPath,
  pairSuffixFileToTest,
  resolveIncPathString,
} from "./path-utils";

/**
 * Pair a .test file with its .result file (VS Code Uri version).
 */
export function pairTestResult(
  uri: vscode.Uri
): vscode.Uri | undefined {
  const result = pairTestResultPath(uri.fsPath);
  return result ? vscode.Uri.file(result) : undefined;
}

/**
 * Pair a .opt file with its .test file (VS Code Uri version).
 */
export function pairOptTest(
  uri: vscode.Uri
): vscode.Uri | undefined {
  const result = pairSuffixFileToTest(uri.fsPath, "opt");
  return result ? vscode.Uri.file(result) : undefined;
}

/**
 * Pair a .cnf file with its .test file (VS Code Uri version).
 */
export function pairCnfTest(
  uri: vscode.Uri
): vscode.Uri | undefined {
  const result = pairSuffixFileToTest(uri.fsPath, "cnf");
  return result ? vscode.Uri.file(result) : undefined;
}

/**
 * Resolve a --source or --include path to a .inc file (VS Code Uri version).
 */
export function resolveIncPath(
  currentFile: string,
  incPath: string
): vscode.Uri | undefined {
  const result = resolveIncPathString(currentFile, incPath);
  return result ? vscode.Uri.file(result) : undefined;
}
