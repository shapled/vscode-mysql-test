import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { getCompletions } from "../src/features/completion-logic";

describe("MtrCompletionProvider", () => {
  let tmpDir: string;
  let mysqlTestRoot: string;

  function createFile(relativePath: string): void {
    const full = path.join(mysqlTestRoot, relativePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, "");
  }

  function createDir(relativePath: string): void {
    fs.mkdirSync(path.join(mysqlTestRoot, relativePath), { recursive: true });
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mtr-completion-"));
    mysqlTestRoot = path.join(tmpDir, "mysql-test");
    createDir("");

    // include/ with .inc and .sql files
    createFile("include/have_debug.inc");
    createFile("include/have_debug_sync.inc");
    createFile("include/have_innodb.inc");
    createFile("include/master-slave.inc");
    createFile("include/assert.inc");
    createFile("include/start_slave.inc");
    createFile("include/init.sql");

    // extra/ with nested subfolder
    createDir("extra/rpl_tests");
    createFile("extra/rpl_tests/rpl_row_basic.inc");
    createFile("extra/rpl_tests/rpl_reset_slave.inc");

    // suite/rpl/ with local include
    createDir("suite/rpl/t");
    createDir("suite/rpl/include");
    createFile("suite/rpl/include/rpl_connection.inc");

    // t/ with .test files
    createDir("t");
    createFile("t/big_packets.test");
    createFile("t/alias.test");

    // Unrelated file type — should NOT appear
    createFile("include/README.txt");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function labels(lineText: string): string[] {
    return getCompletions(
      path.join(mysqlTestRoot, "t/alias.test"),
      lineText,
      lineText.length
    ).map((e) => e.label);
  }

  function labelsFrom(file: string, lineText: string): string[] {
    return getCompletions(
      path.join(mysqlTestRoot, file),
      lineText,
      lineText.length
    ).map((e) => e.label);
  }

  // ── No trigger context ──

  it("should return empty for lines without --source/--include", () => {
    expect(labels("SELECT 1;")).toEqual([]);
  });

  it("should return empty for comment lines", () => {
    expect(labels("# --source include/have_debug.inc")).toEqual([]);
  });

  // ── Prefix matching at root level ──

  it("should list directories matching prefix from mysql-test root", () => {
    const result = labels("--source in");
    // "in" matches "include/" directory at root level
    expect(result).toContain("include/");
    // "in" does NOT match files inside include/ (need "include/" prefix first)
    expect(result).not.toContain("init.sql");
  });

  // ── Deep path filtering ──

  it("should complete files inside a known directory with prefix filter", () => {
    const result = labels("--source include/have_d");
    expect(result).toContain("have_debug.inc");
    expect(result).toContain("have_debug_sync.inc");
    expect(result).not.toContain("assert.inc");
    expect(result).not.toContain("master-slave.inc");
  });

  it("should list all files when directory path ends with /", () => {
    const result = labels("--source include/");
    expect(result).toContain("have_debug.inc");
    expect(result).toContain("have_debug_sync.inc");
    expect(result).toContain("assert.inc");
    expect(result).toContain("master-slave.inc");
    expect(result).toContain("start_slave.inc");
    expect(result).toContain("init.sql");
  });

  // ── Relative paths (./) ──

  it("should complete relative to current file directory for ./ prefix", () => {
    const result = labels("--source ./");
    expect(result).toContain("big_packets.test");
    expect(result).toContain("alias.test");
  });

  it("should filter relative path by prefix", () => {
    const result = labels("--source ./big");
    expect(result).toContain("big_packets.test");
    expect(result).not.toContain("alias.test");
  });

  // ── Relative paths (../) ──

  it("should complete parent directory contents for ../ prefix", () => {
    const result = labels("--source ../include/have_d");
    expect(result).toContain("have_debug.inc");
    expect(result).toContain("have_debug_sync.inc");
  });

  // ── Suite-relative paths ──

  it("should complete suite-local include directory from root", () => {
    const result = labelsFrom(
      "suite/rpl/t/rpl_test.test",
      "--source suite/rpl/include/r"
    );
    expect(result).toContain("rpl_connection.inc");
  });

  // ── No-prefix variant (source without --) ──

  it("should trigger for 'source' without -- prefix", () => {
    const result = labels("source include/have_d");
    expect(result).toContain("have_debug.inc");
    expect(result).toContain("have_debug_sync.inc");
  });

  // ── Unrelated file types filtered out ──

  it("should NOT show .txt files in completions", () => {
    const result = labels("--source include/R");
    expect(result).not.toContain("README.txt");
  });

  // ── Directory completion ──

  it("should show directories with trailing slash for deeper navigation", () => {
    const result = labels("--source extra/");
    expect(result).toContain("rpl_tests/");
  });
});
