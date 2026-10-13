import { describe, it, expect } from "vitest";
import { parseMt } from "../src/ast/parse";
import {
  extractTokens,
  T,
  M,
  RawToken,
} from "../src/features/token-extractor";

function firstTokenOfType(
  tokens: RawToken[],
  type: number
): RawToken | undefined {
  return tokens.find((t) => t.type === type);
}

describe("token extraction", () => {
  it("emits macro token for the command keyword", () => {
    const src = "--source include/a.inc\n";
    const stmts = parseMt(src);
    const macro = firstTokenOfType(extractTokens(stmts, src), T.macro);
    expect(macro).toBeDefined();
    expect(src.substring(macro!.offset, macro!.offset + macro!.length)).toBe("source");
  });

  it("emits operator token for the -- prefix", () => {
    const src = "--echo hi\n";
    const stmts = parseMt(src);
    const op = firstTokenOfType(extractTokens(stmts, src), T.operator);
    expect(op).toBeDefined();
    expect(src.substring(op!.offset, op!.offset + op!.length)).toBe("--");
  });

  it("emits comment token for # lines", () => {
    const src = "# a comment\n--echo hi\n";
    const stmts = parseMt(src);
    const c = firstTokenOfType(extractTokens(stmts, src), T.comment);
    expect(c).toBeDefined();
    expect(src.substring(c!.offset, c!.offset + c!.length)).toBe("# a comment");
  });

  it("emits macro for no-prefix commands too", () => {
    const src = "echo hi;\n";
    const stmts = parseMt(src);
    const macro = firstTokenOfType(extractTokens(stmts, src), T.macro);
    expect(macro).toBeDefined();
    expect(src.substring(macro!.offset, macro!.offset + macro!.length)).toBe("echo");
  });

  it("emits variable token for $var references", () => {
    const src = "--echo hello $name\n";
    const stmts = parseMt(src);
    const v = firstTokenOfType(extractTokens(stmts, src), T.variable);
    expect(v).toBeDefined();
    expect(src.substring(v!.offset, v!.offset + v!.length)).toBe("$name");
  });

  it("emits string token for literal command arguments", () => {
    // Single quote inside literal must NOT split into separate ranges
    const src = "--let $grep_pattern=Can't generate a unique log-filename .*\n";
    const stmts = parseMt(src);
    const tokens = extractTokens(stmts, src);
    const stringTokens = tokens.filter((t) => t.type === T.string);
    expect(stringTokens.length).toBeGreaterThanOrEqual(1);
    // Find the one covering "Can't generate..."
    const value = stringTokens.find((t) =>
      src.substring(t.offset, t.offset + t.length).includes("Can't")
    );
    expect(value).toBeDefined();
    expect(src.substring(value!.offset, value!.offset + value!.length)).toBe(
      "Can't generate a unique log-filename .*"
    );
  });

  it("marks let declaration variable with declaration modifier", () => {
    const src = "--let $counter = 5\n";
    const stmts = parseMt(src);
    const tokens = extractTokens(stmts, src);
    const decl = tokens.find(
      (t) => t.type === T.variable && (t.modifiers & M.declaration)
    );
    expect(decl).toBeDefined();
    expect(src.substring(decl!.offset, decl!.offset + decl!.length)).toBe(
      "$counter"
    );
  });

  it("does NOT emit token for backtick Query (left to TextMate source.sql)", () => {
    const src = "let $rcd= `SELECT 1`;\n";
    const stmts = parseMt(src);
    const tokens = extractTokens(stmts, src);
    const str = tokens.find((t) => t.type === T.string && t.isStringContent);
    expect(str).toBeUndefined();
  });

  it("distinguishes Literal text (plain) from backtick Query (no token)", () => {
    // let value `Can't generate...` is Literal (plain), gets string token
    const src = "--let $x=Can't generate\n";
    const stmts = parseMt(src);
    const literal = extractTokens(stmts, src).find(
      (t) => t.type === T.string && t.isStringContent === false
    );
    expect(literal).toBeDefined();
    expect(src.substring(literal!.offset, literal!.offset + literal!.length)).toBe(
      "Can't generate"
    );

    // backtick Query is left to TextMate's source.sql — no semantic token
    const src2 = "let $y= `SELECT 1`;\n";
    const stmts2 = parseMt(src2);
    const queryTokens = extractTokens(stmts2, src2).filter(
      (t) => t.type === T.string && t.isStringContent === true
    );
    expect(queryTokens.length).toBe(0);
  });

  it("handles multiple statements without offset drift", () => {
    const src = "--source a.inc\necho hi;\n# c\n";
    const stmts = parseMt(src);
    const macros = extractTokens(stmts, src).filter((t) => t.type === T.macro);
    expect(macros.length).toBe(2);
    for (const m of macros) {
      const name = src.substring(m.offset, m.offset + m.length);
      expect(["source", "echo"]).toContain(name);
    }
  });

  it("WriteFile end_marker produces operator token", () => {
    const src = [
      "--write_file $MYSQLTEST_VARDIR/tmp/out.inc PROCEDURE",
      "content line",
      "PROCEDURE",
    ].join("\n") + "\n";
    const stmts = parseMt(src);
    const tokens = extractTokens(stmts, src);
    // The end_marker "PROCEDURE" on the last line must produce an operator
    // token — otherwise TextMate miscolours it as markup.underline.link.
    const operators = tokens.filter((t) => t.type === T.operator);
    const marker = operators.find((t) => {
      const txt = src.substring(t.offset, t.offset + t.length);
      return txt === "PROCEDURE";
    });
    expect(marker, "WriteFile end_marker must produce an operator token").toBeDefined();
  });

  it("echo multi-line Literal produces token covering all lines", () => {
    const src = [
      "echo Error: I_S_VERSION ($v) version found in",
      "    sql/dd/info_schema/metadata.h is greater than MYSQLD_VERSION",
      "    end.;",
    ].join("\n") + "\n";
    const stmts = parseMt(src);
    const tokens = extractTokens(stmts, src);
    const literals = tokens.filter((t) => t.type === T.string && !t.isStringContent);
    // The multi-line Literal "version found in\n    sql/dd/..." must produce
    // a token that spans both lines (not filtered by any safety check).
    const multiLine = literals.find((t) => {
      const txt = src.substring(t.offset, t.offset + t.length);
      return txt.includes("\n");
    });
    expect(multiLine, "multi-line echo Literal must produce a token").toBeDefined();
    // Verify the token covers the second line's content
    const tokenText = src.substring(multiLine!.offset, multiLine!.offset + multiLine!.length);
    expect(tokenText).toContain("sql/dd/info_schema/metadata.h");
  });
});

// ── mtparser 0.4 AST shape (DashCommand wrapper, Marker, content region) ──

function textsOfType(
  tokens: RawToken[],
  src: string,
  type: number
): string[] {
  return tokens
    .filter((t) => t.type === type)
    .map((t) => src.substring(t.offset, t.offset + t.length));
}

describe("token extraction — 0.4 block derivations", () => {
  it("write_file content region is marked as string", () => {
    const src = [
      "--write_file /tmp/foo.txt EOF",
      "line one $x",
      "line two",
      "EOF",
      "--echo done",
    ].join("\n") + "\n";
    const tokens = extractTokens(parseMt(src), src);
    const strings = textsOfType(tokens, src, T.string);
    const content = strings.find((s) => s.includes("line one $x"));
    expect(content, "content region must be a string token").toBeDefined();
    expect(content!).toContain("line two");
    expect(content).not.toContain("EOF"); // close marker line excluded
    // open + close markers as operator tokens
    const ops = textsOfType(tokens, src, T.operator);
    expect(ops.filter((o) => o === "EOF").length).toBe(2);
  });

  it("append_file with implicit marker still marks content", () => {
    const src = ["--append_file /tmp/b.txt", "appended body", "EOF", ""].join("\n");
    const tokens = extractTokens(parseMt(src), src);
    const strings = textsOfType(tokens, src, T.string);
    expect(strings.find((s) => s.includes("appended body"))).toBeDefined();
  });

  it("if/while braces produce operator tokens and body gets tokens", () => {
    const src = [
      "--let $x = 1",
      "if ($x == 1) {",
      "--echo inside $x",
      "}",
      "while ($x < 5) {",
      "--inc $x",
      "}",
      "",
    ].join("\n");
    const tokens = extractTokens(parseMt(src), src);
    const ops = textsOfType(tokens, src, T.operator);
    expect(ops).toContain("{");
    expect(ops).toContain("}");
    // nested echo inside if body: keyword + variable
    expect(textsOfType(tokens, src, T.macro)).toContain("echo");
    expect(textsOfType(tokens, src, T.variable)).toContain("$x");
    expect(textsOfType(tokens, src, T.macro)).toContain("inc");
  });

  it("query_get_value function name gets a macro token", () => {
    const src = "--let $y = query_get_value(SELECT foo, col, 1)\n";
    const tokens = extractTokens(parseMt(src), src);
    expect(textsOfType(tokens, src, T.macro)).toContain("query_get_value");
  });

  it("escape: first `)` as character argument, last `)` as closing paren", () => {
    // mysqltest.cc scans TEXT to the end and backs up one char for the
    // closing paren — a `)` in CHARACTERS first position is an argument.
    const src = "--let $x = escape(), hihi (haha))\n";
    const tokens = extractTokens(parseMt(src), src);
    expect(textsOfType(tokens, src, T.macro)).toContain("escape");
    // Exactly one `)` operator token — the real closing paren at the end.
    const closeParens = textsOfType(tokens, src, T.operator).filter((t) => t === ")");
    expect(closeParens.length).toBe(1);
    expect(closeParens[0] === ")").toBe(true);
    // The character argument `)` and the text argument are string tokens.
    const strings = textsOfType(tokens, src, T.string);
    expect(strings).toContain(")");
    expect(strings).toContain(" hihi (haha)");
  });

  it("escape: regular character list and variables in text", () => {
    const src = "--let $x = escape(\\',The 'path' in $OS is \\.)\n";
    const tokens = extractTokens(parseMt(src), src);
    expect(textsOfType(tokens, src, T.macro)).toContain("escape");
    expect(textsOfType(tokens, src, T.string)).toContain("\\'");
    expect(textsOfType(tokens, src, T.variable)).toContain("$OS");
    // The real closing paren is the final `)` of the call.
    const ops = textsOfType(tokens, src, T.operator);
    expect(ops.filter((t) => t === ")").length).toBe(1);
  });

  it("convert_error: function name, parens, argument tokens", () => {
    const src = "--let $errvar1= convert_error(ER_UNKNOWN_ERROR)\n";
    const tokens = extractTokens(parseMt(src), src);
    expect(textsOfType(tokens, src, T.macro)).toContain("convert_error");
    expect(textsOfType(tokens, src, T.string)).toContain("ER_UNKNOWN_ERROR");
    expect(textsOfType(tokens, src, T.operator)).toContain("(");
    expect(textsOfType(tokens, src, T.operator)).toContain(")");
  });

  it("variables inside a backtick query value get variable tokens", () => {
    // Real form (rpl_replica_net_timeout.test): $vars inside `select ...`.
    const src = "--let $ts_flag= `select $ts_last-$ts_prev>=$replica_net_timeout`\n";
    const tokens = extractTokens(parseMt(src), src);
    const vars = textsOfType(tokens, src, T.variable);
    expect(vars).toContain("$ts_last");
    expect(vars).toContain("$ts_prev");
    expect(vars).toContain("$replica_net_timeout");
    // the declaration itself
    expect(tokens.some((t) => t.type === T.variable && src.substring(t.offset, t.offset + t.length) === "$ts_flag")).toBe(true);
  });
});
