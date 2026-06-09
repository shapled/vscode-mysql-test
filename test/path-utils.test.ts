import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  findMysqlTestRoot,
  pairTestResultPath,
  pairSuffixFileToTest,
  resolveIncPathString,
  deriveTestName,
  scanSuites,
} from "../src/utils/path-utils";

describe("findMysqlTestRoot", () => {
  it("should find root from top-level t/ file", () => {
    const result = findMysqlTestRoot(
      "/project/mysql-test/t/alias.test"
    );
    expect(result).toBe("/project/mysql-test");
  });

  it("should find root from top-level r/ file", () => {
    const result = findMysqlTestRoot(
      "/project/mysql-test/r/alias.result"
    );
    expect(result).toBe("/project/mysql-test");
  });

  it("should find root from nested suite t/ file", () => {
    const result = findMysqlTestRoot(
      "/project/mysql-test/suite/innodb/t/wl6742.test"
    );
    expect(result).toBe("/project/mysql-test");
  });

  it("should find root from deeply nested suite", () => {
    const result = findMysqlTestRoot(
      "/project/mysql-test/suite/aaa/bbb/t/ccc.test"
    );
    expect(result).toBe("/project/mysql-test");
  });

  it("should find root from include/ file", () => {
    const result = findMysqlTestRoot(
      "/project/mysql-test/include/assert.inc"
    );
    expect(result).toBe("/project/mysql-test");
  });

  it("should return undefined for non-mysql-test paths", () => {
    const result = findMysqlTestRoot(
      "/other-project/t/alias.test"
    );
    expect(result).toBeUndefined();
  });

  it("should find root from Windows path", () => {
    const result = findMysqlTestRoot(
      "C:\\project\\mysql-test\\t\\alias.test"
    );
    expect(result).toContain("mysql-test");
    expect(result).toContain("project");
  });

  it("should find root from Windows UNC path", () => {
    const result = findMysqlTestRoot(
      "\\\\wsl$\\Ubuntu\\home\\user\\mysql-test\\t\\alias.test"
    );
    expect(result).toContain("mysql-test");
    expect(result).toContain("wsl$");
  });
});

describe("pairTestResultPath", () => {
  it("should pair top-level .test to .result", () => {
    const result = pairTestResultPath(
      "/project/mysql-test/t/alias.test"
    );
    expect(result).toBe("/project/mysql-test/r/alias.result");
  });

  it("should pair top-level .result to .test", () => {
    const result = pairTestResultPath(
      "/project/mysql-test/r/alias.result"
    );
    expect(result).toBe("/project/mysql-test/t/alias.test");
  });

  it("should pair nested suite .test to .result", () => {
    const result = pairTestResultPath(
      "/project/mysql-test/suite/innodb/t/wl6742.test"
    );
    expect(result).toBe(
      "/project/mysql-test/suite/innodb/r/wl6742.result"
    );
  });

  it("should pair nested suite .result to .test", () => {
    const result = pairTestResultPath(
      "/project/mysql-test/suite/innodb/r/wl6742.result"
    );
    expect(result).toBe(
      "/project/mysql-test/suite/innodb/t/wl6742.test"
    );
  });

  it("should return undefined for non-test/result files", () => {
    expect(
      pairTestResultPath("/project/mysql-test/t/alias.opt")
    ).toBeUndefined();
    expect(
      pairTestResultPath("/project/mysql-test/include/alias.inc")
    ).toBeUndefined();
  });

  it("should pair Windows path .test to .result", () => {
    expect(
      pairTestResultPath("C:\\project\\mysql-test\\t\\alias.test")
    ).toBe("C:/project/mysql-test/r/alias.result");
  });

  it("should pair Windows path .result to .test", () => {
    expect(
      pairTestResultPath("C:\\project\\mysql-test\\r\\alias.result")
    ).toBe("C:/project/mysql-test/t/alias.test");
  });

  it("should pair Windows nested suite .test to .result", () => {
    expect(
      pairTestResultPath(
        "C:\\project\\mysql-test\\suite\\innodb\\t\\wl6742.test"
      )
    ).toBe("C:/project/mysql-test/suite/innodb/r/wl6742.result");
  });
});

describe("pairSuffixFileToTest", () => {
  it("should pair .opt to .test", () => {
    expect(
      pairSuffixFileToTest(
        "/project/mysql-test/t/alias.opt",
        "opt"
      )
    ).toBe("/project/mysql-test/t/alias.test");
  });

  it("should pair .cnf to .test", () => {
    expect(
      pairSuffixFileToTest(
        "/project/mysql-test/t/alias.cnf",
        "cnf"
      )
    ).toBe("/project/mysql-test/t/alias.test");
  });

  it("should pair -master.opt to .test (strip suffix)", () => {
    expect(
      pairSuffixFileToTest(
        "/project/mysql-test/t/auth_rpl-master.opt",
        "opt"
      )
    ).toBe("/project/mysql-test/t/auth_rpl.test");
  });

  it("should pair -slave.opt to .test (strip suffix)", () => {
    expect(
      pairSuffixFileToTest(
        "/project/mysql-test/t/auth_rpl-slave.opt",
        "opt"
      )
    ).toBe("/project/mysql-test/t/auth_rpl.test");
  });

  it("should pair -master.cnf to .test (strip suffix)", () => {
    expect(
      pairSuffixFileToTest(
        "/project/mysql-test/t/alter_table-master.cnf",
        "cnf"
      )
    ).toBe("/project/mysql-test/t/alter_table.test");
  });

  it("should pair nested suite .opt to .test", () => {
    expect(
      pairSuffixFileToTest(
        "/project/mysql-test/suite/innodb/t/wl6742.opt",
        "opt"
      )
    ).toBe(
      "/project/mysql-test/suite/innodb/t/wl6742.test"
    );
  });

  it("should return undefined for non-matching files", () => {
    expect(
      pairSuffixFileToTest(
        "/project/mysql-test/t/alias.test",
        "opt"
      )
    ).toBeUndefined();
  });

  it("should return undefined for files not in t/", () => {
    expect(
      pairSuffixFileToTest(
        "/project/mysql-test/include/default.cnf",
        "cnf"
      )
    ).toBeUndefined();
  });

  it("should pair Windows -master.opt to .test (strip suffix)", () => {
    expect(
      pairSuffixFileToTest(
        "C:\\project\\mysql-test\\t\\auth_rpl-master.opt",
        "opt"
      )
    ).toBe("C:/project/mysql-test/t/auth_rpl.test");
  });
});

describe("resolveIncPathString", () => {
  it("should resolve include path relative to mysql-test root", () => {
    expect(
      resolveIncPathString(
        "/project/mysql-test/t/alias.test",
        "include/assert.inc"
      )
    ).toBe("/project/mysql-test/include/assert.inc");
  });

  it("should NOT append .inc when path has no extension", () => {
    expect(
      resolveIncPathString(
        "/project/mysql-test/t/alias.test",
        "include/assert"
      )
    ).toBe("/project/mysql-test/include/assert");
  });

  it("should resolve from nested suite file", () => {
    expect(
      resolveIncPathString(
        "/project/mysql-test/suite/innodb/t/wl6742.test",
        "include/have_innodb.inc"
      )
    ).toBe("/project/mysql-test/include/have_innodb.inc");
  });

  it("should return undefined for non-mysql-test files", () => {
    expect(
      resolveIncPathString(
        "/other-project/t/alias.test",
        "include/assert.inc"
      )
    ).toBeUndefined();
  });

  it("should resolve suite-local include paths", () => {
    expect(
      resolveIncPathString(
        "/project/mysql-test/suite/innodb/t/wl6742.test",
        "suite/innodb/include/innodb_lock_wait_timeout.inc"
      )
    ).toBe(
      "/project/mysql-test/suite/innodb/include/innodb_lock_wait_timeout.inc"
    );
  });

  it("should resolve ../include relative to current file directory", () => {
    expect(
      resolveIncPathString(
        "/project/mysql-test/suite/binlog/t/binlog_edge.test",
        "../include/binlog_edge_common.inc"
      )
    ).toBe(
      "/project/mysql-test/suite/binlog/include/binlog_edge_common.inc"
    );
  });

  it("should resolve ../../include from deeply nested files", () => {
    expect(
      resolveIncPathString(
        "/project/mysql-test/suite/aaa/bbb/t/ccc.test",
        "../../include/common.inc"
      )
    ).toBe(
      "/project/mysql-test/suite/aaa/include/common.inc"
    );
  });

  it("should resolve ./ relative to current file directory", () => {
    expect(
      resolveIncPathString(
        "/project/mysql-test/t/big_packets.test",
        "./big_packets.inc"
      )
    ).toBe("/project/mysql-test/t/big_packets.inc");
  });

  it("should NOT append .inc when path already has .test extension", () => {
    expect(
      resolveIncPathString(
        "/project/mysql-test/suite/rpl/t/rpl_xa_survive_disconnect_lsu_off.test",
        "./rpl_xa_survive_disconnect.test"
      )
    ).toBe(
      "/project/mysql-test/suite/rpl/t/rpl_xa_survive_disconnect.test"
    );
  });

  it("should NOT append .inc when path already has .sql extension", () => {
    expect(
      resolveIncPathString(
        "/project/mysql-test/t/big_packets.test",
        "./init.sql"
      )
    ).toBe("/project/mysql-test/t/init.sql");
  });
});

describe("deriveTestName", () => {
  it("should derive main suite test name", () => {
    expect(deriveTestName("/repo/mysql-test/t/alias.test")).toBe("main.alias");
  });

  it("should derive top-level suite test name", () => {
    expect(deriveTestName("/repo/mysql-test/suite/innodb/t/lock.test")).toBe("innodb.lock");
  });

  it("should derive nested suite test name", () => {
    expect(deriveTestName("/repo/mysql-test/suite/starsql/rpl/t/my_test.test")).toBe("starsql/rpl.my_test");
  });

  it("should return undefined for non-test file", () => {
    expect(deriveTestName("/repo/mysql-test/t/alias.result")).toBeUndefined();
  });

  it("should return undefined for path outside mysql-test", () => {
    expect(deriveTestName("/other/file.test")).toBeUndefined();
  });

  it("should return undefined for suite without t/ directory", () => {
    expect(deriveTestName("/repo/mysql-test/suite/innodb/lock.test")).toBeUndefined();
  });
});

describe("scanSuites", () => {
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");
  const os = require("os") as typeof import("os");

  let tmpDir: string;

  function createSuite(base: string, suitePath: string): void {
    const dir = path.join(base, "mysql-test", suitePath, "t");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "dummy.test"), "");
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mtr-suites-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should return empty list when no mysql-test directory", () => {
    expect(scanSuites(tmpDir)).toEqual([]);
  });

  it("should detect main suite", () => {
    createSuite(tmpDir, "");
    expect(scanSuites(tmpDir)).toEqual(["main"]);
  });

  it("should detect top-level suites", () => {
    createSuite(tmpDir, "");
    createSuite(tmpDir, "suite/innodb");
    createSuite(tmpDir, "suite/rpl");
    expect(scanSuites(tmpDir)).toEqual(["innodb", "main", "rpl"]);
  });

  it("should detect nested suites", () => {
    createSuite(tmpDir, "");
    createSuite(tmpDir, "suite/starsql");
    createSuite(tmpDir, "suite/starsql/rpl");
    expect(scanSuites(tmpDir)).toEqual(["main", "starsql", "starsql/rpl"]);
  });

  it("should skip directories without t/ subdirectory", () => {
    createSuite(tmpDir, "");
    fs.mkdirSync(path.join(tmpDir, "mysql-test", "suite", "not_a_suite"), { recursive: true });
    expect(scanSuites(tmpDir)).toEqual(["main"]);
  });

  it("should sort suites alphabetically", () => {
    createSuite(tmpDir, "suite/zzz");
    createSuite(tmpDir, "suite/aaa");
    createSuite(tmpDir, "");
    const result = scanSuites(tmpDir);
    expect(result).toEqual(["aaa", "main", "zzz"]);
  });
});
