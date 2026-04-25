import { describe, it, expect } from "vitest";
import {
  findCommandInLine,
  buildHoverMarkdown,
  commandMap,
  findFunctionByWord,
  buildFunctionHoverMarkdown,
  functionMap,
} from "../src/features/hover-logic";

// @ts-ignore
import langConfig from "../language-configuration.json";

describe("findCommandInLine", () => {
  it("should find command with -- prefix", () => {
    expect(findCommandInLine("--echo hello")).toBe("echo");
  });

  it("should find command with -- prefix and space after --", () => {
    expect(findCommandInLine("-- echo hello")).toBe("echo");
  });

  it("should find command with -- prefix and leading whitespace", () => {
    expect(findCommandInLine("  --echo hello")).toBe("echo");
  });

  it("should find command without -- prefix", () => {
    expect(findCommandInLine("echo hello;")).toBe("echo");
  });

  it("should find command without -- prefix and leading whitespace", () => {
    expect(findCommandInLine("  let $var=1;")).toBe("let");
  });

  it("should find disable_* commands with -- prefix", () => {
    expect(findCommandInLine("--disable_query_log")).toBe(
      "disable_query_log"
    );
  });

  it("should find enable_* commands with -- prefix", () => {
    expect(findCommandInLine("--enable_warnings")).toBe(
      "enable_warnings"
    );
  });

  it("should find disable_* commands without -- prefix", () => {
    expect(findCommandInLine("disable_query_log;")).toBe(
      "disable_query_log"
    );
  });

  it("should find source command", () => {
    expect(
      findCommandInLine("--source include/have_innodb.inc")
    ).toBe("source");
  });

  it("should find source command without -- prefix", () => {
    expect(findCommandInLine("source include/assert.inc;")).toBe(
      "source"
    );
  });

  it("should find error command", () => {
    expect(findCommandInLine("--error 1050")).toBe("error");
  });

  it("should find error command without -- prefix", () => {
    expect(findCommandInLine("error ER_TABLE_EXISTS_ERROR;")).toBe(
      "error"
    );
  });

  it("should find if command", () => {
    expect(findCommandInLine("if ($x) {")).toBe("if");
  });

  it("should find while command", () => {
    expect(findCommandInLine("while ($x) {")).toBe("while");
  });

  it("should not match SQL keywords as MTR commands", () => {
    expect(findCommandInLine("SELECT * FROM t1;")).toBeUndefined();
  });

  it("should not match SQL keywords at line start", () => {
    expect(findCommandInLine("CREATE TABLE t1 (id INT);")).toBeUndefined();
  });

  it("should not match INSERT as MTR command", () => {
    expect(
      findCommandInLine("INSERT INTO t1 VALUES (1);")
    ).toBeUndefined();
  });

  it("should not match empty lines", () => {
    expect(findCommandInLine("")).toBeUndefined();
  });

  it("should not match comment lines", () => {
    expect(findCommandInLine("# this is a comment")).toBeUndefined();
  });

  it("should not match SQL after -- prefix if not an MTR command", () => {
    expect(findCommandInLine("-- not_a_real_command arg")).toBeUndefined();
  });
});

describe("hover word matching", () => {
  /**
   * Simulates the hover provider's word matching logic.
   * wordPattern includes "-", so "--connect" is one word.
   */
  function matchWord(word: string, cmdName: string): boolean {
    return word.toLowerCase().endsWith(cmdName);
  }

  it("'--connect' should match command 'connect'", () => {
    expect(matchWord("--connect", "connect")).toBe(true);
  });

  it("'--echo' should match command 'echo'", () => {
    expect(matchWord("--echo", "echo")).toBe(true);
  });

  it("'--disable_query_log' should match 'disable_query_log'", () => {
    expect(matchWord("--disable_query_log", "disable_query_log")).toBe(
      true
    );
  });

  it("'-- echo' split by space should match 'echo'", () => {
    expect(matchWord("echo", "echo")).toBe(true);
  });

  it("'echo' without prefix should match 'echo'", () => {
    expect(matchWord("echo", "echo")).toBe(true);
  });

  it("'text' should not match 'echo'", () => {
    expect(matchWord("text", "echo")).toBe(false);
  });
});

describe("commandMap", () => {
  it("should contain core commands", () => {
    const expected = [
      "echo",
      "let",
      "eval",
      "source",
      "error",
      "skip",
      "die",
      "exec",
      "if",
      "while",
      "end",
      "inc",
      "dec",
      "delimiter",
      "sleep",
    ];
    for (const name of expected) {
      expect(commandMap.has(name), `missing command: ${name}`).toBe(
        true
      );
    }
  });

  it("should contain disable/enable pairs", () => {
    const pairs = [
      ["disable_query_log", "enable_query_log"],
      ["disable_result_log", "enable_result_log"],
      ["disable_warnings", "enable_warnings"],
      ["disable_info", "enable_info"],
      ["disable_metadata", "enable_metadata"],
    ];
    for (const [dis, en] of pairs) {
      expect(commandMap.has(dis)).toBe(true);
      expect(commandMap.has(en)).toBe(true);
    }
  });

  it("should contain file operation commands", () => {
    const expected = [
      "write_file",
      "append_file",
      "remove_file",
      "copy_file",
      "cat_file",
      "mkdir",
      "rmdir",
      "move_file",
      "chmod",
    ];
    for (const name of expected) {
      expect(commandMap.has(name)).toBe(true);
    }
  });

  it("should contain connection commands", () => {
    const expected = [
      "connect",
      "connection",
      "disconnect",
      "dirty_close",
      "reset_connection",
    ];
    for (const name of expected) {
      expect(commandMap.has(name)).toBe(true);
    }
  });

  it("each command should have required fields", () => {
    for (const [, cmd] of commandMap) {
      expect(typeof cmd.name).toBe("string");
      expect(typeof cmd.syntax).toBe("string");
      expect(typeof cmd.description).toBe("string");
      expect(Array.isArray(cmd.demos)).toBe(true);
      expect(typeof cmd.doc_page).toBe("string");
      expect(cmd.doc_page).toMatch(/^PAGE_MYSQL_TEST/);
    }
  });
});

describe("buildHoverMarkdown", () => {
  it("should include command name", () => {
    const cmd = commandMap.get("echo")!;
    const md = buildHoverMarkdown(cmd);
    expect(md).toContain("**echo**");
  });

  it("should include syntax", () => {
    const cmd = commandMap.get("echo")!;
    const md = buildHoverMarkdown(cmd);
    expect(md).toContain("`echo text`");
  });

  it("should include description", () => {
    const cmd = commandMap.get("echo")!;
    const md = buildHoverMarkdown(cmd);
    expect(md).toContain("Echo the text to the test result");
  });

  it("should include example when demos exist", () => {
    const cmd = commandMap.get("echo")!;
    const md = buildHoverMarkdown(cmd);
    expect(md).toContain("```");
    expect(md).toContain("**Example:**");
  });

  it("should not include example when demos are empty", () => {
    const cmd = commandMap.get("end")!;
    const md = buildHoverMarkdown(cmd);
    expect(md).not.toContain("**Example:**");
  });

  it("should include doc link", () => {
    const cmd = commandMap.get("echo")!;
    const md = buildHoverMarkdown(cmd);
    expect(md).toContain("[View documentation]");
    expect(md).toContain("PAGE_MYSQL_TEST_COMMANDS.html");
  });

  it("should use correct doc page for each command", () => {
    const cmd = commandMap.get("if")!;
    const md = buildHoverMarkdown(cmd);
    expect(md).toContain("PAGE_MYSQL_TEST_");
    expect(md).toContain(".html");
  });
});

describe("findFunctionByWord", () => {
  it("should find query_get_value", () => {
    expect(findFunctionByWord("query_get_value")).toBeDefined();
    expect(findFunctionByWord("query_get_value")!.name).toBe(
      "query_get_value"
    );
  });

  it("should find convert_error", () => {
    expect(findFunctionByWord("convert_error")).toBeDefined();
    expect(findFunctionByWord("convert_error")!.name).toBe("convert_error");
  });

  it("should be case-insensitive", () => {
    expect(findFunctionByWord("Query_Get_Value")).toBeDefined();
    expect(findFunctionByWord("CONVERT_ERROR")).toBeDefined();
  });

  it("should return undefined for unknown words", () => {
    expect(findFunctionByWord("not_a_function")).toBeUndefined();
    expect(findFunctionByWord("SELECT")).toBeUndefined();
    expect(findFunctionByWord("echo")).toBeUndefined();
  });

  it("should not match partial words", () => {
    expect(findFunctionByWord("query_get")).toBeUndefined();
    expect(findFunctionByWord("convert")).toBeUndefined();
  });
});

describe("buildFunctionHoverMarkdown", () => {
  it("should include function name in bold", () => {
    const fn = functionMap.get("query_get_value")!;
    const md = buildFunctionHoverMarkdown(fn);
    expect(md).toContain("**query_get_value**");
  });

  it("should include syntax", () => {
    const fn = functionMap.get("query_get_value")!;
    const md = buildFunctionHoverMarkdown(fn);
    expect(md).toContain("`query_get_value(query, col_name, row_num)`");
  });

  it("should include description", () => {
    const fn = functionMap.get("query_get_value")!;
    const md = buildFunctionHoverMarkdown(fn);
    expect(md).toContain("Execute a query and return the value");
  });

  it("should not include doc link (functions link from let command)", () => {
    const fn = functionMap.get("query_get_value")!;
    const md = buildFunctionHoverMarkdown(fn);
    expect(md).not.toContain("[View documentation]");
  });

  it("should work for convert_error", () => {
    const fn = functionMap.get("convert_error")!;
    const md = buildFunctionHoverMarkdown(fn);
    expect(md).toContain("**convert_error**");
    expect(md).toContain("`convert_error(error)`");
    expect(md).toContain("error code");
  });
});

describe("functionMap", () => {
  it("should contain both functions", () => {
    expect(functionMap.has("query_get_value")).toBe(true);
    expect(functionMap.has("convert_error")).toBe(true);
  });

  it("each function should have required fields", () => {
    for (const [, fn] of functionMap) {
      expect(typeof fn.name).toBe("string");
      expect(typeof fn.syntax).toBe("string");
      expect(typeof fn.description).toBe("string");
    }
  });
});

describe("wordPattern", () => {
  const wordPattern = new RegExp(langConfig.wordPattern, "g");

  function extractWords(line: string): string[] {
    return [...line.matchAll(wordPattern)].map((m) => m[0]);
  }

  it("should match command name after -- prefix", () => {
    const words = extractWords("--echo $message;");
    expect(words).toContain("echo");
  });

  it("should match long command name after -- prefix", () => {
    const words = extractWords("--disable_query_log");
    expect(words).toContain("disable_query_log");
  });

  it("should match $variable", () => {
    const words = extractWords("--let $counter = 0;");
    expect(words).toContain("$counter");
  });

  it("should match bare command at line start", () => {
    const words = extractWords("let $counter = 0;");
    expect(words).toContain("let");
  });

  it("should match function name in expression", () => {
    const words = extractWords("let $v = query_get_value(SHOW STATUS, Col, 1);");
    expect(words).toContain("query_get_value");
  });
});
