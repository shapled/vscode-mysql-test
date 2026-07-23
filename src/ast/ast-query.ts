import * as vscode from "vscode";
import type {
  Statement,
  Span,
  SourceCmd,
  LetCmd,
} from "@shapled/mtparser";
import {
  statementSpan,
  interpolatedToRaw,
  interpolatedVariables,
} from "./helpers";

/** Statement variants that are objects (excludes the "Empty" string variant). */
type ObjectStatement = Exclude<Statement, "Empty">;

/** Type guard: is this statement an object variant (not "Empty")? */
function isObjectStmt(s: Statement): s is ObjectStatement {
  return typeof s === "object";
}

/**
 * AST query helpers. Pure functions over Statement[] — no vscode dependency
 * except where a Position/Range is needed for the public API.
 */

/** Convert a (line, column) cursor to a byte offset in the document text. */
export function offsetAt(
  document: vscode.TextDocument,
  position: vscode.Position
): number {
  return document.offsetAt(position);
}

/** Check whether a span contains a byte offset (inclusive start, exclusive end). */
export function spanContains(span: Span, offset: number): boolean {
  return offset >= span.offset && offset < span.offset + span.len;
}

/** Find the statement containing the given byte offset, if any. */
export function findStatementAtOffset(
  statements: Statement[],
  offset: number
): Statement | undefined {
  return statements.find((s) => spanContains(statementSpan(s), offset));
}

// ── Source / include commands ────────────────────────────

/** Return all Source statements in the AST, in order. */
export function findSourceCommands(
  statements: Statement[]
): SourceCmd[] {
  return statements
    .filter(isObjectStmt)
    .filter((s): s is { Source: SourceCmd } => "Source" in s)
    .map((s) => s.Source);
}

/** Get the raw file path from a Source command (resolving $variables). */
export function sourcePath(cmd: SourceCmd): string {
  return interpolatedToRaw(cmd.file);
}

/** Check if a Source command's path contains a $variable reference. */
export function sourceHasVariables(cmd: SourceCmd): boolean {
  return interpolatedVariables(cmd.file).length > 0;
}

// ── Variables ────────────────────────────────────────────

/** Find a --let declaration for a variable name (without $ prefix). */
export function findVariableDeclaration(
  statements: Statement[],
  variableName: string
): LetCmd | undefined {
  return statements
    .filter(isObjectStmt)
    .filter((s): s is { Let: LetCmd } => "Let" in s)
    .map((s) => s.Let)
    .find((cmd) => cmd.variable === variableName);
}

/** All variable declarations in the AST, in source order. */
export function findAllDeclarations(statements: Statement[]): LetCmd[] {
  return statements
    .filter(isObjectStmt)
    .filter((s): s is { Let: LetCmd } => "Let" in s)
    .map((s) => s.Let);
}

/** A variable occurrence: either a declaration (write) or a reference (read). */
export interface VariableOccurrence {
  /** Byte offset of the $name token. */
  offset: number;
  /** Length of the token (including $). */
  length: number;
  /** Variable name without $ prefix. */
  name: string;
  /** True if this is the LHS of a --let assignment. */
  isDeclaration: boolean;
}

/**
 * Find all occurrences of a variable name across the AST.
 *
 * Scans --let declarations, --inc/--dec targets, and $var references
 * embedded in InterpolatedText (echo, source, let values, etc.).
 *
 * NOTE: Span granularity is statement-level, not token-level. To get exact
 * $var positions within a statement, this re-scans the statement's source
 * text for the literal `$name` pattern. This is a pragmatic tradeoff until
 * mtparser exposes finer-grained spans.
 */
export function findVariableOccurrences(
  statements: Statement[],
  variableName: string,
  sourceText: string
): VariableOccurrence[] {
  const results: VariableOccurrence[] = [];
  const needle = `$${variableName}`;

  for (const stmt of statements) {
    if (!isObjectStmt(stmt)) continue;
    const span = statementSpan(stmt);

    // --let declaration: LHS variable is the declaration site
    if ("Let" in stmt) {
      const cmd = stmt.Let;
      if (cmd.variable === variableName) {
        // The declaration's $name sits right after "--let " — approximate
        // its offset by scanning the statement's source text.
        const stmtText = sourceText.substring(span.offset, span.offset + span.len);
        const rel = stmtText.indexOf(needle);
        if (rel >= 0) {
          results.push({
            offset: span.offset + rel,
            length: needle.length,
            name: variableName,
            isDeclaration: true,
          });
          continue;
        }
      }
    }

    // For all statements: scan interpolated text + body for the variable.
    // This catches echo $x, source $VAR/path, let $y = $x, etc.
    const stmtText = sourceText.substring(span.offset, span.offset + span.len);
    let searchFrom = 0;
    while (true) {
      const rel = stmtText.indexOf(needle, searchFrom);
      if (rel < 0) break;
      // Skip if it's the declaration LHS (already handled above)
      const isDecl = "Let" in stmt && stmt.Let.variable === variableName && rel < stmtText.indexOf("=") ;
      results.push({
        offset: span.offset + rel,
        length: needle.length,
        name: variableName,
        isDeclaration: !!isDecl,
      });
      searchFrom = rel + needle.length;
    }
  }

  return results;
}

// ── File I/O commands ────────────────────────────────────

/** A file path found in the AST, with its precise token span. */
export interface FilePathRef {
  /** Byte offset of the path token (NOT the whole command). */
  offset: number;
  /** Length of the path token. */
  length: number;
  /** The raw file path (variables resolved). */
  path: string;
  /** Whether the path contains $variable references. */
  hasVariables: boolean;
}

/**
 * Extract all file paths from File I/O commands.
 *
 * @param statements - parsed AST
 * @param sourceText - the original document text, used to compute precise
 *   path-token spans (the AST only gives statement-level spans).
 */
export function findFilePaths(
  statements: Statement[],
  sourceText: string
): FilePathRef[] {
  const refs: FilePathRef[] = [];

  for (const stmt of statements) {
    if (!isObjectStmt(stmt)) continue;
    const span = statementSpan(stmt);
    const stmtText = sourceText.substring(span.offset, span.offset + span.len);

    if ("Source" in stmt) {
      pushRef(refs, span, stmtText, interpolatedToRaw(stmt.Source.file));
    } else if ("WriteFile" in stmt) {
      pushRef(refs, span, stmtText, interpolatedToRaw(stmt.WriteFile.filename));
    } else if ("AppendFile" in stmt) {
      pushRef(refs, span, stmtText, interpolatedToRaw(stmt.AppendFile.filename));
    } else if ("RemoveFile" in stmt) {
      pushRef(refs, span, stmtText, interpolatedToRaw(stmt.RemoveFile.file));
    } else if ("CatFile" in stmt) {
      pushRef(refs, span, stmtText, interpolatedToRaw(stmt.CatFile.file));
    } else if ("Mkdir" in stmt) {
      pushRef(refs, span, stmtText, interpolatedToRaw(stmt.Mkdir.dir));
    } else if ("Rmdir" in stmt) {
      pushRef(refs, span, stmtText, interpolatedToRaw(stmt.Rmdir.dir));
    } else if ("FileExists" in stmt) {
      pushRef(refs, span, stmtText, interpolatedToRaw(stmt.FileExists.file));
    } else if ("CopyFile" in stmt) {
      pushTwoRefs(refs, span, stmtText, [
        interpolatedToRaw(stmt.CopyFile.source),
        interpolatedToRaw(stmt.CopyFile.dest),
      ]);
    } else if ("MoveFile" in stmt) {
      pushTwoRefs(refs, span, stmtText, [
        interpolatedToRaw(stmt.MoveFile.source),
        interpolatedToRaw(stmt.MoveFile.dest),
      ]);
    } else if ("DiffFiles" in stmt) {
      pushTwoRefs(refs, span, stmtText, [
        interpolatedToRaw(stmt.DiffFiles.file1),
        interpolatedToRaw(stmt.DiffFiles.file2),
      ]);
    } else if ("Chmod" in stmt) {
      pushRef(refs, span, stmtText, interpolatedToRaw(stmt.Chmod.file));
    }
  }

  return refs;
}

/** Regex matching a command prefix like `--source `, `write_file `, etc. */
const CMD_PREFIX_RE = /^[ \t]*(?:--[ \t]*)?\S+[ \t]+/;

/** Semicolon/whitespace terminator for path tokens. */
const PATH_TAIL_RE = /(?=[ \t;]|$)/;

/** Find the first non-whitespace path token after the command name. */
function findFirstPathSpan(stmtText: string): { start: number; end: number } | undefined {
  const prefix = stmtText.match(CMD_PREFIX_RE);
  if (!prefix) return undefined;
  const start = prefix[0].length;
  const rest = stmtText.substring(start);
  const endRel = rest.search(PATH_TAIL_RE);
  if (endRel < 0) return undefined;
  return { start, end: start + endRel };
}

function pushRef(
  refs: FilePathRef[],
  span: Span,
  stmtText: string,
  path: string
): void {
  const loc = findFirstPathSpan(stmtText);
  if (!loc) return;
  refs.push({
    offset: span.offset + loc.start,
    length: loc.end - loc.start,
    path,
    hasVariables: path.includes("$"),
  });
}

/** For commands with two path args (copy_file, move_file, diff_files). */
function pushTwoRefs(
  refs: FilePathRef[],
  span: Span,
  stmtText: string,
  paths: [string, string]
): void {
  // First path: same as single-arg case
  const first = findFirstPathSpan(stmtText);
  if (!first) return;
  refs.push({
    offset: span.offset + first.start,
    length: first.end - first.start,
    path: paths[0],
    hasVariables: paths[0].includes("$"),
  });

  // Second path: scan forward from end of first path
  const afterFirst = stmtText.substring(first.end);
  const wsMatch = afterFirst.match(/^[ \t]+/);
  if (!wsMatch) return;
  const secondStart = first.end + wsMatch[0].length;
  const rest = stmtText.substring(secondStart);
  const endRel = rest.search(PATH_TAIL_RE);
  if (endRel < 0) return;
  refs.push({
    offset: span.offset + secondStart,
    length: endRel,
    path: paths[1],
    hasVariables: paths[1].includes("$"),
  });
}
