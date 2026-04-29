import * as vscode from "vscode";
import * as path from "path";
import { spawn } from "child_process";
import type { MtrConfig } from "../config";
import { getMtrPath } from "../config";
import { syncTestByInstallPath } from "./sync-manager";
import { parseManualDebugOutput, readInitScript } from "./mtr-parser";
import { getSourceRoots } from "./build-trigger";
import { resolveMtrDir } from "./test-discovery";

/**
 * Launch a debug session for a single MTR test.
 *
 * Flow:
 * 1. Sync test file to baseDir
 * 2. Run MTR with --manual-lldb
 * 3. Parse the debug command line from MTR output
 * 4. Start VS Code debug session
 */
export async function debugTest(
  testName: string,
  config: MtrConfig,
  token: vscode.CancellationToken
): Promise<void> {
  const sourceRoots = getSourceRoots();

  // Determine if we should use lldb or gdb based on platform and config
  const isMac = process.platform === "darwin";
  const useLldb = config.debugAdapter === "lldb" || (config.debugAdapter === "auto" && isMac);
  const manualFlag = useLldb ? "--manual-lldb" : "--manual-gdb";

  // Run MTR with --manual-lldb/--manual-gdb
  const args = [testName, "--force", manualFlag];
  const mtrPath = getMtrPath(config.installDir);
  const realDir = resolveMtrDir(mtrPath);

  const debugInfo = await executeMtrAndWaitForDebug("./mtr", args, realDir, token);

  if (!debugInfo) {
    throw new Error("MTR did not produce a debug command. Check that the test can start mysqld.");
  }

  // Read init script contents
  const initContents = readInitScript(debugInfo.initScript);
  if (initContents === undefined) {
    throw new Error(`Cannot read init script: ${debugInfo.initScript}`);
  }

  // Determine which debug adapter to use
  const adapterType = resolveDebugAdapterType(config.debugAdapter, debugInfo.debuggerType);

  // Build source map: install dir -> source roots
  const sourceMap = buildSourceMap(config.installDir, sourceRoots);

  // Create and start debug configuration
  const debugConfig = createDebugConfiguration(adapterType, debugInfo, initContents, sourceMap);

  await vscode.debug.startDebugging(undefined, debugConfig);
}

/**
 * Execute MTR with --manual-lldb/--manual-gdb and wait for the debug command line.
 */
function executeMtrAndWaitForDebug(
  mtrPath: string,
  args: string[],
  cwd: string,
  token: vscode.CancellationToken
): Promise<import("./mtr-parser").ParsedDebugInfo | null> {
  return new Promise((resolve, reject) => {
    const proc = spawn(mtrPath, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    let output = "";
    let resolved = false;

    token.onCancellationRequested(() => {
      if (!resolved) {
        resolved = true;
        proc.kill();
        reject(new Error("Debug cancelled"));
      }
    });

    proc.stdout.on("data", (data: Buffer) => {
      output += data.toString();

      // Check if we got the debug command line
      const info = parseManualDebugOutput(output);
      if (info && !resolved) {
        resolved = true;
        // Don't kill MTR — it needs to stay running so mysqld stays paused
        resolve(info);
      }
    });

    proc.stderr.on("data", (data: Buffer) => {
      output += data.toString();
    });

    proc.on("close", (code) => {
      if (!resolved) {
        resolved = true;
        if (code !== 0) {
          reject(new Error(`MTR exited with code ${code}.\nOutput:\n${output}`));
        } else {
          resolve(null);
        }
      }
    });

    proc.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });
  });
}

/**
 * Resolve the VS Code debug adapter type based on config and platform.
 */
function resolveDebugAdapterType(
  configAdapter: string,
  mtrDebugger: "lldb" | "gdb"
): "lldb" | "cppdbg" {
  if (configAdapter === "lldb") return "lldb";
  if (configAdapter === "cppdbg") return "cppdbg";

  // Auto: prefer lldb on macOS, cppdbg on Linux with gdb
  if (mtrDebugger === "lldb") return "lldb";
  return "cppdbg";
}

/**
 * Build source map from install directory to source roots.
 */
function buildSourceMap(installDir: string, sourceRoots: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const root of sourceRoots) {
    map[installDir] = root;
    // Also map common subdirectories
    map[path.join(installDir, "mysql-test")] = path.join(root, "mysql-test");
  }
  return map;
}

/**
 * Extract PID from lldbinit/gdbinit contents.
 */
function extractPid(initContents: string): number | undefined {
  // Match: process attach --pid 12345 or process attach -p 12345
  const match = initContents.match(/process\s+attach\s+(?:--pid|-p)\s+(\d+)/);
  return match ? parseInt(match[1], 10) : undefined;
}

/**
 * Parse init script into individual commands, filtering out commands
 * that CodeLLDB handles automatically.
 */
function parseInitCommands(contents: string, type: "lldb" | "gdb"): string[] {
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .filter((line) => {
      // Filter out commands that CodeLLDB handles automatically
      if (type === "lldb") {
        // CodeLLDB creates target from 'program' field
        if (line.startsWith("target create")) return false;
        // CodeLLDB handles attach via request: "attach" + pid
        if (line.startsWith("process attach")) return false;
      } else {
        // gdb: CodeLLDB/cpptools handles target and attach
        if (line.startsWith("target create") || line.startsWith("file")) return false;
        if (line.startsWith("attach")) return false;
      }
      return true;
    });
}

/**
 * Create VS Code debug configuration based on adapter type.
 */
function createDebugConfiguration(
  adapterType: "lldb" | "cppdbg",
  debugInfo: import("./mtr-parser").ParsedDebugInfo,
  initContents: string,
  sourceMap: Record<string, string>
): vscode.DebugConfiguration {
  const pid = extractPid(initContents);
  const commands = parseInitCommands(initContents, adapterType === "lldb" ? "lldb" : "gdb");

  if (adapterType === "lldb") {
    if (pid) {
      // Attach to running mysqld process
      return {
        type: "lldb",
        request: "attach",
        name: "Debug mysqld",
        program: debugInfo.program,
        pid,
        preRunCommands: commands,
        sourceMap,
        stopOnEntry: false,
      };
    }
    // Fallback: launch mode
    return {
      type: "lldb",
      request: "launch",
      name: "Debug mysqld",
      program: debugInfo.program,
      cwd: debugInfo.cwd,
      preRunCommands: commands,
      sourceMap,
      stopOnEntry: false,
    };
  }

  // cppdbg (Microsoft C/C++)
  if (pid) {
    return {
      type: "cppdbg",
      request: "attach",
      name: "Debug mysqld",
      program: debugInfo.program,
      processId: pid,
      setupCommands: commands.map((cmd) => ({
        text: cmd,
        description: cmd,
        ignoreFailures: true,
      })),
      sourceFileMap: sourceMap,
      stopOnEntry: false,
      MIMode: debugInfo.debuggerType === "lldb" ? "lldb" : "gdb",
    };
  }

  return {
    type: "cppdbg",
    request: "launch",
    name: "Debug mysqld",
    program: debugInfo.program,
    cwd: debugInfo.cwd,
    setupCommands: commands.map((cmd) => ({
      text: cmd,
      description: cmd,
      ignoreFailures: true,
    })),
    sourceFileMap: sourceMap,
    stopOnEntry: false,
    MIMode: debugInfo.debuggerType === "lldb" ? "lldb" : "gdb",
  };
}
