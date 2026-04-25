import { describe, it, expect } from "vitest";
import {
  isCommentLine,
  findVariableDeclarationInLines,
  findVariableOccurrencesInLines,
  extractIncludePaths,
  findVariableReferencesRecursive,
  getVariableAtPosition,
} from "../src/features/variable-logic";

describe("isCommentLine", () => {
  it("should match # comment", () => {
    expect(isCommentLine("# this is a comment")).toBe(true);
  });

  it("should match indented # comment", () => {
    expect(isCommentLine("  # indented comment")).toBe(true);
  });

  it("should not match SQL", () => {
    expect(isCommentLine("SELECT 1")).toBe(false);
  });

  it("should not match MTR directive with #", () => {
    expect(isCommentLine("--echo # not a comment")).toBe(false);
  });

  it("should not match empty line", () => {
    expect(isCommentLine("")).toBe(false);
  });
});

describe("findVariableDeclarationInLines", () => {
  it("should find --let declaration", () => {
    const lines = ["--let $my_var = 42", "SELECT $my_var;"];
    const result = findVariableDeclarationInLines(lines, "$my_var");
    expect(result).toBeDefined();
    expect(result!.lineIndex).toBe(0);
    expect(result!.startCol).toBe(6);
    expect(result!.endCol).toBe(13);
  });

  it("should find let declaration without -- prefix", () => {
    const lines = ["let $my_var = 42;", "SELECT $my_var;"];
    const result = findVariableDeclarationInLines(lines, "$my_var");
    expect(result).toBeDefined();
    expect(result!.lineIndex).toBe(0);
  });

  it("should find --let with space after --", () => {
    const lines = ["-- let $x = 1;"];
    const result = findVariableDeclarationInLines(lines, "$x");
    expect(result).toBeDefined();
    expect(result!.lineIndex).toBe(0);
  });

  it("should not match --echo $var", () => {
    const lines = ["--echo $var"];
    const result = findVariableDeclarationInLines(lines, "$var");
    expect(result).toBeUndefined();
  });

  it("should not match SELECT $var", () => {
    const lines = ["SELECT $var;"];
    const result = findVariableDeclarationInLines(lines, "$var");
    expect(result).toBeUndefined();
  });

  it("should return undefined when variable not declared", () => {
    const lines = ["--let $other = 1"];
    const result = findVariableDeclarationInLines(lines, "$missing");
    expect(result).toBeUndefined();
  });

  it("should handle --let without spaces around =", () => {
    const lines = ["--let $var=1;"];
    const result = findVariableDeclarationInLines(lines, "$var");
    expect(result).toBeDefined();
  });

  it("should skip comment lines", () => {
    const lines = ["# --let $var = 1", "--let $var = 2"];
    const result = findVariableDeclarationInLines(lines, "$var");
    expect(result).toBeDefined();
    expect(result!.lineIndex).toBe(1);
  });

  it("should find first declaration when multiple exist", () => {
    const lines = ["--let $x = 1;", "--let $x = 2;"];
    const result = findVariableDeclarationInLines(lines, "$x");
    expect(result).toBeDefined();
    expect(result!.lineIndex).toBe(0);
  });
});

describe("findVariableOccurrencesInLines", () => {
  it("should find $var in SELECT", () => {
    const lines = ["SELECT $var FROM t1;"];
    const results = findVariableOccurrencesInLines(lines, "$var");
    expect(results).toHaveLength(1);
    expect(results[0].lineIndex).toBe(0);
  });

  it("should find $var in --eval", () => {
    const lines = ["--eval INSERT INTO t1 VALUES ($var);"];
    const results = findVariableOccurrencesInLines(lines, "$var");
    expect(results).toHaveLength(1);
  });

  it("should not match $variable when searching for $var", () => {
    const lines = ["SELECT $variable;"];
    const results = findVariableOccurrencesInLines(lines, "$var");
    expect(results).toHaveLength(0);
  });

  it("should find multiple occurrences on same line", () => {
    const lines = ["--echo $var and $var"];
    const results = findVariableOccurrencesInLines(lines, "$var");
    expect(results).toHaveLength(2);
  });

  it("should skip comment lines", () => {
    const lines = ["# $var should not be found", "SELECT $var;"];
    const results = findVariableOccurrencesInLines(lines, "$var");
    expect(results).toHaveLength(1);
    expect(results[0].lineIndex).toBe(1);
  });

  it("should find $var in strings", () => {
    const lines = ["INSERT INTO t1 VALUES ('$var');"];
    const results = findVariableOccurrencesInLines(lines, "$var");
    expect(results).toHaveLength(1);
  });

  it("should return correct column ranges", () => {
    const lines = ["SELECT $var;"];
    const results = findVariableOccurrencesInLines(lines, "$var");
    expect(results[0].startCol).toBe(7);
    expect(results[0].endCol).toBe(11);
  });

  it("should return empty for no matches", () => {
    const lines = ["SELECT 1;"];
    const results = findVariableOccurrencesInLines(lines, "$var");
    expect(results).toHaveLength(0);
  });

  it("should NOT find $var in die string (variables are not expanded)", () => {
    const lines = ["die 'failed at $var';"];
    const results = findVariableOccurrencesInLines(lines, "$var");
    expect(results).toHaveLength(0);
  });

  it("should NOT find $var in --die string", () => {
    const lines = ['--die "cannot continue with $var"'];
    const results = findVariableOccurrencesInLines(lines, "$var");
    expect(results).toHaveLength(0);
  });

  it("should find $var on non-die lines in same file", () => {
    const lines = [
      "die 'error message';",
      "SELECT $var;",
    ];
    const results = findVariableOccurrencesInLines(lines, "$var");
    expect(results).toHaveLength(1);
    expect(results[0].lineIndex).toBe(1);
  });
});

describe("extractIncludePaths", () => {
  it("should extract --source path", () => {
    const lines = ["--source include/have_innodb.inc"];
    const paths = extractIncludePaths(lines);
    expect(paths).toEqual(["include/have_innodb.inc"]);
  });

  it("should extract source path without -- prefix", () => {
    const lines = ["source include/assert.inc;"];
    const paths = extractIncludePaths(lines);
    expect(paths).toEqual(["include/assert.inc"]);
  });

  it("should extract --include path", () => {
    const lines = ["--include include/file.inc"];
    const paths = extractIncludePaths(lines);
    expect(paths).toEqual(["include/file.inc"]);
  });

  it("should skip comment lines", () => {
    const lines = ["# --source include/file.inc"];
    const paths = extractIncludePaths(lines);
    expect(paths).toHaveLength(0);
  });

  it("should extract multiple includes", () => {
    const lines = [
      "--source include/a.inc",
      "--source include/b.inc",
    ];
    const paths = extractIncludePaths(lines);
    expect(paths).toHaveLength(2);
  });
});

describe("getVariableAtPosition", () => {
  it("should find $var at $ position", () => {
    const line = "SELECT $var FROM t1;";
    // $ is at index 7
    expect(getVariableAtPosition(line, 7)).toBe("$var");
  });

  it("should find $var inside the name", () => {
    const line = "SELECT $var FROM t1;";
    // 'a' is at index 9
    expect(getVariableAtPosition(line, 9)).toBe("$var");
  });

  it("should find $var at end of name", () => {
    const line = "SELECT $var FROM t1;";
    // 'r' is at index 10
    expect(getVariableAtPosition(line, 10)).toBe("$var");
  });

  it("should return undefined when not on a variable", () => {
    const line = "SELECT $var FROM t1;";
    // 'F' is at index 12
    expect(getVariableAtPosition(line, 12)).toBeUndefined();
  });

  it("should extract $i from d$i (no space before variable)", () => {
    const line = "--let diff_tables=master:d$i.t1, slave:d$i.t1";
    // In "master:d$i", $ is at index 27
    expect(getVariableAtPosition(line, 27)).toBe("$i");
  });

  it("should extract $i from second d$i in same line", () => {
    const line = "--let diff_tables=master:d$i.t1, slave:d$i.t1";
    // In "slave:d$i", $ is at index 40
    expect(getVariableAtPosition(line, 40)).toBe("$i");
  });

  it("should extract $MYSQL_TMP_DIR from path with no space", () => {
    const line = "--write_file $MYSQL_TMP_DIR/test.sql";
    // $ is at index 14
    expect(getVariableAtPosition(line, 14)).toBe("$MYSQL_TMP_DIR");
  });

  it("should return undefined when cursor is on the char before $", () => {
    const line = "prefix$var";
    // 'x' is at index 5, $ is at index 6
    expect(getVariableAtPosition(line, 5)).toBeUndefined();
  });

  it("should return undefined when cursor is on the char after variable", () => {
    const line = "$var;";
    // ';' is at index 4
    expect(getVariableAtPosition(line, 4)).toBeUndefined();
  });

  it("should find $var2 with numbers in name", () => {
    const line = "SELECT $var2 FROM t1;";
    expect(getVariableAtPosition(line, 7)).toBe("$var2");
  });
});

describe("findVariableReferencesRecursive", () => {
  it("should find references in current file only", () => {
    const mockFiles: Record<string, string> = {
      "/project/mysql-test/t/test.test": [
        "--let $my_var = 42",
        "SELECT $my_var;",
        "INSERT INTO t1 VALUES ($my_var);",
      ].join("\n"),
    };
    const results = findVariableReferencesRecursive(
      "/project/mysql-test/t/test.test",
      "$my_var",
      (p) => mockFiles[p]
    );
    expect(results).toHaveLength(3); // declaration + 2 usages
  });

  it("should follow one level of --source include", () => {
    const mockFiles: Record<string, string> = {
      "/project/mysql-test/t/test.test": [
        "--let $my_var = 42",
        "SELECT $my_var;",
        "--source include/helper.inc",
      ].join("\n"),
      "/project/mysql-test/include/helper.inc": [
        "INSERT INTO t1 VALUES ($my_var);",
      ].join("\n"),
    };
    const results = findVariableReferencesRecursive(
      "/project/mysql-test/t/test.test",
      "$my_var",
      (p) => mockFiles[p]
    );
    expect(results).toHaveLength(3);
    // declaration + usage in test.test, usage in helper.inc
    const filePaths = results.map((r) => r.filePath);
    expect(filePaths).toContain("/project/mysql-test/t/test.test");
    expect(filePaths).toContain("/project/mysql-test/include/helper.inc");
  });

  it("should follow two levels of includes", () => {
    const mockFiles: Record<string, string> = {
      "/project/mysql-test/t/test.test": [
        "--let $x = 1;",
        "--source include/a.inc",
      ].join("\n"),
      "/project/mysql-test/include/a.inc": [
        "--source include/b.inc",
      ].join("\n"),
      "/project/mysql-test/include/b.inc": [
        "SELECT $x;",
      ].join("\n"),
    };
    const results = findVariableReferencesRecursive(
      "/project/mysql-test/t/test.test",
      "$x",
      (p) => mockFiles[p]
    );
    expect(results).toHaveLength(2);
    expect(results[1].filePath).toBe(
      "/project/mysql-test/include/b.inc"
    );
  });

  it("should handle circular includes", () => {
    const mockFiles: Record<string, string> = {
      "/project/mysql-test/include/a.inc": [
        "--source include/b.inc",
        "SELECT $x;",
      ].join("\n"),
      "/project/mysql-test/include/b.inc": [
        "--source include/a.inc",
        "INSERT INTO t1 VALUES ($x);",
      ].join("\n"),
    };
    const results = findVariableReferencesRecursive(
      "/project/mysql-test/include/a.inc",
      "$x",
      (p) => mockFiles[p]
    );
    // a.inc has 1 ref, b.inc has 1 ref
    expect(results).toHaveLength(2);
  });

  it("should return empty for non-existent file", () => {
    const results = findVariableReferencesRecursive(
      "/non/existent/file.test",
      "$x",
      () => {
        throw new Error("not found");
      }
    );
    expect(results).toHaveLength(0);
  });

  it("should skip non-existent include files", () => {
    const mockFiles: Record<string, string> = {
      "/project/mysql-test/t/test.test": [
        "--let $x = 1;",
        "--source include/missing.inc",
        "SELECT $x;",
      ].join("\n"),
    };
    const readFile = (p: string) => {
      if (p in mockFiles) return mockFiles[p];
      throw new Error("not found");
    };
    const results = findVariableReferencesRecursive(
      "/project/mysql-test/t/test.test",
      "$x",
      readFile
    );
    // declaration + usage in test.test, missing.inc is skipped
    expect(results).toHaveLength(2);
  });
});
