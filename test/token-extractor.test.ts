import { describe, it, expect, beforeAll } from "vitest";
import { initWasm, parseMt } from "../src/wasm/wasm-loader";
import {
  extractTokens,
  T,
  M,
  RawToken,
} from "../src/features/token-extractor";

beforeAll(async () => {
  await initWasm();
});

function firstTokenOfType(
  tokens: RawToken[],
  type: number
): RawToken | undefined {
  return tokens.find((t) => t.type === type);
}

describe("token extraction", () => {
  it("emits macro token for the command keyword", () => {
    const src = "--source include/a.inc\n";
    const stmts = parseMt(src, undefined);
    const macro = firstTokenOfType(extractTokens(stmts, src), T.macro);
    expect(macro).toBeDefined();
    expect(src.substring(macro!.offset, macro!.offset + macro!.length)).toBe("source");
  });

  it("emits operator token for the -- prefix", () => {
    const src = "--echo hi\n";
    const stmts = parseMt(src, undefined);
    const op = firstTokenOfType(extractTokens(stmts, src), T.operator);
    expect(op).toBeDefined();
    expect(src.substring(op!.offset, op!.offset + op!.length)).toBe("--");
  });

  it("emits comment token for # lines", () => {
    const src = "# a comment\n--echo hi\n";
    const stmts = parseMt(src, undefined);
    const c = firstTokenOfType(extractTokens(stmts, src), T.comment);
    expect(c).toBeDefined();
    expect(src.substring(c!.offset, c!.offset + c!.length)).toBe("# a comment");
  });

  it("emits macro for no-prefix commands too", () => {
    const src = "echo hi;\n";
    const stmts = parseMt(src, undefined);
    const macro = firstTokenOfType(extractTokens(stmts, src), T.macro);
    expect(macro).toBeDefined();
    expect(src.substring(macro!.offset, macro!.offset + macro!.length)).toBe("echo");
  });

  it("emits variable token for $var references", () => {
    const src = "--echo hello $name\n";
    const stmts = parseMt(src, undefined);
    const v = firstTokenOfType(extractTokens(stmts, src), T.variable);
    expect(v).toBeDefined();
    expect(src.substring(v!.offset, v!.offset + v!.length)).toBe("$name");
  });

  it("emits string token for literal command arguments", () => {
    // Single quote inside literal must NOT split into separate ranges
    const src = "--let $grep_pattern=Can't generate a unique log-filename .*\n";
    const stmts = parseMt(src, undefined);
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
    const stmts = parseMt(src, undefined);
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
    const stmts = parseMt(src, undefined);
    const tokens = extractTokens(stmts, src);
    const str = tokens.find((t) => t.type === T.string && t.isStringContent);
    expect(str).toBeUndefined();
  });

  it("distinguishes Literal text (plain) from backtick Query (no token)", () => {
    // let value `Can't generate...` is Literal (plain), gets string token
    const src = "--let $x=Can't generate\n";
    const stmts = parseMt(src, undefined);
    const literal = extractTokens(stmts, src).find(
      (t) => t.type === T.string && t.isStringContent === false
    );
    expect(literal).toBeDefined();
    expect(src.substring(literal!.offset, literal!.offset + literal!.length)).toBe(
      "Can't generate"
    );

    // backtick Query is left to TextMate's source.sql — no semantic token
    const src2 = "let $y= `SELECT 1`;\n";
    const stmts2 = parseMt(src2, undefined);
    const queryTokens = extractTokens(stmts2, src2).filter(
      (t) => t.type === T.string && t.isStringContent === true
    );
    expect(queryTokens.length).toBe(0);
  });

  it("handles multiple statements without offset drift", () => {
    const src = "--source a.inc\necho hi;\n# c\n";
    const stmts = parseMt(src, undefined);
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
    const stmts = parseMt(src, undefined);
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
    const stmts = parseMt(src, undefined);
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
