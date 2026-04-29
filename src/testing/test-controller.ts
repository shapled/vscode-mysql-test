import * as vscode from "vscode";
import * as path from "path";
import { getConfig, getMtrPath } from "../config";
import { discoverTests, mapToSourcePaths, resolveMtrDir } from "./test-discovery";
import { runTests } from "./test-runner";
import { getSourceRoots } from "./build-trigger";
import { findMysqlTestRoot, deriveTestName, scanSuites } from "../utils/path-utils";
import type { MtrTestCaseWithSource } from "./types";
import { getOutputChannel } from "./output-channel";
import { addRunHistory, updateRunHistory } from "./tree-view";

let controller: vscode.TestController;
let testItems = new Map<string, vscode.TestItem>();
let discoveryPromise: Promise<void> | null = null;

/**
 * Activate the test controller and all related providers.
 */
export function activateTesting(context: vscode.ExtensionContext): void {
  controller = vscode.tests.createTestController("mysql-test", "MySQL Test");
  context.subscriptions.push(controller);

  // Refresh command
  const refreshCmd = vscode.commands.registerCommand("mysql-test.refreshTests", () => {
    refreshTests();
  });
  context.subscriptions.push(refreshCmd);

  // Resolve handler — lazy discovery when user expands a node
  controller.resolveHandler = async (item) => {
    if (!item) {
      // Root level — refresh suite list
      await doRefresh();
    } else if (item.children.size === 0 && !!controller.items.get(item.id)) {
      // Suite node being expanded — discover its tests
      const suiteName = item.label;
      await discoverSuiteTests(suiteName);
    }
  };

  // Run profile
  const runProfile = controller.createRunProfile(
    "Run",
    vscode.TestRunProfileKind.Run,
    (request, token) => {
      handleRunRequest(request, token);
    },
    true
  );
  context.subscriptions.push(runProfile);

  // Run from CodeLens in .test files
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "mysql-test.runTestFromFile",
      async (...args: unknown[]) => {
        const testName = (typeof args[0] === "string" ? args[0] : undefined)
          ?? deriveTestName(vscode.window.activeTextEditor?.document.uri.fsPath ?? "");
        if (!testName) return;
        const record = args[1] === true;
        await runOrDebugFromCodeLens(testName, record);
      }
    )
  );
}

/**
 * Refresh all tests — clear existing and re-discover.
 */
async function refreshTests(): Promise<void> {
  // Avoid overlapping discoveries
  if (discoveryPromise) return;
  discoveryPromise = doRefresh();
  try {
    await discoveryPromise;
  } finally {
    discoveryPromise = null;
  }
}

async function doRefresh(): Promise<void> {
  const config = getConfig();
  if (!config.installDir) {
    controller.items.forEach((item) => controller.items.delete(item.id));
    testItems.clear();
    return;
  }

  try {
    // Phase 1: scan filesystem for suite list (fast, no MTR needed)
    const suites = scanSuites(config.installDir);
    getOutputChannel().appendLine(`[discover] Found ${suites.length} suites: ${suites.join(", ")}`);
    updateSuiteTree(suites);
  } catch (err) {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    getOutputChannel().appendLine(`[discover] Error: ${msg}`);
    getOutputChannel().show(true);
    vscode.window.showErrorMessage(
      `Failed to discover MTR suites: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Update the controller with suite nodes only.
 * Tests are discovered lazily when a suite is expanded.
 */
function updateSuiteTree(suites: string[]): void {
  const existingIds = new Set(suites.map((s) => s.replace(/\//g, "::")));

  // Remove suites that no longer exist
  controller.items.forEach((item) => {
    if (!existingIds.has(item.id)) {
      controller.items.delete(item.id);
      // Clean up test items from removed suites
      for (const [key, val] of testItems) {
        if (controller.items.get(val.id.replace(/::/g, "/").split("::")[0]) === undefined) {
          testItems.delete(key);
        }
      }
    }
  });

  // Add new suite nodes
  for (const suiteName of suites) {
    const suiteId = suiteName.replace(/\//g, "::");
    if (!controller.items.get(suiteId)) {
      const suiteItem = controller.createTestItem(suiteId, suiteName);
      controller.items.add(suiteItem);
    }
  }
}

/**
 * Lazily discover tests for a specific suite.
 * Called when user expands a suite node in Test Explorer.
 */
async function discoverSuiteTests(suiteName: string): Promise<void> {
  const config = getConfig();
  if (!config.installDir) return;

  const suiteId = suiteName.replace(/\//g, "::");
  const suiteItem = controller.items.get(suiteId);
  if (!suiteItem) return;

  // Already discovered?
  if (suiteItem.children.size > 0) return;

  try {
    const mtrPath = getMtrPath(config.installDir);
    const realDir = resolveMtrDir(mtrPath);
    getOutputChannel().appendLine(`[discover] Running: ./mtr --print-testcases --suite=${suiteName}`);
    getOutputChannel().appendLine(`[discover] Working directory: ${realDir}`);

    const tests = await discoverTests(mtrPath, [suiteName]);
    const sourceRoots = getSourceRoots();
    const mapped = mapToSourcePaths(tests, config.installDir, sourceRoots);
    getOutputChannel().appendLine(`[discover] Found ${mapped.length} tests in suite ${suiteName}`);

    for (const test of mapped) {
      const testId = test.name.replace(/\//g, "::");
      if (suiteItem.children.get(testId)) continue;

      const testItem = controller.createTestItem(testId, test.shortname, vscode.Uri.file(test.sourcePath));
      testItem.label = test.skip && test.comment ? `${test.shortname} (skipped)` : test.shortname;
      if (test.skip) {
        testItem.tags = [new vscode.TestTag("skipped")];
      }
      suiteItem.children.add(testItem);
      testItems.set(test.name, testItem);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    getOutputChannel().appendLine(`[discover] Error discovering suite ${suiteName}: ${msg}`);
    // Add a placeholder item so user knows discovery failed
    const errorItem = controller.createTestItem(
      `${suiteId}::error`,
      `Error: ${msg}`
    );
    suiteItem.children.add(errorItem);
  }
}

/**
 * Handle a run or debug request from the Test Explorer.
 */
async function handleRunRequest(
  request: vscode.TestRunRequest,
  token: vscode.CancellationToken,
  record: boolean = false
): Promise<void> {
  const config = getConfig();
  if (!config.installDir) {
    if (!(await promptConfig("baseDir is not configured"))) return;
  }

  const run = controller.createTestRun(request);
  const queue: vscode.TestItem[] = [];

  // Collect tests to run, discovering suites on demand
  if (request.include) {
    // Specific tests requested
    for (const item of request.include) {
      // If item is a suite node (no children yet), discover it first
      if (!!controller.items.get(item.id) && item.children.size === 0) {
        await discoverSuiteTests(item.label);
      }
      collectTestItems(item, queue, request.exclude);
    }
  } else {
    // All tests — discover all suites
    for (const [suiteId, suiteItem] of controller.items) {
      if (suiteItem.children.size === 0) {
        await discoverSuiteTests(suiteItem.label);
      }
      collectTestItems(suiteItem, queue, request.exclude);
    }
  }

  if (queue.length === 0) {
    run.end();
    return;
  }

  // Enqueue all tests as started
  for (const item of queue) {
    run.started(item);
  }

  // Add "running" entries to history
  for (const item of queue) {
    addRunHistory({
      testName: unescapeTestId(item.id),
      status: "running",
      duration: 0,
      timestamp: Date.now(),
    });
  }

  const startTime = Date.now();
  try {
    const testNames = queue.map((item) => unescapeTestId(item.id));
    const { results, logFile } = await runTests(testNames, config, run, queue, token, record);

    // Update running entries with final results
    const duration = Date.now() - startTime;
    for (const [id, result] of Object.entries(results)) {
      updateRunHistory(unescapeTestId(id), { ...result, duration, logFile });
    }
  } catch {
    // Mark remaining running entries as failed
    const duration = Date.now() - startTime;
    for (const item of queue) {
      updateRunHistory(unescapeTestId(item.id), { status: "fail", duration });
    }
  } finally {
    run.end();
  }
}

/** Reverse the '::' escaping used in test item IDs. */
function unescapeTestId(id: string): string {
  return id.replace(/::/g, "/");
}

/**
 * Show configuration error and offer to open Settings.
 */
async function promptConfig(message: string): Promise<boolean> {
  const result = await vscode.window.showErrorMessage(
    `MySQL Test: ${message}`,
    "Open Settings"
  );
  if (result === "Open Settings") {
    await vscode.commands.executeCommand(
      "workbench.action.openWorkspaceSettings",
      "mysql-test"
    );
  }
  return false;
}
function collectTestItems(
  item: vscode.TestItem,
  queue: vscode.TestItem[],
  exclude?: readonly vscode.TestItem[]
): void {
  if (exclude?.some((e) => e.id === item.id)) return;

  // If this item has children, recurse into them
  const hasChildren = item.children.size > 0;
  if (hasChildren) {
    item.children.forEach((child) => collectTestItems(child, queue, exclude));
  } else {
    queue.push(item);
  }
}

/**
 * Run or debug a single test triggered from CodeLens in a .test file.
 * Looks up the TestItem by name and uses the Test Explorer API.
 */
async function runOrDebugFromCodeLens(
  testName: string,
  record: boolean = false
): Promise<void> {
  const config = getConfig();
  if (!config.installDir) {
    if (!(await promptConfig("baseDir is not configured"))) return;
  }

  // Ensure suite list is loaded
  await refreshTests();

  const suiteName = testName.includes(".") ? testName.substring(0, testName.indexOf(".")) : "main";

  // If test not found, discover its suite on demand
  if (!testItems.get(testName)) {
    getOutputChannel().appendLine(`[run] Test "${testName}" not cached, discovering suite "${suiteName}"...`);
    await discoverSuiteTests(suiteName);
  }

  const item = testItems.get(testName);
  if (!item) {
    const available = [...testItems.keys()].filter((k) => k.startsWith(suiteName + "."));
    getOutputChannel().appendLine(`[run] Test "${testName}" not found. Tests in suite "${suiteName}": ${available.length > 0 ? available.slice(0, 20).join(", ") : "none"}`);
    getOutputChannel().show(true);
    vscode.window.showWarningMessage(`Test "${testName}" not found. Check "MySQL Test" output channel.`);
    return;
  }

  const token = new vscode.CancellationTokenSource().token;
  const request = new vscode.TestRunRequest([item]);
  getOutputChannel().show(true);
  await handleRunRequest(request, token, record);
}

/**
 * Derive the MTR test name from the currently active editor's file path.
 * e.g. /repo/mysql-test/t/alias.test → "main.alias"
 *       /repo/mysql-test/suite/innodb/t/x.test → "innodb.x"
 */
function getTestNameFromActiveEditor(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;

  const fsPath = editor.document.uri.fsPath;
  if (!fsPath.endsWith(".test")) return undefined;

  const root = findMysqlTestRoot(fsPath);
  if (!root) return undefined;

  const normalized = fsPath.replace(/\\/g, "/");
  const normalizedRoot = root.replace(/\\/g, "/");
  const relative = normalized.substring(normalizedRoot.length);

  // Nested suite: /suite/parent/child/t/name.test → "parent/child.name"
  const nestedMatch = relative.match(/^\/suite\/(.+)\/t\/([^/]+)\.test$/);
  if (nestedMatch) return `${nestedMatch[1]}.${nestedMatch[2]}`;

  // Main suite: /t/name.test → "main.name"
  const mainMatch = relative.match(/^\/t\/([^/]+)\.test$/);
  if (mainMatch) return `main.${mainMatch[1]}`;

  return undefined;
}
