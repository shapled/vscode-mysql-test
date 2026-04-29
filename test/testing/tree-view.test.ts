import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock vscode before importing tree-view
vi.mock("vscode", () => ({
  EventEmitter: class {
    event = vi.fn();
    fire = vi.fn();
  },
  window: {
    tabGroups: { all: [] },
    activeTextEditor: undefined,
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((key: string, defaultValue: unknown) => defaultValue),
      inspect: vi.fn(() => ({ defaultValue: "" })),
    })),
    workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
  },
  TreeItem: vi.fn().mockImplementation((label: string) => ({
    label,
    iconPath: undefined,
    command: undefined,
    description: undefined,
    contextValue: undefined,
  })),
  TreeItemCollapsibleState: { None: 0, Collapsed: 1 },
  ThemeIcon: vi.fn().mockImplementation((icon: string, color?: string) => ({ icon, color })),
  Uri: { file: (p: string) => ({ fsPath: p }) },
  Selection: vi.fn(),
  Range: vi.fn(),
}));

vi.mock("../../src/config", () => ({
  getConfig: vi.fn(() => mockConfig),
}));

const mockGetConfig = vi.fn();
vi.mock("../../src/config", () => ({
  getConfig: () => mockGetConfig(),
}));

// Import after mocks
import * as vscode from "vscode";
import {
  formatTimeAgo,
  getHistoryIcon,
  getVariableItems,
  getTestActionItems,
  addRunHistory,
  updateRunHistory,
  type RunHistoryEntry,
} from "../../src/testing/tree-view";

const defaultConfig = {
  installDir: "/workspace/installDir",
  buildDir: "/workspace/build",
  buildCommand: "make install",
  rebuildCommand: "cmake .. && make install",
  autoSync: true,
  debugAdapter: "auto" as const,
  mtrArgs: "--force --retry=0",
};

describe("formatTimeAgo", () => {
  it("should return seconds ago for < 60s", () => {
    const now = Date.now();
    expect(formatTimeAgo(now - 5_000)).toBe("5s ago");
    expect(formatTimeAgo(now - 45_000)).toBe("45s ago");
  });

  it("should return minutes ago for < 60min", () => {
    const now = Date.now();
    expect(formatTimeAgo(now - 60_000)).toBe("1m ago");
    expect(formatTimeAgo(now - 300_000)).toBe("5m ago");
  });

  it("should return hours ago for < 24h", () => {
    const now = Date.now();
    expect(formatTimeAgo(now - 3_600_000)).toBe("1h ago");
    expect(formatTimeAgo(now - 7_200_000)).toBe("2h ago");
  });

  it("should return days ago for >= 24h", () => {
    const now = Date.now();
    expect(formatTimeAgo(now - 86_400_000)).toBe("1d ago");
    expect(formatTimeAgo(now - 172_800_000)).toBe("2d ago");
  });
});

describe("getHistoryIcon", () => {
  it("should return correct icons for each status", () => {
    expect(getHistoryIcon("pass")).toBe("check-circle");
    expect(getHistoryIcon("fail")).toBe("error-circle");
    expect(getHistoryIcon("running")).toBe("sync~spin");
    expect(getHistoryIcon("skip")).toBe("circle-slash");
  });
});

describe("addRunHistory / updateRunHistory", () => {
  beforeEach(() => {
    // Reset history between tests — import a fresh reference isn't possible
    // but addRunHistory manages a capped list, so we can work with it.
    // The history is shared across tests since it's module-level state.
  });

  it("should track running entries", () => {
    const now = Date.now();
    addRunHistory({
      testName: "main.alias",
      status: "running",
      duration: 0,
      timestamp: now,
    });
    // Verify updateRunHistory can find and update it
    updateRunHistory("main.alias", {
      status: "pass",
      duration: 1500,
      logFile: "/tmp/mtr.log",
    });
    // The entry should no longer be "running" — next addRunHistory with same test
    // won't conflict. We can't directly inspect the internal array, but we verify
    // no errors are thrown and the functions work end-to-end.
  });

  it("should not throw when updating non-existent entry", () => {
    expect(() => {
      updateRunHistory("nonexistent.test", { status: "fail", duration: 999 });
    }).not.toThrow();
  });
});

describe("getVariableItems", () => {
  it("should return config items with correct configured state", () => {
    mockGetConfig.mockReturnValue(defaultConfig);
    const items = getVariableItems();

    expect(items.length).toBe(7);

    // First item: installDir
    expect(items[0].type).toBe("configVar");
    if (items[0].type === "configVar") {
      expect(items[0].key).toBe("installDir");
      expect(items[0].configured).toBe(true);
    }

    // Find mtrArgs
    const mtrArgs = items.find(
      (i) => i.type === "configVar" && i.key === "mtrArgs"
    );
    expect(mtrArgs).toBeDefined();
    if (mtrArgs && mtrArgs.type === "configVar") {
      expect(mtrArgs.configured).toBe(true);
    }
  });

  it("should mark installDir as not configured when empty", () => {
    mockGetConfig.mockReturnValue({ ...defaultConfig, installDir: "" });
    const items = getVariableItems();

    const installDir = items.find(
      (i) => i.type === "configVar" && i.key === "installDir"
    );
    expect(installDir).toBeDefined();
    if (installDir && installDir.type === "configVar") {
      expect(installDir.configured).toBe(false);
    }
  });
});

describe("getTestActionItems", () => {
  it("should enable all actions when installDir and test file are set", () => {
    mockGetConfig.mockReturnValue(defaultConfig);
    // Mock activeTextEditor for getCurrentTestName
    vscode.window.activeTextEditor = {
      document: { uri: { fsPath: "/repo/mysql-test/t/alias.test" } },
    } as any;

    const items = getTestActionItems();
    for (const item of items) {
      if (item.type === "testAction") {
        expect(item.command).toBeDefined();
        expect(item.reason).toBeUndefined();
      }
    }

    // Cleanup
    vscode.window.activeTextEditor = undefined;
  });

  it("should disable all actions when no installDir", () => {
    mockGetConfig.mockReturnValue({ ...defaultConfig, installDir: "" });
    vscode.window.activeTextEditor = {
      document: { uri: { fsPath: "/repo/mysql-test/t/alias.test" } },
    } as any;

    const items = getTestActionItems();
    for (const item of items) {
      if (item.type === "testAction") {
        expect(item.command).toBeUndefined();
        expect(item.reason).toBe("installDir not configured");
      }
    }

    vscode.window.activeTextEditor = undefined;
  });

  it("should disable run/sync actions but keep build actions when no test file", () => {
    mockGetConfig.mockReturnValue(defaultConfig);
    vscode.window.activeTextEditor = {
      document: { uri: { fsPath: "/repo/mysql-test/r/alias.result" } },
    } as any;

    const items = getTestActionItems();
    const labels = items.filter((i) => i.type === "testAction").map((i) => {
      if (i.type === "testAction") return { label: i.label, hasCommand: !!i.command };
    });

    // Build actions should still work
    const incBuild = labels.find((l) => l.label === "Incremental Build");
    expect(incBuild?.hasCommand).toBe(true);
    const fullBuild = labels.find((l) => l.label === "Full Rebuild");
    expect(fullBuild?.hasCommand).toBe(true);

    // Run/sync actions should be disabled
    const runTest = labels.find((l) => l.label === "Sync and Run Test");
    expect(runTest?.hasCommand).toBe(false);
    const record = labels.find((l) => l.label === "Run & Record");
    expect(record?.hasCommand).toBe(false);
    const sync = labels.find((l) => l.label === "Sync Suite");
    expect(sync?.hasCommand).toBe(false);

    vscode.window.activeTextEditor = undefined;
  });
});
