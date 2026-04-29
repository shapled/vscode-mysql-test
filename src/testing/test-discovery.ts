import * as path from "path";
import * as fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import type { MtrTestCase, MtrTestCaseWithSource } from "./types";

const execFileAsync = promisify(execFile);

/**
 * Resolve the real directory of the mtr script (handles symlinks).
 */
export function resolveMtrDir(mtrPath: string): string {
  const mtrDir = path.dirname(mtrPath);
  try {
    return fs.realpathSync(mtrDir);
  } catch {
    return mtrDir;
  }
}

/**
 * Parse the output of `./mtr --print-testcases` into structured test cases.
 * Format: each test starts with `[suite.name]`, followed by `key= value` lines.
 */
export function parsePrintTestcasesOutput(output: string): MtrTestCase[] {
  const tests: MtrTestCase[] = [];
  const lines = output.split(/\r?\n/);
  let current: Partial<MtrTestCase> | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Match test header: [suite.name]
    const headerMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (headerMatch) {
      if (current && current.name) {
        tests.push(normalizeTestCase(current));
      }
      const fullName = headerMatch[1];
      const dotIdx = fullName.indexOf(".");
      current = {
        name: fullName,
        suite: dotIdx >= 0 ? fullName.substring(0, dotIdx) : "main",
        shortname: dotIdx >= 0 ? fullName.substring(dotIdx + 1) : fullName,
        skip: false,
      };
      continue;
    }

    if (!current) continue;

    // Match key=value pairs (value may contain spaces)
    const kvMatch = trimmed.match(/^(\w[\w-]*)=\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const value = kvMatch[2];
      switch (key) {
        case "path":
          current.installPath = value;
          break;
        case "result_file":
          current.resultFile = value;
          break;
        case "shortname":
          current.shortname = value;
          break;
        case "name":
          current.name = value;
          break;
        case "skip":
          current.skip = value === "1";
          break;
        case "comment":
          current.comment = value;
          break;
      }
    }
  }

  // Don't forget the last test
  if (current && current.name) {
    tests.push(normalizeTestCase(current));
  }

  return tests;
}

function normalizeTestCase(partial: Partial<MtrTestCase>): MtrTestCase {
  return {
    name: partial.name ?? "",
    shortname: partial.shortname ?? partial.name ?? "",
    installPath: partial.installPath ?? "",
    resultFile: partial.resultFile ?? "",
    skip: partial.skip ?? false,
    comment: partial.comment,
    suite: partial.suite ?? "main",
  };
}

/**
 * Run `./mtr --print-testcases` and parse the output.
 */
export async function discoverTests(
  mtrPath: string,
  suites?: string[],
  cwd?: string
): Promise<MtrTestCase[]> {
  const args = ["--print-testcases"];
  if (suites && suites.length > 0) {
    args.push("--suite=" + suites.join(","));
  }

  // Resolve real directory to handle symlinks, then execute ./mtr from it
  const mtrDir = cwd ?? path.dirname(mtrPath);
  let realDir: string;
  try {
    realDir = fs.realpathSync(mtrDir);
  } catch {
    realDir = mtrDir;
  }

  try {
    const { stdout } = await execFileAsync("./mtr", args, {
      cwd: realDir,
      timeout: 300000,
      maxBuffer: 100 * 1024 * 1024,
    });
    return parsePrintTestcasesOutput(stdout);
  } catch (err) {
    // execFileAsync throws on non-zero exit or timeout, but mtr may still output test list
    if (err && typeof err === "object" && "stdout" in err) {
      const stdout = (err as { stdout: string }).stdout;
      if (stdout) {
        return parsePrintTestcasesOutput(stdout);
      }
    }
    const isTimeout = err instanceof Error && "killed" in err;
    if (isTimeout) {
      throw new Error(`MTR discovery timed out (300s). Try specifying fewer suites.`);
    }
    throw err;
  }
}

/**
 * Map install directory paths to source tree paths.
 * Uses the relative path under mysql-test/ to find the corresponding source file.
 */
export function mapToSourcePaths(
  tests: MtrTestCase[],
  installDir: string,
  sourceRoots: string[]
): MtrTestCaseWithSource[] {
  // Resolve real paths to handle symlinks
  let realInstallDir: string;
  try {
    realInstallDir = fs.realpathSync(installDir).replace(/\\/g, "/");
  } catch {
    realInstallDir = installDir.replace(/\\/g, "/");
  }
  const realSourceRoots = sourceRoots.map((r) => {
    try {
      return fs.realpathSync(r).replace(/\\/g, "/");
    } catch {
      return r.replace(/\\/g, "/");
    }
  });

  return tests
    .map((test) => {
      if (!test.installPath) return null;

      // Resolve the install path from MTR output (may contain symlinks)
      let normalizedInstallPath: string;
      try {
        normalizedInstallPath = fs.realpathSync(test.installPath).replace(/\\/g, "/");
      } catch {
        normalizedInstallPath = test.installPath.replace(/\\/g, "/");
      }

      // Extract relative path under mysql-test/
      const mysqlTestIdx = normalizedInstallPath.indexOf("/mysql-test/");
      if (mysqlTestIdx < 0) return null;

      const relativePath = normalizedInstallPath.substring(mysqlTestIdx + "/mysql-test/".length);

      // Try each source root to find the corresponding source file
      for (let i = 0; i < realSourceRoots.length; i++) {
        const normalizedRoot = realSourceRoots[i];
        const sourcePath = path.join(normalizedRoot, "mysql-test", relativePath);
        if (fs.existsSync(sourcePath)) {
          const result: MtrTestCaseWithSource = {
            ...test,
            sourcePath,
          };

          // Also map result file if available
          if (test.resultFile) {
            const normalizedResult = test.resultFile.replace(/\\/g, "/");
            const resultMysqlTestIdx = normalizedResult.indexOf("/mysql-test/");
            if (resultMysqlTestIdx >= 0) {
              const resultRelative = normalizedResult.substring(resultMysqlTestIdx + "/mysql-test/".length);
              const sourceResultPath = path.join(normalizedRoot, "mysql-test", resultRelative);
              if (fs.existsSync(sourceResultPath)) {
                result.sourceResultPath = sourceResultPath;
              }
            }
          }

          return result;
        }
      }

      // No source mapping found — return with installPath as sourcePath
      return {
        ...test,
        sourcePath: test.installPath,
      };
    })
    .filter((t): t is MtrTestCaseWithSource => t !== null);
}
