import { describe, it, expect } from "vitest";
import { parsePrintTestcasesOutput, discoverTests, mapToSourcePaths, resolveMtrDir } from "../../src/testing/test-discovery";
import { parseManualDebugOutput } from "../../src/testing/mtr-parser";

describe("parsePrintTestcasesOutput", () => {
  it("should parse a single test case", () => {
    const output = `
[main.alias]
 name= main.alias
 path= /install/mysql-test/t/alias.test
 result_file= /install/mysql-test/r/alias.result
 shortname= alias
 criteria= ndb=B  ~  no-restart
 skip= 0
 master_opt= []
 slave_opt= []
`;
    const tests = parsePrintTestcasesOutput(output);
    expect(tests).toHaveLength(1);
    expect(tests[0].name).toBe("main.alias");
    expect(tests[0].shortname).toBe("alias");
    expect(tests[0].suite).toBe("main");
    expect(tests[0].installPath).toBe("/install/mysql-test/t/alias.test");
    expect(tests[0].resultFile).toBe("/install/mysql-test/r/alias.result");
    expect(tests[0].skip).toBe(false);
  });

  it("should parse a skipped test case with comment", () => {
    const output = `
[main.big_test]
 name= main.big_test
 path= /install/mysql-test/t/big_test.test
 result_file= /install/mysql-test/r/big_test.result
 shortname= big_test
 skip= 1
 comment= Test needs 'big-test' or 'only-big-test' option.
 master_opt= []
 slave_opt= []
 big_test= 1
`;
    const tests = parsePrintTestcasesOutput(output);
    expect(tests).toHaveLength(1);
    expect(tests[0].skip).toBe(true);
    expect(tests[0].comment).toBe("Test needs 'big-test' or 'only-big-test' option.");
    expect(tests[0].name).toBe("main.big_test");
  });

  it("should parse multiple test cases", () => {
    const output = `
[main.test1]
 name= main.test1
 path= /install/mysql-test/t/test1.test
 result_file= /install/mysql-test/r/test1.result
 shortname= test1
 skip= 0

[innodb.test2]
 name= innodb.test2
 path= /install/mysql-test/suite/innodb/t/test2.test
 result_file= /install/mysql-test/suite/innodb/r/test2.result
 shortname= test2
 skip= 0
`;
    const tests = parsePrintTestcasesOutput(output);
    expect(tests).toHaveLength(2);
    expect(tests[0].name).toBe("main.test1");
    expect(tests[0].suite).toBe("main");
    expect(tests[1].name).toBe("innodb.test2");
    expect(tests[1].suite).toBe("innodb");
    expect(tests[1].installPath).toBe("/install/mysql-test/suite/innodb/t/test2.test");
  });

  it("should parse suite names with dots (e.g. starsql/rpl)", () => {
    const output = `
[starsql/rpl.test1]
 name= starsql/rpl.test1
 path= /install/mysql-test/suite/starsql/rpl/t/test1.test
 result_file= /install/mysql-test/suite/starsql/rpl/r/test1.result
 shortname= test1
 skip= 0
`;
    const tests = parsePrintTestcasesOutput(output);
    expect(tests).toHaveLength(1);
    expect(tests[0].name).toBe("starsql/rpl.test1");
    expect(tests[0].suite).toBe("starsql/rpl");
    expect(tests[0].shortname).toBe("test1");
  });

  it("should handle empty output", () => {
    const tests = parsePrintTestcasesOutput("");
    expect(tests).toHaveLength(0);
  });

  it("should handle output with only non-test lines", () => {
    const output = `
Logging: ./mtr  --print-testcases
MySQL Version 8.4.6
Collecting tests
============================================================
`;
    const tests = parsePrintTestcasesOutput(output);
    expect(tests).toHaveLength(0);
  });

  it("should handle real MTR output with headers", () => {
    const output = `Logging: ./mtr  --print-testcases --suite=main
MySQL Version 8.4.6
Using suite(s): main
Collecting tests
============================================================
[main.alter_table-big]
 need_debug= 1
 big_test= 1
 slave_opt= []
 path= /install/mysql-test/t/alter_table-big.test
 master_opt= []
 need_binlog= 1
 comment= Test needs 'big-test' or 'only-big-test' option.
 skip= 1
 shortname= alter_table-big
 criteria= ndb=B  ~  no-restart
 result_file= /install/mysql-test/r/alter_table-big.result
 name= main.alter_table-big

[main.alias]
 master_opt= []
 slave_opt= []
 path= /install/mysql-test/t/alias.test
 shortname= alias
 criteria= ndb=B  ~  no-restart
 skip= 0
 result_file= /install/mysql-test/r/alias.result
 name= main.alias
`;
    const tests = parsePrintTestcasesOutput(output);
    expect(tests.length).toBeGreaterThanOrEqual(2);

    const bigTest = tests.find((t) => t.shortname === "alter_table-big");
    expect(bigTest).toBeDefined();
    expect(bigTest!.skip).toBe(true);
    expect(bigTest!.comment).toContain("big-test");

    const aliasTest = tests.find((t) => t.shortname === "alias");
    expect(aliasTest).toBeDefined();
    expect(aliasTest!.skip).toBe(false);
  });
});

describe("parseManualDebugOutput", () => {
  it("should parse lldb command line", () => {
    const output = `Some MTR output here...
You can start the mysqld with:
cd /Users/dev/install/mysql-test && lldb -s /Users/dev/install/mysql-test/var/tmp/mysqld.1.lldbinit /Users/dev/install/bin/mysqld
Waiting for you to start the debugger...`;

    const info = parseManualDebugOutput(output);
    expect(info).toBeDefined();
    expect(info!.program).toBe("/Users/dev/install/bin/mysqld");
    expect(info!.cwd).toBe("/Users/dev/install/mysql-test");
    expect(info!.initScript).toBe("/Users/dev/install/mysql-test/var/tmp/mysqld.1.lldbinit");
    expect(info!.debuggerType).toBe("lldb");
  });

  it("should parse gdb command line", () => {
    const output = `Some MTR output here...
cd /home/dev/install/mysql-test && gdb -x /home/dev/install/mysql-test/var/tmp/mysqld.1.gdbinit /home/dev/install/bin/mysqld
Waiting for you to start the debugger...`;

    const info = parseManualDebugOutput(output);
    expect(info).toBeDefined();
    expect(info!.program).toBe("/home/dev/install/bin/mysqld");
    expect(info!.cwd).toBe("/home/dev/install/mysql-test");
    expect(info!.initScript).toBe("/home/dev/install/mysql-test/var/tmp/mysqld.1.gdbinit");
    expect(info!.debuggerType).toBe("gdb");
  });

  it("should return undefined when no debug command found", () => {
    const output = `Some MTR output here...
Starting servers...
`;
    const info = parseManualDebugOutput(output);
    expect(info).toBeUndefined();
  });

  it("should parse command with extra spaces", () => {
    const output = `cd  /path/to/mysql-test  &&  lldb  -s  /path/to/init.lldbinit  /path/to/bin/mysqld`;

    const info = parseManualDebugOutput(output);
    expect(info).toBeDefined();
    expect(info!.cwd).toBe("/path/to/mysql-test");
    expect(info!.program).toBe("/path/to/bin/mysqld");
    expect(info!.initScript).toBe("/path/to/init.lldbinit");
  });
});

describe("discoverTests", () => {
  it("should throw when mtrPath is empty", async () => {
    await expect(discoverTests("")).rejects.toThrow();
  });
});

describe("mapToSourcePaths", () => {
  it("should handle empty test list", () => {
    const result = mapToSourcePaths([], "/install", ["/repo"]);
    expect(result).toHaveLength(0);
  });

  it("should skip tests with empty installPath", () => {
    const tests = [
      { name: "main.empty", shortname: "empty", installPath: "", resultFile: "", skip: false, suite: "main" },
    ];
    const result = mapToSourcePaths(tests, "/install", ["/repo"]);
    expect(result).toHaveLength(0);
  });

  it("should skip tests with path not under mysql-test/", () => {
    const tests = [
      { name: "main.weird", shortname: "weird", installPath: "/some/other/path.test", resultFile: "", skip: false, suite: "main" },
    ];
    const result = mapToSourcePaths(tests, "/install", ["/repo"]);
    expect(result).toHaveLength(0);
  });

  it("should skip tests when source file does not exist", () => {
    const tests = [
      { name: "main.missing", shortname: "missing", installPath: "/install/mysql-test/t/missing.test", resultFile: "", skip: false, suite: "main" },
    ];
    const result = mapToSourcePaths(tests, "/install", ["/repo"]);
    // Source doesn't exist, so it falls back to installPath as sourcePath
    expect(result).toHaveLength(1);
    expect(result[0].sourcePath).toBe("/install/mysql-test/t/missing.test");
  });

  it("should map install path to source path when file exists", () => {
    const fs = require("fs") as typeof import("fs");
    const os = require("os") as typeof import("os");
    const path = require("path") as typeof import("path");

    // Create a temp source file
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mtr-test-"));
    const mysqlTestDir = path.join(tmpDir, "mysql-test", "t");
    fs.mkdirSync(mysqlTestDir, { recursive: true });
    fs.writeFileSync(path.join(mysqlTestDir, "exists.test"), "--test");

    try {
      const tests = [
        {
          name: "main.exists",
          shortname: "exists",
          installPath: path.join(tmpDir, "install", "mysql-test", "t", "exists.test"),
          resultFile: "",
          skip: false,
          suite: "main",
        },
      ];
      const result = mapToSourcePaths(tests, path.join(tmpDir, "install"), [tmpDir]);
      expect(result).toHaveLength(1);
      expect(result[0].sourcePath).toBe(fs.realpathSync(path.join(mysqlTestDir, "exists.test")));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("resolveMtrDir", () => {
  it("should return parent directory of mtr path", () => {
    const result = resolveMtrDir("/install/mysql-test/mtr");
    expect(result).toBe("/install/mysql-test");
  });

  it("should resolve symlinks to real path", () => {
    const fs = require("fs") as typeof import("fs");
    const os = require("os") as typeof import("os");
    const path = require("path") as typeof import("path");

    // Create a real directory and a symlink pointing to it
    const realDir = fs.mkdtempSync(path.join(os.tmpdir(), "mtr-real-"));
    const linkDir = path.join(os.tmpdir(), `mtr-link-${Date.now()}`);
    fs.symlinkSync(realDir, linkDir);

    try {
      const mtrPath = path.join(linkDir, "mtr");
      const result = resolveMtrDir(mtrPath);
      expect(result).toBe(fs.realpathSync(realDir));
      // Should NOT be the symlink path
      expect(result).not.toBe(linkDir);
    } finally {
      fs.unlinkSync(linkDir);
      fs.rmSync(realDir, { recursive: true, force: true });
    }
  });

  it("should fall back to mtrDir if realpathSync fails", () => {
    const result = resolveMtrDir("/nonexistent/path/mtr");
    expect(result).toBe("/nonexistent/path");
  });
});
