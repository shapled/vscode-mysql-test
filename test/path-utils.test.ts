import { describe, it, expect } from "vitest";
import {
  findMysqlTestRoot,
  pairTestResultPath,
  pairSuffixFileToTest,
  resolveIncPathString,
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

  it("should append .inc if not present", () => {
    expect(
      resolveIncPathString(
        "/project/mysql-test/t/alias.test",
        "include/assert"
      )
    ).toBe("/project/mysql-test/include/assert.inc");
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
});
