import * as vscode from "vscode";
import * as path from "path";

export interface MtrConfig {
  installDir: string;
  buildDir: string;
  buildCommand: string;
  rebuildCommand: string;
  autoSync: boolean;
  debugAdapter: "auto" | "lldb" | "cppdbg";
  mtrArgs: string;
}

function getConfiguration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("mysql-test");
}

/**
 * Resolve VS Code variables and environment variables in a string.
 *
 * Supported variables:
 * - ${workspaceFolder}        — workspace root path
 * - ${workspaceFolderBasename} — workspace folder name
 * - ${mysqlInstallDir}         — alias of baseDir
 * - ${env:NAME}                — system environment variable
 * - ${NAME}                    — fallback to environment variable
 */
export function resolveVariables(value: string, installDir?: string): string {
  if (!value) return value;

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  const resolvedInstallDir = installDir ?? "";

  return value
    // Custom: ${mysqlInstallDir} → installDir
    .replace(/\$\{mysqlInstallDir\}/g, resolvedInstallDir)
    // VS Code workspace variables
    .replace(/\$\{workspaceFolder\}/g, workspaceRoot)
    .replace(/\$\{workspaceFolderBasename\}/g, path.basename(workspaceRoot))
    // ${env:NAME} syntax
    .replace(/\$\{env:(\w+)\}/g, (_, name) => process.env[name] ?? "")
    // ${NAME} fallback to env (skip already-handled variables)
    .replace(/\$\{(\w+)\}/g, (match, name) => {
      if (["workspaceFolder", "workspaceFolderBasename", "mysqlInstallDir"].includes(name)) {
        return match;
      }
      return process.env[name] ?? match;
    });
}

function getString(key: string, installDir?: string): string {
  return resolveVariables(getConfiguration().get<string>(key, ""), installDir);
}

export function getConfig(): MtrConfig {
  const installDir = getString("installDir");
  return {
    installDir,
    buildDir: getString("buildDir", installDir),
    buildCommand: getString("buildCommand", installDir),
    rebuildCommand: getString("rebuildCommand", installDir),
    autoSync: getConfiguration().get<boolean>("autoSync", true),
    debugAdapter: getConfiguration().get<string>("debugAdapter", "auto") as MtrConfig["debugAdapter"],
    mtrArgs: getString("mtrArgs", installDir),
  };
}

/** Get mtr script path derived from installDir. */
export function getMtrPath(installDir: string): string {
  return path.join(installDir, "mysql-test", "mtr");
}
