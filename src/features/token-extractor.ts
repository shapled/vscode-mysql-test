import {
  Comment,
  Sql,
  DashCommand,
  If,
  While,
  Source,
  Echo,
  Output,
  Let,
  Inc,
  Dec,
  WriteFile,
  AppendFile,
  RemoveFile,
  CatFile,
  Mkdir,
  Rmdir,
  FileExists,
  CopyFile,
  MoveFile,
  DiffFiles,
  Chmod,
  Perl,
  Expr,
  Variable,
  QueryGetValue,
  QueryValue,
  Text as LetText,
  Escape,
  ConvertError,
} from "@shapled/mtparser/ast";
import type {
  Span$ as Span,
  Statement$ as Statement,
  InterpolatedText,
  Marker$ as Marker,
} from "@shapled/mtparser/ast";
import { statementSpan, interpolatedToRaw } from "../ast/helpers";

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
  if (stmt instanceof Comment) {
    tokens.push({ offset: stmt.span.offset, length: stmt.span.len, type: T.comment, modifiers: 0 });
    return;
  }
  // SQL statements are fully handled by TextMate's source.sql rules.
  if (stmt instanceof Sql) return;

  // mtparser 0.4 wraps `--` prefixed commands in a DashCommand node whose
  // span covers the full command (including the prefix) — the same region
  // the statement span covered before 0.4.
  const isDashCmd = stmt instanceof DashCommand;
  const inner = isDashCmd ? stmt.statement : stmt;
  const span = statementSpan(stmt);
  const stmtText = source.substring(span.offset, span.offset + span.len);

  // `--` prefix → operator (exact span from the AST)
  if (isDashCmd) {
    tokens.push({ offset: stmt.dash.offset, length: stmt.dash.len, type: T.operator, modifiers: 0 });
  }

  // Command terminator `;` (no-prefix commands only, not SQL) → operator.
  const trimmed = stmtText.replace(/\n+$/, "");
  if (trimmed.endsWith(";")) {
    const semiRel = trimmed.length - 1;
    tokens.push({ offset: span.offset + semiRel, length: 1, type: T.operator, modifiers: 0 });
  }

  // Command keyword (first identifier after optional `--`) → macro
  const cmdMatch = stmtText.match(/^[ \t]*(?:--[ \t]*)?([a-zA-Z_][a-zA-Z0-9_]*)/);
  if (cmdMatch) {
    const nameRel = stmtText.indexOf(cmdMatch[1], isDashCmd ? 2 : 0);
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
  if (inner instanceof If || inner instanceof While) {
    pushBraceTokens(inner.open_brace, inner.close_brace, tokens);
    for (const bodyStmt of inner.body) {
      processStatement(bodyStmt, source, tokens);
    }
  } else {
    pushVariantTokens(inner, source, tokens);
  }
}

function pushVariantTokens(
  stmt: Statement,
  source: string,
  tokens: RawToken[]
): void {
  if (stmt instanceof Source) {
    pushInterpolatedTokens(stmt.file, tokens);
  } else if (stmt instanceof Echo) {
    // Echo arguments are raw text (not SQL) — cover everything so TextMate
    // doesn't treat subsequent lines of a multi-line echo as SQL statements.
    pushInterpolatedTokens(stmt.text, tokens, true);
  } else if (stmt instanceof Output) {
    pushInterpolatedTokens(stmt.file, tokens, true);
  } else if (stmt instanceof Let) {
    pushLetTokens(stmt, source, tokens);
  } else if (stmt instanceof Inc) {
    pushVariableSpanToken(stmt.variable_span, tokens);
  } else if (stmt instanceof Dec) {
    pushVariableSpanToken(stmt.variable_span, tokens);
  } else if (stmt instanceof Expr) {
    pushVariableSpanToken(stmt.variable_span, tokens);
  } else if (stmt instanceof WriteFile) {
    pushInterpolatedTokens(stmt.filename, tokens);
    pushMarkerTokens(stmt.open, stmt.close, tokens);
    pushBlockContentTokens(source, stmt.open, stmt.close, tokens);
  } else if (stmt instanceof AppendFile) {
    pushInterpolatedTokens(stmt.filename, tokens);
    pushMarkerTokens(stmt.open, stmt.close, tokens);
    pushBlockContentTokens(source, stmt.open, stmt.close, tokens);
  } else if (stmt instanceof RemoveFile) {
    pushInterpolatedTokens(stmt.file, tokens);
  } else if (stmt instanceof CatFile) {
    pushInterpolatedTokens(stmt.file, tokens);
  } else if (stmt instanceof Mkdir) {
    pushInterpolatedTokens(stmt.dir, tokens);
  } else if (stmt instanceof Rmdir) {
    pushInterpolatedTokens(stmt.dir, tokens);
  } else if (stmt instanceof FileExists) {
    pushInterpolatedTokens(stmt.file, tokens);
  } else if (stmt instanceof CopyFile) {
    pushInterpolatedTokens(stmt.source, tokens);
    pushInterpolatedTokens(stmt.dest, tokens);
  } else if (stmt instanceof MoveFile) {
    pushInterpolatedTokens(stmt.source, tokens);
    pushInterpolatedTokens(stmt.dest, tokens);
  } else if (stmt instanceof DiffFiles) {
    pushInterpolatedTokens(stmt.file1, tokens);
    pushInterpolatedTokens(stmt.file2, tokens);
  } else if (stmt instanceof Chmod) {
    pushInterpolatedTokens(stmt.file, tokens);
  } else if (stmt instanceof Perl) {
    pushMarkerTokens(stmt.open, stmt.close, tokens);
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
    if (part instanceof Variable) {
      const sp = part.span;
      tokens.push({ offset: sp.offset, length: sp.len, type: T.variable, modifiers: 0 });
    } else {
      const t = part.text;
      if (!coverAll && !t.includes("'") && !t.includes('"')) continue;
      let offset = part.span.offset;
      let length = part.span.len;
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
  cmd: Let,
  source: string,
  tokens: RawToken[]
): void {
  // Declaration site: exact span of the `$name` token on the LHS.
  const vs = cmd.variable_span;
  if (vs.len > 0) {
    tokens.push({
      offset: vs.offset,
      length: vs.len,
      type: T.variable,
      modifiers: M.declaration,
    });
  }

  // Value: Text → plain text (only if it contains quotes)
  // QueryValue (backtick SQL): SQL text is left to TextMate, but $var
  // references inside the query carry exact TextPart spans — highlight them.
  // QueryGetValue → function name token; SQL args left to TextMate.
  const value = cmd.value;
  if (value instanceof QueryGetValue) {
    // The value span starts at the literal `query_get_value` callee.
    tokens.push({
      offset: value.span.offset,
      length: "query_get_value".length,
      type: T.macro,
      modifiers: 0,
    });
  } else if (value instanceof QueryValue) {
    for (const part of value.query.query) {
      if (part instanceof Variable) {
        tokens.push({
          offset: part.span.offset,
          length: part.span.len,
          type: T.variable,
          modifiers: 0,
        });
      }
    }
  } else if (value instanceof LetText) {
    const raw = interpolatedToRaw(value.value);
    if (raw.includes("'") || raw.includes('"')) {
      const loc = partsRegion(value.value);
      if (loc && loc.length > 0) {
        tokens.push({ offset: loc.offset, length: loc.length, type: T.string, modifiers: 0, isStringContent: false });
      }
    }
  } else if (value instanceof Escape) {
    // `escape(CHARACTERS, TEXT)` — the parser already resolved which `)` is
    // the real closing paren (a `)` in CHARACTERS first position is an
    // argument, per mysqltest.cc); the grammar cannot know this.
    pushLetCallTokens(
      "escape",
      value.span,
      [value.characters, value.string],
      source,
      tokens
    );
  } else if (value instanceof ConvertError) {
    pushLetCallTokens(
      "convert_error",
      value.span,
      [value.argument],
      source,
      tokens
    );
  }
}

/**
 * Tokens for a function-call let value: function name, the real opening and
 * closing parens (both resolvable only via the AST span), and the argument
 * parts (Literal → string, Variable → variable).
 */
function pushLetCallTokens(
  name: string,
  span: Span,
  argLists: InterpolatedText[],
  source: string,
  tokens: RawToken[]
): void {
  // Function name at the start of the call span.
  tokens.push({
    offset: span.offset,
    length: name.length,
    type: T.macro,
    modifiers: 0,
  });

  // Opening paren: first `(` inside the call span.
  const openRel = source.indexOf("(", span.offset);
  if (openRel >= 0 && openRel < span.offset + span.len) {
    tokens.push({ offset: openRel, length: 1, type: T.operator, modifiers: 0 });
  }

  // Closing paren: the call span ends at the real `)` — any earlier `)` is
  // a character argument and is covered by the argument tokens below.
  const close = span.offset + span.len - 1;
  if (source.charAt(close) === ")") {
    tokens.push({ offset: close, length: 1, type: T.operator, modifiers: 0 });
  }

  for (const parts of argLists) {
    pushInterpolatedTokens(parts, tokens, true);
  }
}

/** `$name` reference token from an exact AST span (inc/dec/expr targets). */
function pushVariableSpanToken(vs: Span, tokens: RawToken[]): void {
  if (vs.len > 0) {
    tokens.push({ offset: vs.offset, length: vs.len, type: T.variable, modifiers: 0 });
  }
}

/** Push operator tokens for a block command's end markers.
 *  - open: marker on the begin line (e.g. "EOF" in "--write_file path EOF").
 *          Zero-length when the marker is implicit (omitted, defaults to EOF).
 *  - close: marker on the terminator line. */
function pushMarkerTokens(open: Marker, close: Marker, tokens: RawToken[]): void {
  if (open.span.len > 0) {
    tokens.push({ offset: open.span.offset, length: open.span.len, type: T.operator, modifiers: 0 });
  }
  if (close.span.len > 0) {
    tokens.push({ offset: close.span.offset, length: close.span.len, type: T.operator, modifiers: 0 });
  }
}

/** Push operator tokens for `{` and `}` braces of an If/While block. */
function pushBraceTokens(
  openBrace: Span,
  closeBrace: Span,
  tokens: RawToken[]
): void {
  if (openBrace.len > 0) {
    tokens.push({ offset: openBrace.offset, length: openBrace.len, type: T.operator, modifiers: 0 });
  }
  if (closeBrace.len > 0) {
    tokens.push({ offset: closeBrace.offset, length: closeBrace.len, type: T.operator, modifiers: 0 });
  }
}

/**
 * Mark block content (write_file/append_file body) as string.
 *
 * mtparser 0.4 exposes content as a raw string without per-part spans, so
 * the region is derived from the marker spans: everything between the end
 * of the command's begin line and the start of the close-marker line.
 */
function pushBlockContentTokens(
  source: string,
  open: Marker,
  close: Marker,
  tokens: RawToken[]
): void {
  const afterBegin = open.span.offset + Math.max(open.span.len, 0);
  const nl = source.indexOf("\n", afterBegin);
  if (nl < 0) return;
  const start = nl + 1;
  // End: start of the line carrying the close marker.
  const closeNl = source.lastIndexOf("\n", Math.max(close.span.offset - 1, 0));
  const end = closeNl >= 0 ? closeNl + 1 : close.span.offset;
  if (end > start) {
    tokens.push({
      offset: start,
      length: end - start,
      type: T.string,
      modifiers: 0,
      isStringContent: true,
    });
  }
}

/** Region covering an InterpolatedText (first part start → last part end). */
function partsRegion(
  text: InterpolatedText
): { offset: number; length: number } | undefined {
  let first: Span | undefined;
  let last: Span | undefined;
  for (const part of text) {
    const sp = part.span;
    if (!first) first = sp;
    last = sp;
  }
  if (!first || !last) return undefined;
  return { offset: first.offset, length: last.offset + last.len - first.offset };
}
