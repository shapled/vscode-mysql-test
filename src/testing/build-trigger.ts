import * as vscode from "vscode";
import { spawn } from "child_process";
import type { MtrConfig } from "../config";

/**
 * Execute the user-configured build command in buildDir.
 */
export async function runBuild(
  config: MtrConfig,
  run: vscode.TestRun,
  token: vscode.CancellationToken,
  fullRebuild?: boolean
): Promise<void> {
  const command = fullRebuild && config.rebuildCommand
    ? config.rebuildCommand
    : config.buildCommand;

  if (!command) return;

  const cwd = config.buildDir || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  run.appendOutput(`Running build: ${command}\n  cwd: ${cwd}\n`);

  return new Promise((resolve, reject) => {
    const shell = process.env.SHELL ?? "/bin/sh";
    const proc = spawn(shell, ["-c", command], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    token.onCancellationRequested(() => {
      proc.kill();
      reject(new Error("Build cancelled"));
    });

    proc.stdout.on("data", (data: Buffer) => {
      run.appendOutput(data.toString());
    });

    proc.stderr.on("data", (data: Buffer) => {
      run.appendOutput(data.toString());
    });

    proc.on("close", (code) => {
      run.appendOutput(`Build exited with code ${code}\n\n`);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Build command exited with code ${code}`));
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Get workspace folders as source roots.
 */
export function getSourceRoots(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
}
