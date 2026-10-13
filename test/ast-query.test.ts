import { describe, it, expect } from "vitest";
import {
  Source,
  WriteFile,
  Echo,
  Perl,
  Let,
  Variable,
  QueryValue,
  Text as LetText,
} from "@shapled/mtparser/ast";
import { parseMt } from "../src/ast/parse";
import {
  interpolatedToRaw,
  interpolatedVariables,
} from "../src/ast/helpers";
import {
  unwrapStatement,
  findStatementAtOffset,
  findSourceCommands,
  sourcePath,
  findVariableDeclaration,
  findVariableOccurrences,
  findFilePaths,
} from "../src/ast/ast-query";

/** Parse text → typed statements. */
function parse(text: string) {
  return parseMt(text);
}

describe("mtparser integration", () => {
  it("should parse a source command", () => {
    const stmts = parse("--source include/have_debug.inc\n");
    expect(stmts.length).toBe(1);
    expect(unwrapStatement(stmts[0]) instanceof Source).toBe(true);
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
    expect(unwrapStatement(stmts[0]) instanceof WriteFile).toBe(true);
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
    expect(unwrapStatement(stmts[0]) instanceof Perl).toBe(true);
  });

  it("should parse multi-line echo with embedded variables as one statement", () => {
    const input = [
      'echo "INSERT INTO I_S_published_schema',
      "       VALUES ('$current_mysqld_version', '$current_mysqld_version', $lctn,",
      "               '$whole_checksum');\";",
    ].join("\n");
    const stmts = parse(input);
    expect(stmts.length).toBe(1);
    const echo = unwrapStatement(stmts[0]);
    expect(echo instanceof Echo).toBe(true);
    // All four variables must be recognized
    if (echo instanceof Echo) {
      const vars = [...echo.text]
        .filter((p) => p instanceof Variable)
        .map((p) => (p as Variable).name);
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
      const letOffset = text.indexOf("let");
      const stmt = findStatementAtOffset(stmts, letOffset);
      expect(stmt !== undefined && unwrapStatement(stmt) instanceof Let).toBe(true);
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
      expect(decl!.value instanceof QueryValue).toBe(true);
      if (decl!.value instanceof QueryValue) {
        // query is an InterpolatedText since mtparser 0.4.x TextPart upgrade
        expect(interpolatedToRaw(decl!.value.query.query)).toContain("SELECT REPLACE");
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

    it("finds declarations and condition refs inside while/if blocks", () => {
      // Real shape (rpl_replica_net_timeout.test): the let and the if that
      // reads it both live inside a while body.
      const text = [
        "--let $timeout= 3",
        "while ($timeout)",
        "{",
        "  --let $ts_flag= 1",
        "  if($ts_flag)",
        "  {",
        "     --let $timeout=1",
        "  }",
        "  --dec $timeout",
        "}",
        "",
      ].join("\n");
      const stmts = parse(text);
      const decl = findVariableDeclaration(stmts, "ts_flag");
      expect(decl, "declaration inside while body must be found").toBeDefined();

      const occs = findVariableOccurrences(stmts, "ts_flag", text);
      const decls = occs.filter((o) => o.isDeclaration);
      const refs = occs.filter((o) => !o.isDeclaration);
      expect(decls.length).toBe(1);
      // reference in if($ts_flag) inside the while body
      expect(refs.some((o) => text.substring(o.offset, o.offset + o.length) === "$ts_flag" && o.offset > text.indexOf("if("))).toBe(true);
      // each location reported exactly once (no block-rescan duplicates)
      const offsets = occs.map((o) => o.offset);
      expect(new Set(offsets).size).toBe(offsets.length);
    });

    it("finds condition variable occurrences in while header", () => {
      const text = ["while ($timeout)", "{", "  --dec $timeout", "}", ""].join("\n");
      const stmts = parse(text);
      const occs = findVariableOccurrences(stmts, "timeout", text);
      // header condition + --dec target, no duplicates
      expect(occs.length).toBe(2);
      const offsets = occs.map((o) => o.offset);
      expect(new Set(offsets).size).toBe(2);
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
      const refs = findFilePaths(stmts);
      const paths = refs.map((r) => r.path);
      expect(paths).toContain("include/a.inc");
      expect(paths).toContain("/tmp/x");
      expect(paths).toContain("/tmp/newdir");
    });

    it("computes precise path token spans", () => {
      const text = "--source include/a.inc\n";
      const stmts = parse(text);
      const refs = findFilePaths(stmts);
      expect(refs.length).toBe(1);
      const ref = refs[0];
      // The path token should be "include/a.inc", not the whole command
      const token = text.substring(ref.offset, ref.offset + ref.length);
      expect(token).toBe("include/a.inc");
    });

    it("chmod path token points at the file, not the mode", () => {
      const text = "--chmod 0644 /tmp/foo.txt\n";
      const refs = findFilePaths(parse(text));
      expect(refs.length).toBe(1);
      expect(text.substring(refs[0].offset, refs[0].offset + refs[0].length)).toBe("/tmp/foo.txt");
      expect(refs[0].path).toBe("/tmp/foo.txt");
    });

    it("variables in paths keep exact spans and are flagged", () => {
      const text = "--source $MYSQL_TMP_DIR/foo.inc\n";
      const refs = findFilePaths(parse(text));
      expect(refs[0].path).toBe("$MYSQL_TMP_DIR/foo.inc");
      expect(refs[0].hasVariables).toBe(true);
      expect(text.substring(refs[0].offset, refs[0].offset + refs[0].length)).toBe("$MYSQL_TMP_DIR/foo.inc");
    });
  });
});

describe("InterpolatedText helpers", () => {
  it("renders raw string from parts", () => {
    const text = parse("--source $VAR/path.inc\n");
    const src = unwrapStatement(text[0]);
    if (src instanceof Source) {
      const raw = interpolatedToRaw(src.file);
      expect(raw).toBe("$VAR/path.inc");
    }
  });

  it("extracts variable names", () => {
    const text = parse("--source $VAR/path.inc\n");
    const src = unwrapStatement(text[0]);
    if (src instanceof Source) {
      const vars = interpolatedVariables(src.file);
      expect(vars).toEqual(["VAR"]);
    }
  });
});

// ── Span accuracy tests ───────────────────────────────────
// All spans are absolute document byte offsets.

describe("span accuracy", () => {
  it("Source: file part span points at the path token", () => {
    const text = "--source include/have_debug.inc\n";
    const stmts = parse(text);
    const src = unwrapStatement(stmts[0]);
    if (src instanceof Source) {
      const part = [...src.file][0];
      const { offset, len } = part.span;
      expect(text.substring(offset, offset + len)).toBe(
        "include/have_debug.inc"
      );
    }
  });

  it("Echo: each text part span points at its exact text", () => {
    const text = 'echo value is $rcd;';
    const stmts = parse(text + "\n");
    const echo = unwrapStatement(stmts[0]);
    if (echo instanceof Echo) {
      const parts = [...echo.text];
      // Literal "value is "
      const lit = parts[0];
      const { offset, len } = lit.span;
      expect(text.substring(offset, offset + len)).toBe("value is ");
      // Variable "$rcd"
      const vr = parts[1];
      const vsp = vr.span;
      expect(text.substring(vsp.offset, vsp.offset + vsp.len)).toBe("$rcd");
    }
  });

  it("Echo: variable span includes the $ prefix", () => {
    const text = "echo hi $name;\n";
    const stmts = parse(text);
    const echo = unwrapStatement(stmts[0]);
    if (echo instanceof Echo) {
      const vr = [...echo.text].find((p) => p instanceof Variable);
      if (vr) {
        const { offset, len } = vr.span;
        expect(text.substring(offset, offset + len)).toBe("$name");
      }
    }
  });

  it("Let: QueryValue span covers the backtick SQL including backticks", () => {
    const text = "let $rcd= `SELECT 1`;\n";
    const stmts = parse(text);
    const let_ = unwrapStatement(stmts[0]);
    if (let_ instanceof Let && let_.value instanceof QueryValue) {
      const { offset, len } = let_.value.query.span;
      expect(text.substring(offset, offset + len)).toBe("`SELECT 1`");
    }
  });

  it("Let: Text value part span points at the literal", () => {
    const text = "let $x = 5;\n";
    const stmts = parse(text);
    const let_ = unwrapStatement(stmts[0]);
    if (let_ instanceof Let && let_.value instanceof LetText) {
      const part = [...let_.value.value][0];
      const { offset, len } = part.span;
      expect(text.substring(offset, offset + len)).toBe("5");
    }
  });

  it("spans use absolute offsets across multiple statements", () => {
    const text = "--source include/a.inc\necho hi $name;\n";
    const stmts = parse(text);
    // Second statement's variable must resolve via absolute offset
    const echo = unwrapStatement(stmts[1]);
    if (echo instanceof Echo) {
      const vr = [...echo.text].find((p) => p instanceof Variable);
      if (vr) {
        const { offset, len } = vr.span;
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
    const echo = unwrapStatement(stmts[0]);
    if (echo instanceof Echo) {
      const vars = [...echo.text].filter((p) => p instanceof Variable);
      for (const v of vars) {
        const { offset, len } = v.span;
        const token = text.substring(offset, offset + len);
        // Each variable span must resolve to $name in the original text
        expect(token.startsWith("$")).toBe(true);
        expect(token).toBe(`$${(v as Variable).name}`);
      }
    }
  });
});
