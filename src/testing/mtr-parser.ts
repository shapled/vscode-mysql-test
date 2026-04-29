/**
 * Parse MTR --manual-lldb output to extract debug configuration.
 *
 * MTR output format (example):
 *   You can start the mysqld with:
 *   cd /path/to/install/mysql-test && lldb -s /path/to/var/tmp/mysqld.1.lldbinit /path/to/install/bin/mysqld
 *
 * For --manual-gdb:
 *   cd /path/to/install/mysql-test && gdb -x /path/to/var/tmp/mysqld.1.gdbinit /path/to/install/bin/mysqld
 */

export interface ParsedDebugInfo {
  /** Path to the mysqld binary */
  program: string;
  /** Working directory for the debugger */
  cwd: string;
  /** Path to the init script (lldbinit or gdbinit) */
  initScript: string;
  /** Debugger type: "lldb" or "gdb" */
  debuggerType: "lldb" | "gdb";
  /** Contents of the init script (if readable) */
  initScriptContents?: string;
}

/**
 * Parse MTR output lines looking for the manual debugger command.
 * Returns parsed debug info when found, or undefined if not yet found.
 */
export function parseManualDebugOutput(output: string): ParsedDebugInfo | undefined {
  // Look for the lldb command line
  const lldbMatch = output.match(
    /cd\s+(\S+)\s*&&\s*lldb\s+-s\s+(\S+)\s+(\S+\/mysqld)/
  );
  if (lldbMatch) {
    return {
      cwd: lldbMatch[1],
      initScript: lldbMatch[2],
      program: lldbMatch[3],
      debuggerType: "lldb",
    };
  }

  // Look for the gdb command line
  const gdbMatch = output.match(
    /cd\s+(\S+)\s*&&\s*gdb\s+-x\s+(\S+)\s+(\S+\/mysqld)/
  );
  if (gdbMatch) {
    return {
      cwd: gdbMatch[1],
      initScript: gdbMatch[2],
      program: gdbMatch[3],
      debuggerType: "gdb",
    };
  }

  return undefined;
}

/**
 * Read init script file and return its contents.
 */
export function readInitScript(filePath: string): string | undefined {
  const fs = require("fs") as typeof import("fs");
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }
}
