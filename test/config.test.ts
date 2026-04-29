import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock vscode module before importing config
vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((key: string, defaultValue: string) => {
        const mockValues: Record<string, string> = {
          "installDir": "/workspace/installDir",
          "buildDir": "/workspace/build-Debug",
          "buildCommand": "make install",
          "rebuildCommand": "cmake .. && make install",
        };
        return mockValues[key] ?? defaultValue;
      }),
    })),
    workspaceFolders: [
      { uri: { fsPath: "/workspace" } },
    ],
  },
}));

// Mock process.env
const originalEnv = process.env;

import { resolveVariables, getConfig, getMtrPath } from "../src/config";

describe("resolveVariables", () => {
  it("should resolve ${workspaceFolder}", () => {
    expect(resolveVariables("${workspaceFolder}/installDir")).toBe("/workspace/installDir");
  });

  it("should resolve ${workspaceFolderBasename}", () => {
    expect(resolveVariables("${workspaceFolderBasename}/build")).toBe("workspace/build");
  });

  it("should resolve ${env:NAME}", () => {
    process.env.TEST_VAR = "/custom/path";
    expect(resolveVariables("${env:TEST_VAR}/sub")).toBe("/custom/path/sub");
    delete process.env.TEST_VAR;
  });

  it("should resolve ${mysqlInstallDir} when installDir is provided", () => {
    expect(resolveVariables("${mysqlInstallDir}/mysql-test/mtr", "/workspace/installDir"))
      .toBe("/workspace/installDir/mysql-test/mtr");
  });

  it("should leave ${mysqlInstallDir} as-is when installDir is empty", () => {
    expect(resolveVariables("${mysqlInstallDir}/mysql-test/mtr", ""))
      .toBe("/mysql-test/mtr");
  });

  it("should resolve multiple variables in one string", () => {
    expect(resolveVariables("${workspaceFolder}/build/${env:USER}"))
      .toBe(`/workspace/build/${originalEnv.USER}`);
  });

  it("should return empty string as-is", () => {
    expect(resolveVariables("")).toBe("");
  });

  it("should return string without variables as-is", () => {
    expect(resolveVariables("/absolute/path/to/dir")).toBe("/absolute/path/to/dir");
  });

  it("should leave unknown env variables as-is", () => {
    expect(resolveVariables("${UNKNOWN_VAR_12345}")).toBe("${UNKNOWN_VAR_12345}");
  });
});

describe("getConfig", () => {
  it("should resolve installDir with workspace variable", () => {
    const config = getConfig();
    expect(config.installDir).toBe("/workspace/installDir");
  });

  it("should resolve buildDir", () => {
    const config = getConfig();
    expect(config.buildDir).toBe("/workspace/build-Debug");
  });

  it("should resolve buildCommand", () => {
    const config = getConfig();
    expect(config.buildCommand).toBe("make install");
  });

  it("should resolve rebuildCommand", () => {
    const config = getConfig();
    expect(config.rebuildCommand).toBe("cmake .. && make install");
  });

  it("should have correct defaults for boolean and enum", () => {
    const config = getConfig();
    expect(config.autoSync).toBe(true);
    expect(config.debugAdapter).toBe("auto");
  });
});

describe("getMtrPath", () => {
  it("should derive mtr path from installDir", () => {
    expect(getMtrPath("/workspace/installDir"))
      .toBe("/workspace/installDir/mysql-test/mtr");
  });

  it("should handle trailing slash in installDir", () => {
    const path = require("path") as typeof import("path");
    expect(getMtrPath("/workspace/installDir/"))
      .toBe(path.join("/workspace/installDir/", "mysql-test", "mtr"));
  });
});
