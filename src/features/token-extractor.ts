import type { Statement, InterpolatedText, Span, EndMarker } from "@shapled/mtparser";
import { statementSpan } from "../ast/helpers";

/**
 * Pure AST → token extraction. No vscode dependency.
 *
 * Shared by:
 *   - semantic-tokens.ts (DocumentSemanticTokensProvider)
 *
 * Token types are stable indices; consumers map them to whatever output
 * they need (semantic legend, decoration type, etc).
 */

export const TOKEN_TYPES = [
  "function", // 0: mysqltest command keyword, query_get_value function name
  "variable", // 1: $variable reference
  "string",   // 2: literal text, backtick SQL, perl blocks
  "comment",  // 3: # comment
  "operator", // 4: `--` prefix
  "number",   // 5: numeric literal (reserved)
] as const;

export const TOKEN_MODIFIERS = [
  "declaration", // 0: variable declaration (LHS of --let)
] as const;

export const T = {
  macro: 0,
  variable: 1,
  string: 2,
  comment: 3,
  operator: 4,
  number: 5,
} as const;

export const M = {
  declaration: 1 << 0,
} as const;

export interface RawToken {
  offset: number;
  length: number;
  type: number;
  modifiers: number;
  /**
   * For T.string tokens: true = real string content (backtick SQL, perl
   * block) that should use the theme's string colour; false = Literal text
   * in a command argument that should use the default foreground.
   */
  isStringContent?: boolean;
}

/** Walk the AST and collect semantic tokens with absolute byte offsets. */
export function extractTokens(
  statements: Statement[],
  source: string
): RawToken[] {
  const tokens: RawToken[] = [];
  for (const stmt of statements) {
    processStatement(stmt, source, tokens);
  }
  return tokens;
}

/** Process a single statement, recursing into If/While bodies. */
function processStatement(
  stmt: Statement,
  source: string,
  tokens: RawToken[]
): void {
  if (typeof stmt === "object" && "Comment" in stmt) {
    const sp = stmt.Comment.span;
    tokens.push({ offset: sp.offset, length: sp.len, type: T.comment, modifiers: 0 });
    return;
  }
  // SQL statements are fully handled by TextMate's source.sql rules.
  if (typeof stmt === "object" && "Sql" in stmt) return;
  if (typeof stmt !== "object") return; // "Empty" string variant

  const span = statementSpan(stmt);
  const stmtText = source.substring(span.offset, span.offset + span.len);

  // `--` prefix → operator
  const dashIdx = stmtText.indexOf("--");
  if (dashIdx >= 0 && dashIdx < 6) {
    tokens.push({ offset: span.offset + dashIdx, length: 2, type: T.operator, modifiers: 0 });
  }

  // Command terminator `;` (no-prefix commands only, not SQL) → operator.
  if (!("Sql" in stmt)) {
    const trimmed = stmtText.replace(/\n+$/, "");
    if (trimmed.endsWith(";")) {
      const semiRel = trimmed.length - 1;
      tokens.push({ offset: span.offset + semiRel, length: 1, type: T.operator, modifiers: 0 });
    }
  }

  // Command keyword (first identifier after optional `--`) → macro
  const cmdMatch = stmtText.match(/^[ \t]*(?:--[ \t]*)?([a-zA-Z_][a-zA-Z0-9_]*)/);
  if (cmdMatch) {
    const nameRel = stmtText.indexOf(cmdMatch[1], dashIdx >= 0 ? dashIdx + 2 : 0);
    if (nameRel >= 0) {
      tokens.push({
        offset: span.offset + nameRel,
        length: cmdMatch[1].length,
        type: T.macro,
        modifiers: 0,
      });
    }
  }

  // Recurse into If/While bodies — their nested statements need the same
  // token extraction (echo/die/let inside an if block, etc.).
  if ("If" in stmt) {
    pushBraceTokens(stmt.If, tokens);
    for (const bodyStmt of stmt.If.body) {
      processStatement(bodyStmt, source, tokens);
    }
  } else if ("While" in stmt) {
    pushBraceTokens(stmt.While, tokens);
    for (const bodyStmt of stmt.While.body) {
      processStatement(bodyStmt, source, tokens);
    }
  } else {
    pushVariantTokens(stmt, span, stmtText, tokens);
  }
}

function pushVariantTokens(
  stmt: Exclude<Statement, "Empty" | string>,
  span: Span,
  stmtText: string,
  tokens: RawToken[]
): void {
  if ("Source" in stmt) {
    pushInterpolatedTokens(stmt.Source.file, tokens);
  } else if ("Echo" in stmt) {
    // Echo arguments are raw text (not SQL) — cover everything so TextMate
    // doesn't treat subsequent lines of a multi-line echo as SQL statements.
    pushInterpolatedTokens(stmt.Echo.text, tokens, true);
  } else if ("Output" in stmt) {
    pushInterpolatedTokens(stmt.Output.file, tokens, true);
  } else if ("Let" in stmt) {
    pushLetTokens(stmt, span, stmtText, tokens);
  } else if ("Inc" in stmt) {
    pushVariableTokenByName(stmt.Inc.variable, span, stmtText, tokens);
  } else if ("Dec" in stmt) {
    pushVariableTokenByName(stmt.Dec.variable, span, stmtText, tokens);
  } else if ("WriteFile" in stmt) {
    pushInterpolatedTokens(stmt.WriteFile.filename, tokens);
    pushEndMarkerTokens(stmt.WriteFile.end_marker, tokens);
    pushFileContentTokens(stmt.WriteFile.content, tokens);
  } else if ("AppendFile" in stmt) {
    pushInterpolatedTokens(stmt.AppendFile.filename, tokens);
    pushEndMarkerTokens(stmt.AppendFile.end_marker, tokens);
    pushFileContentTokens(stmt.AppendFile.content, tokens);
  } else if ("RemoveFile" in stmt) {
    pushInterpolatedTokens(stmt.RemoveFile.file, tokens);
  } else if ("CatFile" in stmt) {
    pushInterpolatedTokens(stmt.CatFile.file, tokens);
  } else if ("Mkdir" in stmt) {
    pushInterpolatedTokens(stmt.Mkdir.dir, tokens);
  } else if ("Rmdir" in stmt) {
    pushInterpolatedTokens(stmt.Rmdir.dir, tokens);
  } else if ("FileExists" in stmt) {
    pushInterpolatedTokens(stmt.FileExists.file, tokens);
  } else if ("CopyFile" in stmt) {
    pushInterpolatedTokens(stmt.CopyFile.source, tokens);
    pushInterpolatedTokens(stmt.CopyFile.dest, tokens);
  } else if ("MoveFile" in stmt) {
    pushInterpolatedTokens(stmt.MoveFile.source, tokens);
    pushInterpolatedTokens(stmt.MoveFile.dest, tokens);
  } else if ("DiffFiles" in stmt) {
    pushInterpolatedTokens(stmt.DiffFiles.file1, tokens);
    pushInterpolatedTokens(stmt.DiffFiles.file2, tokens);
  } else if ("Chmod" in stmt) {
    pushInterpolatedTokens(stmt.Chmod.file, tokens);
  } else if ("Perl" in stmt) {
    pushEndMarkerTokens(stmt.Perl.end_marker, tokens);
  }
}

/** Literal → string, Variable → variable.
 *  - coverAll=true: every Literal part gets a token (for raw-text commands
 *    like echo where TextMate would otherwise miscolour multi-line content).
 *  - coverAll=false: only Literal parts containing a quote char get a token
 *    (so TextMate's normal highlighting is preserved elsewhere). */
function pushInterpolatedTokens(
  text: InterpolatedText,
  tokens: RawToken[],
  coverAll = false
): void {
  for (const part of text) {
    if ("Variable" in part) {
      const sp = part.Variable.span;
      tokens.push({ offset: sp.offset, length: sp.len, type: T.variable, modifiers: 0 });
    } else {
      const t = part.Literal.text;
      if (!coverAll && !t.includes("'") && !t.includes('"')) continue;
      let offset = part.Literal.span.offset;
      let length = part.Literal.span.len;
      if (coverAll && t.endsWith(";")) {
        length -= 1;
      }
      if (length > 0) {
        tokens.push({ offset, length, type: T.string, modifiers: 0, isStringContent: false });
      }
    }
  }
}

function pushLetTokens(
  stmt: Extract<Statement, { Let: unknown }>,
  span: Span,
  stmtText: string,
  tokens: RawToken[]
): void {
  const cmd = stmt.Let;

  // Declaration site: `$name` on the LHS
  const declNeedle = `$${cmd.variable}`;
  const rel = stmtText.indexOf(declNeedle);
  if (rel >= 0) {
    tokens.push({
      offset: span.offset + rel,
      length: declNeedle.length,
      type: T.variable,
      modifiers: M.declaration,
    });
  }

  // Value: Literal → plain text (only if it contains quotes)
  // Query (backtick SQL) is left to TextMate's backtick rule + source.sql.
  // QueryGetValue → function name + punctuation tokens; SQL args left to TextMate.
  if ("QueryGetValue" in cmd.value) {
    pushQueryGetValueTokens(cmd.value.QueryGetValue, tokens);
  } else if ("Literal" in cmd.value) {
    const t = cmd.value.Literal.value;
    if (t.includes("'") || t.includes('"')) {
      const sp = cmd.value.Literal.span;
      tokens.push({ offset: sp.offset, length: sp.len, type: T.string, modifiers: 0, isStringContent: false });
    }
  }
}

function pushVariableTokenByName(
  name: string,
  span: Span,
  stmtText: string,
  tokens: RawToken[]
): void {
  const needle = `$${name}`;
  const rel = stmtText.indexOf(needle);
  if (rel >= 0) {
    tokens.push({
      offset: span.offset + rel,
      length: needle.length,
      type: T.variable,
      modifiers: 0,
    });
  }
}

/** Push operator tokens for a block command's end_marker (open + close). */
function pushEndMarkerTokens(em: EndMarker, tokens: RawToken[]): void {
  // open_span: marker on the begin line (e.g. "EOF" in "--write_file path EOF").
  //            Zero-length when the marker is implicit (omitted, defaults to EOF).
  if (em.open_span.len > 0) {
    tokens.push({ offset: em.open_span.offset, length: em.open_span.len, type: T.operator, modifiers: 0 });
  }
  // close_span: marker on the terminator line.
  if (em.close_span.len > 0) {
    tokens.push({ offset: em.close_span.offset, length: em.close_span.len, type: T.operator, modifiers: 0 });
  }
}

/** Push operator tokens for `{` and `}` braces of an If/While block. */
function pushBraceTokens(
  block: { open_brace_span?: Span; close_brace_span?: Span },
  tokens: RawToken[]
): void {
  if (block.open_brace_span && block.open_brace_span.len > 0) {
    tokens.push({ offset: block.open_brace_span.offset, length: block.open_brace_span.len, type: T.operator, modifiers: 0 });
  }
  if (block.close_brace_span && block.close_brace_span.len > 0) {
    tokens.push({ offset: block.close_brace_span.offset, length: block.close_brace_span.len, type: T.operator, modifiers: 0 });
  }
}

/** Push tokens for query_get_value call: function name + punctuation.
 *  Arguments (SQL, column name, row number) are left to TextMate. */
function pushQueryGetValueTokens(call: {
  function_name_span: Span;
  open_paren_span: Span;
  close_paren_span: Span;
  commas: Span[];
}, tokens: RawToken[]): void {
  // Function name → function token
  tokens.push({
    offset: call.function_name_span.offset,
    length: call.function_name_span.len,
    type: T.macro,
    modifiers: 0,
  });
  // Parentheses + commas → operator tokens
  for (const sp of [call.open_paren_span, ...call.commas, call.close_paren_span]) {
    if (sp.len > 0) {
      tokens.push({ offset: sp.offset, length: sp.len, type: T.operator, modifiers: 0 });
    }
  }
}

/** Mark file content (write_file/append_file body) as string. */
function pushFileContentTokens(content: InterpolatedText, tokens: RawToken[]): void {
  for (const part of content) {
    if ("Literal" in part) {
      const sp = part.Literal.span;
      if (sp.len > 0) {
        tokens.push({ offset: sp.offset, length: sp.len, type: T.string, modifiers: 0 });
      }
    }
  }
}
