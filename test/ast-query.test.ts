import { describe, it, expect, beforeAll } from "vitest";
import type { Statement, Span } from "@shapled/mtparser";
import { initWasm, parseMt } from "../src/wasm/wasm-loader";
import {
  interpolatedToRaw,
  interpolatedVariables,
} from "../src/ast/helpers";
import {
  findStatementAtOffset,
  findSourceCommands,
  sourcePath,
  findVariableDeclaration,
  findVariableOccurrences,
  findFilePaths,
} from "../src/ast/ast-query";

/** Parse text → typed statements. */
function parse(text: string): Statement[] {
  return parseMt(text, undefined);
}

// Initialize WASM once for all tests in this file.
beforeAll(async () => {
  await initWasm();
});

describe("mtparser WASM integration", () => {
  it("should parse a source command", () => {
    const stmts = parse("--source include/have_debug.inc\n");
    expect(stmts.length).toBe(1);
    expect("Source" in stmts[0]).toBe(true);
  });

  it("should parse multi-line write_file blocks as a single statement", () => {
    const input = [
      "write_file $MYSQL_TMP_DIR/data01;",
      "line one",
      "line two",
      "EOF",
      "",
    ].join("\n");
    const stmts = parse(input);
    // write_file + content + EOF → single WriteFile statement
    expect(stmts.length).toBe(1);
    expect("WriteFile" in stmts[0]).toBe(true);
  });

  it("should parse perl blocks as a single statement", () => {
    const input = [
      "perl END_PERL;",
      'print "hello\\n";',
      "END_PERL",
      "",
    ].join("\n");
    const stmts = parse(input);
    expect(stmts.length).toBe(1);
    expect("Perl" in stmts[0] || "Other" in stmts[0]).toBe(true);
  });

  it("should parse multi-line echo with embedded variables as one statement", () => {
    const input = [
      'echo "INSERT INTO I_S_published_schema',
      "       VALUES ('$current_mysqld_version', '$current_mysqld_version', $lctn,",
      "               '$whole_checksum');\";",
    ].join("\n");
    const stmts = parse(input);
    expect(stmts.length).toBe(1);
    expect("Echo" in stmts[0]).toBe(true);
    // All three variables must be recognized
    if ("Echo" in stmts[0]) {
      const vars = stmts[0].Echo.text
        .filter((p): p is { Variable: { name: string; span: Span } } => "Variable" in p)
        .map((p) => p.Variable.name);
      expect(vars).toEqual([
        "current_mysqld_version",
        "current_mysqld_version",
        "lctn",
        "whole_checksum",
      ]);
    }
  });
});

describe("ast-query", () => {
  // ── Source commands ──

  describe("findSourceCommands", () => {
    it("finds all --source directives", () => {
      const stmts = parse(
        "--source include/a.inc\n--source include/b.inc\necho hi;\n"
      );
      const sources = findSourceCommands(stmts);
      expect(sources.length).toBe(2);
    });

    it("extracts the raw path with sourcePath()", () => {
      const stmts = parse("--source include/have_debug.inc\n");
      const sources = findSourceCommands(stmts);
      expect(sourcePath(sources[0])).toBe("include/have_debug.inc");
    });

    it("extracts paths containing $variables", () => {
      const stmts = parse("--source $MYSQL_TMP_DIR/foo.inc\n");
      const sources = findSourceCommands(stmts);
      expect(sourcePath(sources[0])).toBe("$MYSQL_TMP_DIR/foo.inc");
    });
  });

  // ── findStatementAtOffset ──

  describe("findStatementAtOffset", () => {
    it("finds the statement containing an offset", () => {
      const text = "--source include/a.inc\n--let $x = 1\n";
      const stmts = parse(text);
      // span starts at "let" (excludes "--"), so use that offset
      const letOffset = text.indexOf("let");
      const stmt = findStatementAtOffset(stmts, letOffset);
      expect(stmt && "Let" in stmt).toBe(true);
    });

    it("returns undefined for offset outside any statement", () => {
      const text = "--source include/a.inc\n";
      const stmts = parse(text);
      // past the end
      expect(findStatementAtOffset(stmts, text.length + 10)).toBeUndefined();
    });
  });

  // ── Variable declarations ──

  describe("findVariableDeclaration", () => {
    it("finds a --let declaration by variable name", () => {
      const stmts = parse("--let $counter = 5\n");
      const decl = findVariableDeclaration(stmts, "counter");
      expect(decl).toBeDefined();
      expect(decl!.variable).toBe("counter");
    });

    it("returns undefined for unknown variable", () => {
      const stmts = parse("--let $x = 1\n");
      expect(findVariableDeclaration(stmts, "y")).toBeUndefined();
    });

    it("preserves backtick Query value for let with embedded SQL", () => {
      const stmts = parse(
        "let $rcd= `SELECT REPLACE('$MYSQL_CHARSETSDIR', '\\\\', '.')`;\n"
      );
      const decl = findVariableDeclaration(stmts, "rcd");
      expect(decl).toBeDefined();
      expect("Query" in decl!.value).toBe(true);
      if ("Query" in decl!.value) {
        expect(decl!.value.Query.query).toContain("SELECT REPLACE");
      }
    });
  });

  // ── Variable occurrences ──

  describe("findVariableOccurrences", () => {
    it("finds declaration and references", () => {
      const text = "--let $x = 1\n--echo $x\n--inc $x\n";
      const stmts = parse(text);
      const occs = findVariableOccurrences(stmts, "x", text);
      // declaration + echo reference + inc reference
      expect(occs.length).toBeGreaterThanOrEqual(2);
      expect(occs.some((o) => o.isDeclaration)).toBe(true);
    });
  });

  // ── File paths ──

  describe("findFilePaths", () => {
    it("extracts paths from various File I/O commands", () => {
      const text = [
        "--source include/a.inc",
        "--write_file /tmp/x EOF",
        "hello",
        "EOF",
        "--mkdir /tmp/newdir",
      ].join("\n");
      const stmts = parse(text);
      const refs = findFilePaths(stmts, text);
      const paths = refs.map((r) => r.path);
      expect(paths).toContain("include/a.inc");
      expect(paths).toContain("/tmp/x");
      expect(paths).toContain("/tmp/newdir");
    });

    it("computes precise path token spans", () => {
      const text = "--source include/a.inc\n";
      const stmts = parse(text);
      const refs = findFilePaths(stmts, text);
      expect(refs.length).toBe(1);
      const ref = refs[0];
      // The path token should be "include/a.inc", not the whole command
      const token = text.substring(ref.offset, ref.offset + ref.length);
      expect(token).toBe("include/a.inc");
    });
  });
});

describe("InterpolatedText helpers", () => {
  it("renders raw string from parts", () => {
    const text = parse("--source $VAR/path.inc\n");
    if ("Source" in text[0]) {
      const raw = interpolatedToRaw(text[0].Source.file);
      expect(raw).toBe("$VAR/path.inc");
    }
  });

  it("extracts variable names", () => {
    const text = parse("--source $VAR/path.inc\n");
    if ("Source" in text[0]) {
      const vars = interpolatedVariables(text[0].Source.file);
      expect(vars).toEqual(["VAR"]);
    }
  });
});

// ── Span accuracy tests (mtparser 0.3.2+) ────────────────
// All spans are now absolute document byte offsets.

describe("span accuracy", () => {
  it("Source: file part span points at the path token", () => {
    const text = "--source include/have_debug.inc\n";
    const stmts = parse(text);
    if ("Source" in stmts[0]) {
      const part = stmts[0].Source.file[0];
      if ("Literal" in part) {
        const { offset, len } = part.Literal.span;
        expect(text.substring(offset, offset + len)).toBe(
          "include/have_debug.inc"
        );
      }
    }
  });

  it("Echo: each text part span points at its exact text", () => {
    const text = 'echo value is $rcd;';
    const stmts = parse(text + "\n");
    if ("Echo" in stmts[0]) {
      const parts = stmts[0].Echo.text;
      // Literal "value is "
      const lit = parts[0];
      if ("Literal" in lit) {
        const { offset, len } = lit.Literal.span;
        expect(text.substring(offset, offset + len)).toBe("value is ");
      }
      // Variable "$rcd"
      const vr = parts[1];
      if ("Variable" in vr) {
        const { offset, len } = vr.Variable.span;
        expect(text.substring(offset, offset + len)).toBe("$rcd");
      }
    }
  });

  it("Echo: variable span includes the $ prefix", () => {
    const text = "echo hi $name;\n";
    const stmts = parse(text);
    if ("Echo" in stmts[0]) {
      const vr = stmts[0].Echo.text.find((p) => "Variable" in p);
      if (vr && "Variable" in vr) {
        const { offset, len } = vr.Variable.span;
        expect(text.substring(offset, offset + len)).toBe("$name");
      }
    }
  });

  it("Let: Query span covers the backtick SQL including backticks", () => {
    const text = "let $rcd= `SELECT 1`;\n";
    const stmts = parse(text);
    if ("Let" in stmts[0] && "Query" in stmts[0].Let.value) {
      const { offset, len } = stmts[0].Let.value.Query.span;
      expect(text.substring(offset, offset + len)).toBe("`SELECT 1`");
    }
  });

  it("Let: Literal value span points at the literal", () => {
    const text = "let $x = 5;\n";
    const stmts = parse(text);
    if ("Let" in stmts[0] && "Literal" in stmts[0].Let.value) {
      const { offset, len } = stmts[0].Let.value.Literal.span;
      expect(text.substring(offset, offset + len)).toBe("5");
    }
  });

  it("spans use absolute offsets across multiple statements", () => {
    const text = "--source include/a.inc\necho hi $name;\n";
    const stmts = parse(text);
    // Second statement's variable must resolve via absolute offset
    if ("Echo" in stmts[1]) {
      const vr = stmts[1].Echo.text.find((p) => "Variable" in p);
      if (vr && "Variable" in vr) {
        const { offset, len } = vr.Variable.span;
        expect(text.substring(offset, offset + len)).toBe("$name");
      }
    }
  });

  it("variable span in multi-line echo is accurate", () => {
    const text = [
      'echo "INSERT INTO I_S_published_schema',
      "       VALUES ('$current_mysqld_version', $lctn);",
      '"',
    ].join("\n");
    const stmts = parse(text + "\n");
    if ("Echo" in stmts[0]) {
      const vars = stmts[0].Echo.text.filter((p) => "Variable" in p);
      for (const v of vars) {
        if ("Variable" in v) {
          const { offset, len } = v.Variable.span;
          const token = text.substring(offset, offset + len);
          // Each variable span must resolve to $name in the original text
          expect(token.startsWith("$")).toBe(true);
          expect(token).toBe(`$${v.Variable.name}`);
        }
      }
    }
  });
});
