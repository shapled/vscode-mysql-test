import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { getConfig } from "../config";
import { syncTestFile } from "./sync-manager";
import { getOutputChannel } from "./output-channel";
import { getSourceRoots } from "./build-trigger";
import { deriveTestName } from "../utils/path-utils";

// ─── Data Types ───────────────────────────────────────────────────────

export interface RunHistoryEntry {
  testName: string;
  status: "pass" | "fail" | "skip" | "running";
  duration: number;
  timestamp: number;
  logFile?: string;
}

// ─── Run History Storage ───────────────────────────────────────────────

const MAX_HISTORY = 20;
const runHistory: RunHistoryEntry[] = [];

export function addRunHistory(entry: RunHistoryEntry): void {
  runHistory.unshift(entry);
  if (runHistory.length > MAX_HISTORY) {
    runHistory.length = MAX_HISTORY;
  }
  _onConfigChange.fire(undefined);
  _onTestChange.fire(undefined);
}

export function updateRunHistory(testName: string, update: Partial<RunHistoryEntry>): void {
  const idx = runHistory.findIndex(e => e.testName === testName && e.status === "running");
  if (idx >= 0) {
    Object.assign(runHistory[idx], update);
  }
  _onConfigChange.fire(undefined);
  _onTestChange.fire(undefined);
}

// ─── Click Timing (double-click detection) ────────────────────────────

const pendingClicks = new Map<string, NodeJS.Timeout>();
const lastExecTime = new Map<string, number>();
const DBLCLICK_WAIT = 300;
const EXEC_COOLDOWN = 500;

function withClickTiming(
  key: string,
  onSingle: () => void | Promise<void>,
  onDouble: () => void | Promise<void>
): void {
  // Dedup: ignore rapid repeated calls (VS Code may fire command twice)
  const now = Date.now();
  const last = lastExecTime.get(key) || 0;
  if (now - last < EXEC_COOLDOWN) return;

  const prev = pendingClicks.get(key);
  if (prev) {
    clearTimeout(prev);
    pendingClicks.delete(key);
    lastExecTime.set(key, now);
    onDouble();
    // Cooldown to absorb the extra dblclick event
    pendingClicks.set(key, setTimeout(() => {
      pendingClicks.delete(key);
    }, DBLCLICK_WAIT));
    return;
  }
  pendingClicks.set(key, setTimeout(() => {
    pendingClicks.delete(key);
    lastExecTime.set(key, Date.now());
    onSingle();
  }, DBLCLICK_WAIT));
}

// ─── Configuration Tree Nodes ──────────────────────────────────────────

type ConfigNode =
  | { type: "openSettings" }
  | { type: "configVar"; key: string; value: string; configured: boolean };

const _onConfigChange = new vscode.EventEmitter<void>();

class ConfigurationProvider implements vscode.TreeDataProvider<ConfigNode> {
  readonly onDidChangeTreeData = _onConfigChange.event;

  getTreeItem(element: ConfigNode): vscode.TreeItem {
    switch (element.type) {
      case "openSettings": {
        const item = new vscode.TreeItem("Open Settings UI", vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon("settings-gear");
        item.command = { command: "workbench.action.openWorkspaceSettings", title: "Open Settings", arguments: ["mysql-test"] };
        return item;
      }
      case "configVar": {
        const hasInstallDir = !!getConfig().installDir;
        const item = new vscode.TreeItem(
          `${element.key}: ${element.value || "(not set)"}`,
          vscode.TreeItemCollapsibleState.None
        );
        item.iconPath = new vscode.ThemeIcon(element.configured ? "check" : "error");
        item.contextValue = "configVar";
        if (hasInstallDir) {
          item.command = {
            command: "mysql-test.treeConfigItemClick",
            title: "Edit Setting",
            arguments: [element.key],
          };
        }
        return item;
      }
    }
  }

  getChildren(): ConfigNode[] {
    return [{ type: "openSettings" as const }, ...getVariableItems()];
  }
}

// ─── Current Test Tree Nodes ──────────────────────────────────────────

type TestNode =
  | { type: "openedCasesGroup" }
  | { type: "openedCase"; name: string; uri: string }
  | { type: "testActionsGroup" }
  | { type: "testAction"; label: string; command: string | undefined; icon: string; reason?: string }
  | { type: "testHistoryGroup" }
  | { type: "historyEntry"; entry: RunHistoryEntry };

const _onTestChange = new vscode.EventEmitter<void>();

class CurrentTestProvider implements vscode.TreeDataProvider<TestNode> {
  readonly onDidChangeTreeData = _onTestChange.event;

  getTreeItem(element: TestNode): vscode.TreeItem {
    switch (element.type) {
      case "openedCasesGroup": {
        const item = new vscode.TreeItem("Opened Test Cases", vscode.TreeItemCollapsibleState.Collapsed);
        item.iconPath = new vscode.ThemeIcon("files");
        return item;
      }

      case "openedCase": {
        const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon("file-code");
        item.contextValue = "openedCase";
        item.command = {
          command: "vscode.open",
          title: "Open",
          arguments: [vscode.Uri.file(element.uri)],
        };
        return item;
      }

      case "testActionsGroup": {
        const item = new vscode.TreeItem("Action", vscode.TreeItemCollapsibleState.Collapsed);
        item.iconPath = new vscode.ThemeIcon("play");
        return item;
      }

      case "testAction": {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        if (element.reason) {
          item.description = element.reason;
          item.iconPath = new vscode.ThemeIcon(element.icon, "disabledForeground");
          item.command = {
            command: "mysql-test.treeActionDisabled",
            title: element.label,
            arguments: [element.reason],
          };
        } else {
          item.iconPath = new vscode.ThemeIcon(element.icon);
          item.command = {
            command: "mysql-test.treeExecuteTestAction",
            title: element.label,
            arguments: [{ label: element.label, command: element.command }],
          };
        }
        return item;
      }

      case "testHistoryGroup": {
        const item = new vscode.TreeItem("History", vscode.TreeItemCollapsibleState.Collapsed);
        item.iconPath = new vscode.ThemeIcon("history");
        return item;
      }

      case "historyEntry": {
        const timeStr = formatTimeAgo(element.entry.timestamp);
        const durStr = element.entry.status === "running"
          ? "..."
          : element.entry.duration >= 1000
            ? `${(element.entry.duration / 1000).toFixed(1)}s`
            : `${element.entry.duration}ms`;
        const statusText = element.entry.status === "running" ? "running" : element.entry.status;
        const item = new vscode.TreeItem(
          `${element.entry.testName}  ${statusText}  ${durStr}  ${timeStr}`,
          vscode.TreeItemCollapsibleState.None
        );
        item.iconPath = new vscode.ThemeIcon(getHistoryIcon(element.entry.status));
        item.contextValue = "historyEntry";
        if (element.entry.logFile && fs.existsSync(element.entry.logFile)) {
          item.command = {
            command: "vscode.open",
            title: "Open Log",
            arguments: [vscode.Uri.file(element.entry.logFile)],
          };
        }
        return item;
      }
    }
  }

  getChildren(element?: TestNode): TestNode[] {
    if (!element) {
      return [
        { type: "openedCasesGroup" as const },
        { type: "testActionsGroup" as const },
        { type: "testHistoryGroup" as const },
      ];
    }

    switch (element.type) {
      case "openedCasesGroup":
        return getOpenedTestCases();

      case "testActionsGroup":
        return getTestActionItems();

      case "testHistoryGroup":
        return runHistory.map(entry => ({ type: "historyEntry" as const, entry }));

      default:
        return [];
    }
  }
}

// ─── Config Item Builders ─────────────────────────────────────────────

export function getVariableItems(): ConfigNode[] {
  const config = getConfig();
  return [
    { type: "configVar" as const, key: "installDir", value: config.installDir, configured: !!config.installDir },
    { type: "configVar" as const, key: "buildDir", value: config.buildDir, configured: !!config.buildDir },
    { type: "configVar" as const, key: "buildCommand", value: config.buildCommand, configured: !!config.buildCommand },
    { type: "configVar" as const, key: "rebuildCommand", value: config.rebuildCommand, configured: !!config.rebuildCommand },
    { type: "configVar" as const, key: "autoSync", value: String(config.autoSync), configured: true },
    { type: "configVar" as const, key: "debugAdapter", value: config.debugAdapter, configured: true },
    { type: "configVar" as const, key: "mtrArgs", value: config.mtrArgs || "--force --retry=0", configured: !!config.mtrArgs },
  ];
}

export function getTestActionItems(): TestNode[] {
  const config = getConfig();
  const hasInstallDir = !!config.installDir;
  const hasTestFile = !!getCurrentTestName();

  const reason = !hasInstallDir ? "installDir not configured" : !hasTestFile ? "no test file selected" : undefined;

  return [
    { type: "testAction" as const, label: "Sync and Run Test", command: hasInstallDir && hasTestFile ? "mysql-test.runTestFromFile" : undefined, icon: "play", reason },
    { type: "testAction" as const, label: "Run & Record", command: hasInstallDir && hasTestFile ? "mysql-test.runTestWithRecord" : undefined, icon: "record", reason },
    { type: "testAction" as const, label: "Incremental Build", command: hasInstallDir ? "mysql-test.incrementalBuild" : undefined, icon: "refresh", reason: hasInstallDir ? undefined : reason },
    { type: "testAction" as const, label: "Full Rebuild", command: hasInstallDir ? "mysql-test.fullRebuild" : undefined, icon: "tools", reason: hasInstallDir ? undefined : reason },
    { type: "testAction" as const, label: "Sync Suite", command: hasInstallDir && hasTestFile ? "mysql-test.syncSuite" : undefined, icon: "file-symlink-file", reason },
  ];
}

// ─── Helpers ────────────────────────────────────────────────────────────

function getOpenedTestCases(): TestNode[] {
  const cases: TestNode[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const fsPath = tab.input instanceof vscode.TabInputText ? tab.input.uri.fsPath : "";
      if (fsPath.endsWith(".test")) {
        const name = deriveTestName(fsPath) || path.basename(fsPath);
        cases.push({ type: "openedCase" as const, name, uri: fsPath });
      }
    }
  }
  return cases;
}

function getCurrentTestName(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  const fsPath = editor.document.uri.fsPath;

  // If viewing a log file from a previous run, show the associated test name
  const historyEntry = runHistory.find(e => e.logFile === fsPath);
  if (historyEntry) return historyEntry.testName;

  // Prefer full MTR test name (e.g. "main.alias")
  const mtrName = deriveTestName(fsPath);
  if (mtrName) return mtrName;
  // Fallback: show filename for any .test/.inc file
  if (fsPath.endsWith(".test") || fsPath.endsWith(".inc")) {
    return path.basename(fsPath);
  }
  return undefined;
}

export function getHistoryIcon(status: RunHistoryEntry["status"]): string {
  switch (status) {
    case "pass": return "check-circle";
    case "fail": return "error-circle";
    case "running": return "sync~spin";
    case "skip": return "circle-slash";
  }
}

export function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ─── Command Handlers (Build / Sync / Run) ────────────────────────────

async function incrementalBuild(): Promise<void> {
  const config = getConfig();
  if (!config.buildCommand) {
    vscode.window.showWarningMessage("buildCommand is not configured.");
    return;
  }
  const cwd = config.buildDir || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!cwd) return;

  const output = getOutputChannel();
  output.show(true);
  output.appendLine(`[build] Incremental build: ${config.buildCommand}`);
  output.appendLine(`[build] cwd: ${cwd}\n`);

  const { spawn } = await import("child_process");
  const shell = process.env.SHELL ?? "/bin/sh";
  const proc = spawn(shell, ["-c", config.buildCommand], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });

  proc.stdout.on("data", (data: Buffer) => output.appendLine(data.toString().trimEnd()));
  proc.stderr.on("data", (data: Buffer) => output.appendLine(data.toString().trimEnd()));
  proc.on("error", (err) => {
    output.appendLine(`[build] Error: ${err.message}`);
    vscode.window.showErrorMessage(`Build failed: ${err.message}`);
  });
  proc.on("close", (code) => {
    output.appendLine(`\n[build] Exited with code ${code}`);
    if (code === 0) {
      vscode.window.showInformationMessage("Build completed.");
    } else {
      vscode.window.showErrorMessage(`Build failed (exit code ${code}).`);
    }
  });
}

async function fullRebuild(): Promise<void> {
  const config = getConfig();
  if (!config.rebuildCommand) {
    vscode.window.showWarningMessage("rebuildCommand is not configured.");
    return;
  }
  const cwd = config.buildDir || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!cwd) return;

  const output = getOutputChannel();
  output.show(true);
  output.appendLine(`[build] Full rebuild: ${config.rebuildCommand}`);
  output.appendLine(`[build] cwd: ${cwd}\n`);

  const { spawn } = await import("child_process");
  const shell = process.env.SHELL ?? "/bin/sh";
  const proc = spawn(shell, ["-c", config.rebuildCommand], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });

  proc.stdout.on("data", (data: Buffer) => output.appendLine(data.toString().trimEnd()));
  proc.stderr.on("data", (data: Buffer) => output.appendLine(data.toString().trimEnd()));
  proc.on("error", (err) => {
    output.appendLine(`[build] Error: ${err.message}`);
    vscode.window.showErrorMessage(`Rebuild failed: ${err.message}`);
  });
  proc.on("close", (code) => {
    output.appendLine(`\n[build] Exited with code ${code}`);
    if (code === 0) {
      vscode.window.showInformationMessage("Full rebuild completed.");
    } else {
      vscode.window.showErrorMessage(`Rebuild failed (exit code ${code}).`);
    }
  });
}

async function syncSuite(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active editor.");
    return;
  }
  const fsPath = editor.document.uri.fsPath;
  const testName = deriveTestName(fsPath);
  if (!testName) {
    vscode.window.showWarningMessage("Cannot determine test suite from current file.");
    return;
  }
  const config = getConfig();
  if (!config.installDir) {
    vscode.window.showWarningMessage("installDir is not configured.");
    return;
  }
  const sourceRoots = getSourceRoots();
  const output = getOutputChannel();
  output.show(true);

  // Determine suite name and source/install paths
  const suiteName = testName.includes(".") ? testName.substring(0, testName.indexOf(".")) : "main";
  let srcDir: string | undefined;
  if (suiteName === "main") {
    // Main suite: only sync t/, r/, include/ subdirectories
    for (const root of sourceRoots) {
      const p = path.join(root, "mysql-test");
      if (fs.existsSync(p)) { srcDir = p; break; }
    }
    if (srcDir) {
      // Delete and copy each subdirectory separately
      for (const sub of ["t", "r", "include"]) {
        const subSrc = path.join(srcDir, sub);
        const subDst = path.join(config.installDir, "mysql-test", sub);
        if (!fs.existsSync(subSrc)) continue;
        if (fs.existsSync(subDst)) {
          fs.rmSync(subDst, { recursive: true, force: true });
          output.appendLine(`[sync] Removed: ${subDst}`);
        }
        copyDirRecursive(subSrc, subDst);
        output.appendLine(`[sync] Copied: ${subSrc} -> ${subDst}`);
      }
      vscode.window.showInformationMessage(`Suite "main" synced.`);
      return;
    }
  } else {
    // Named suite: sync suite/<name>/
    const dstDir = path.join(config.installDir, "mysql-test", "suite", suiteName);
    for (const root of sourceRoots) {
      const p = path.join(root, "mysql-test", "suite", suiteName);
      if (fs.existsSync(p)) { srcDir = p; break; }
    }

    if (!srcDir) {
      output.appendLine(`[sync] Source suite not found: ${suiteName}`);
      vscode.window.showErrorMessage(`Source suite not found: ${suiteName}`);
      return;
    }

    output.appendLine(`[sync] Suite: ${suiteName}`);
    output.appendLine(`[sync] From: ${srcDir}`);
    output.appendLine(`[sync] To: ${dstDir}`);

    try {
      if (fs.existsSync(dstDir)) {
        fs.rmSync(dstDir, { recursive: true, force: true });
        output.appendLine(`[sync] Removed: ${dstDir}`);
      }
      copyDirRecursive(srcDir, dstDir);
      output.appendLine(`[sync] Copied: ${srcDir} -> ${dstDir}`);
      vscode.window.showInformationMessage(`Suite "${suiteName}" synced.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      output.appendLine(`[sync] Error: ${msg}`);
      vscode.window.showErrorMessage(`Sync failed: ${msg}`);
    }
  }
}

function copyDirRecursive(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

// ─── Activation ─────────────────────────────────────────────────────────

export function activateTreeView(context: vscode.ExtensionContext): void {
  const configProvider = new ConfigurationProvider();
  const testProvider = new CurrentTestProvider();

  const configView = vscode.window.createTreeView("mysql-test-configuration", {
    treeDataProvider: configProvider,
    showCollapseAll: false,
  });
  const testView = vscode.window.createTreeView("mysql-test-current", {
    treeDataProvider: testProvider,
    showCollapseAll: true,
  });

  context.subscriptions.push(configView, testView);

  // Refresh on active editor change (only affects Current Test)
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => _onTestChange.fire(undefined)),
    vscode.window.tabGroups.onDidChangeTabs(() => _onTestChange.fire(undefined))
  );

  // Refresh on configuration change (affects both)
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration("mysql-test")) {
        _onConfigChange.fire(undefined);
        _onTestChange.fire(undefined);
      }
    })
  );

  // ── Config item click → open workspace settings.json in editor tab ──

  context.subscriptions.push(
    vscode.commands.registerCommand("mysql-test.treeConfigItemClick", async (key: string) => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) return;
      const settingsPath = vscode.Uri.joinPath(folder.uri, ".vscode", "settings.json");

      // Ensure file exists
      if (!fs.existsSync(settingsPath.fsPath)) {
        fs.mkdirSync(path.join(folder.uri.fsPath, ".vscode"), { recursive: true });
        fs.writeFileSync(settingsPath.fsPath, "{}", "utf-8");
      }

      const settingsKey = `mysql-test.${key}`;
      const content = fs.readFileSync(settingsPath.fsPath, "utf-8");
      const json = JSON.parse(content || "{}");

      // Add key with default value if missing
      if (!(settingsKey in json)) {
        const defaultValue = vscode.workspace.getConfiguration("mysql-test").inspect(key)?.defaultValue;
        json[settingsKey] = defaultValue ?? "";
        fs.writeFileSync(settingsPath.fsPath, JSON.stringify(json, null, 2) + "\n", "utf-8");
      }

      const doc = await vscode.workspace.openTextDocument(settingsPath);
      const editor = await vscode.window.showTextDocument(doc, { preview: false });

      // Find the key in the document and select its value
      const text = doc.getText();
      const pattern = new RegExp(`"${settingsKey.replace(".", "\\.")}"\\s*:\\s*""`);
      const match = pattern.exec(text);
      if (match) {
        const startPos = doc.positionAt(match.index + match[0].indexOf('""') + 1);
        editor.selection = new vscode.Selection(startPos, startPos);
        editor.revealRange(new vscode.Range(startPos, startPos));
      }
    })
  );

  // ── Current Test: name click → single=confirm, double=run ──

  context.subscriptions.push(
    vscode.commands.registerCommand("mysql-test.treeRunTest", (testName: string) => {
      withClickTiming(`run:${testName}`,
        async () => {
          const yes = await vscode.window.showWarningMessage(`Run ${testName}?`, { modal: true }, "Run");
          if (yes === "Run") vscode.commands.executeCommand("mysql-test.runTestFromFile", testName);
        },
        () => {
          vscode.commands.executeCommand("mysql-test.runTestFromFile", testName);
        }
      );
    })
  );

  // ── Test Action click: single=confirm, double=execute ──

  context.subscriptions.push(
    vscode.commands.registerCommand("mysql-test.treeExecuteTestAction", (arg: { label: string; command: string }) => {
      withClickTiming(`action:${arg.command}`,
        async () => {
          const yes = await vscode.window.showWarningMessage(`Execute "${arg.label}"?`, { modal: true }, "Run");
          if (yes === "Run") vscode.commands.executeCommand(arg.command);
        },
        () => {
          vscode.commands.executeCommand(arg.command);
        }
      );
    })
  );

  // ── Disabled action click → show warning ──

  context.subscriptions.push(
    vscode.commands.registerCommand("mysql-test.treeActionDisabled", (reason: string) => {
      vscode.window.showWarningMessage(`Cannot execute: ${reason}`);
    })
  );

  // ── Built-in action commands ──

  context.subscriptions.push(
    vscode.commands.registerCommand("mysql-test.incrementalBuild", incrementalBuild)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("mysql-test.fullRebuild", fullRebuild)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("mysql-test.syncSuite", syncSuite)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("mysql-test.runTestWithRecord", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("No active editor.");
        return;
      }
      const testName = deriveTestName(editor.document.uri.fsPath);
      if (!testName) {
        vscode.window.showWarningMessage("Cannot derive test name from current file.");
        return;
      }
      await vscode.commands.executeCommand("mysql-test.runTestFromFile", testName, true);
    })
  );
}
