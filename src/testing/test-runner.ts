import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { spawn } from "child_process";
import type { MtrConfig } from "../config";
import { getMtrPath } from "../config";
import { syncTestByInstallPath } from "./sync-manager";
import { getSourceRoots } from "./build-trigger";
import { resolveMtrDir } from "./test-discovery";

/**
 * Run MTR tests and update the TestRun with results.
 * Full MTR output is written to a temp log file and opened in an editor tab.
 */
export interface TestRunResult {
  results: { [testId: string]: { status: "pass" | "fail" | "skip"; testName: string } };
  logFile?: string;
}

export async function runTests(
  testNames: string[],
  config: MtrConfig,
  run: vscode.TestRun,
  items: vscode.TestItem[],
  token: vscode.CancellationToken,
  record: boolean = false
): Promise<TestRunResult> {
  const sourceRoots = getSourceRoots();

  // Create temp files first so sync output can be logged
  const tmpDir = os.tmpdir();
  const xmlReport = path.join(tmpDir, `mtr-report-${Date.now()}.xml`);
  const outputFile = path.join(tmpDir, `mtr-output-${Date.now()}.log`);

  // Open log file in editor upfront for real-time viewing
  fs.writeFileSync(outputFile, "", "utf-8");
  const doc = await vscode.workspace.openTextDocument(outputFile);
  await vscode.window.showTextDocument(doc, { preview: true });
  await vscode.languages.setTextDocumentLanguage(doc, "mysql-test");

  // Write a line to the log file
  const logLine = (line: string) => {
    fs.appendFileSync(outputFile, line + "\n", "utf-8");
  };

  const startTime = Date.now();
  const resultsMap: TestRunResult["results"] = {};

  try {
    // Pre-sync all test files
    for (const item of items) {
      try {
        const src = item.uri!.fsPath;
        const dst = path.join(config.installDir, src.substring(src.indexOf("/mysql-test/")));
        logLine(`[sync] ${src}`);
        logLine(`[sync] -> ${dst}`);
        await syncTestByInstallPath(src, config.installDir, sourceRoots);
        logLine(`[sync] OK`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logLine(`[sync] FAILED: ${msg}`);
        run.appendOutput(`Warning: Failed to sync ${item.uri!.fsPath}: ${err}\n`);
      }
    }
    logLine("");

    // Build MTR args: record flag + user-configured args + test names + internal xml-report
    const userArgs = config.mtrArgs ? config.mtrArgs.split(/\s+/).filter(Boolean) : [];
    const args: string[] = [];
    if (record) {
      args.push("--record");
    }
    args.push(...userArgs, ...testNames, `--xml-report=${xmlReport}`);

    const mtrPath = getMtrPath(config.installDir);
    const realDir = resolveMtrDir(mtrPath);

    logLine(`Running: ./mtr ${args.join(" ")}`);
    logLine(`Working directory: ${realDir}`);
    logLine("");

    // Execute MTR — output goes to log file only
    const results = await executeMtr("./mtr", args, realDir, token, logLine);

    // Parse XML report for detailed results
    const xmlResults = parseXmlReport(xmlReport);

    // Update test items based on results
    for (const item of items) {
      if (token.isCancellationRequested) {
        run.skipped(item);
        resultsMap[item.id] = { status: "skip", testName: item.id };
        continue;
      }

      const xmlResult = xmlResults.get(item.id);
      let status: "pass" | "fail" | "skip";
      if (xmlResult) {
        switch (xmlResult.status) {
          case "pass":
            run.passed(item);
            status = "pass";
            break;
          case "fail":
            run.failed(item, new vscode.TestMessage(xmlResult.failure ?? "Test failed"));
            status = "fail";
            break;
          case "skip":
            run.skipped(item);
            status = "skip";
            break;
        }
      } else if (results.exitCode === 0) {
        run.passed(item);
        status = "pass";
      } else {
        run.failed(item, new vscode.TestMessage("Test failed (no detailed result)"));
        status = "fail";
      }
      resultsMap[item.id] = { status, testName: item.id };
    }

    // If record mode, copy .result files back to source
    if (record) {
      const allPassed = Object.values(resultsMap).every(r => r.status === "pass");
      if (allPassed) {
        logLine("");
        logLine("[record] All tests passed, syncing .result files to source...");
        for (const testName of testNames) {
          const result = copyResultToSource(testName, config.installDir, sourceRoots);
          if (result) {
            logLine(`[record] ${result.src} -> ${result.dst}`);
          } else {
            logLine(`[record] No .result file found for ${testName}`);
          }
        }
      } else {
        logLine("");
        logLine("[record] Tests not all passed, skipping result sync.");
      }
    }

    return { results: resultsMap, logFile: outputFile };
  } finally {
    // Clean up XML report
    try {
      if (fs.existsSync(xmlReport)) {
        fs.unlinkSync(xmlReport);
      }
    } catch {
      // Ignore cleanup errors
    }

    // Reveal the log file editor to bring it to front
    try {
      await vscode.window.showTextDocument(doc, { preview: true });
    } catch {
      // Ignore
    }
  }
}

interface MtrResult {
  exitCode: number;
}

interface XmlTestResult {
  status: "pass" | "fail" | "skip";
  failure?: string;
}

function executeMtr(
  mtrPath: string,
  args: string[],
  cwd: string,
  token: vscode.CancellationToken,
  onOutput: (line: string) => void
): Promise<MtrResult> {
  return new Promise((resolve) => {
    const proc = spawn(mtrPath, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    const disposables: vscode.Disposable[] = [];

    if (token.isCancellationRequested) {
      proc.kill();
      resolve({ exitCode: -1 });
      return;
    }

    token.onCancellationRequested(() => {
      proc.kill();
      resolve({ exitCode: -1 });
    });

    proc.stdout.on("data", (data: Buffer) => {
      const text = data.toString();
      // Replace \r with \n to handle MTR's progress bar updates
      for (const line of text.replace(/\r/g, "\n").split(/\n/)) {
        if (line) onOutput(line);
      }
    });

    proc.stderr.on("data", (data: Buffer) => {
      const text = data.toString();
      for (const line of text.replace(/\r/g, "\n").split(/\n/)) {
        if (line) onOutput(`[stderr] ${line}`);
      }
    });

    proc.on("close", (code) => {
      resolve({ exitCode: code ?? -1 });
    });

    proc.on("error", (err) => {
      onOutput(`Error: ${err.message}`);
      resolve({ exitCode: -1 });
    });
  });
}

/**
 * Parse JUnit XML report from MTR.
 * MTR generates a JUnit-compatible XML with `<testcase>` elements.
 */
function parseXmlReport(filePath: string): Map<string, XmlTestResult> {
  const results = new Map<string, XmlTestResult>();

  if (!fs.existsSync(filePath)) return results;

  const content = fs.readFileSync(filePath, "utf-8");

  // Simple XML parsing — regex-based for JUnit format
  // <testcase name="suite.testname" time="0.123">
  //   <failure message="...">...</failure>
  //   <skipped/>
  // </testcase>
  const testCaseRegex = /<testcase\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/testcase>/g;
  let match;

  while ((match = testCaseRegex.exec(content)) !== null) {
    const name = match[1];
    const body = match[2];

    if (body.includes("<failure")) {
      const msgMatch = body.match(/<failure[^>]*>([\s\S]*?)<\/failure>/);
      const message = msgMatch
        ? msgMatch[1].replace(/<\!\[CDATA\[([\s\S]*?)\]\]>/, "$1").trim()
        : "Test failed";
      results.set(name, { status: "fail", failure: message });
    } else if (body.includes("<skipped") || body.includes("<error")) {
      results.set(name, { status: "skip" });
    } else {
      results.set(name, { status: "pass" });
    }
  }

  return results;
}

/**
 * Copy a .result file from installDir back to the source tree.
 * e.g. main.alias → installDir/mysql-test/r/alias.result → sourceRoot/mysql-test/r/alias.result
 *      innodb.alias → installDir/mysql-test/suite/innodb/r/alias.result → sourceRoot/mysql-test/suite/innodb/r/alias.result
 */
function copyResultToSource(testName: string, installDir: string, sourceRoots: string[]): { src: string; dst: string } | undefined {
  let relativeResultPath: string | undefined;
  if (testName.startsWith("main.")) {
    const fileName = testName.substring(5);
    relativeResultPath = `r/${fileName}.result`;
  } else {
    const dotIdx = testName.indexOf(".");
    if (dotIdx > 0) {
      const suite = testName.substring(0, dotIdx);
      const fileName = testName.substring(dotIdx + 1);
      relativeResultPath = `suite/${suite}/r/${fileName}.result`;
    }
  }
  if (!relativeResultPath) return;

  const installResult = path.join(installDir, "mysql-test", relativeResultPath);
  if (!fs.existsSync(installResult)) return undefined;

  for (const root of sourceRoots) {
    const sourceResult = path.join(root, "mysql-test", relativeResultPath);
    const sourceDir = path.dirname(sourceResult);
    if (fs.existsSync(sourceDir)) {
      fs.copyFileSync(installResult, sourceResult);
      return { src: installResult, dst: sourceResult };
    }
  }
  return undefined;
}
