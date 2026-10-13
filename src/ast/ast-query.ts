import * as vscode from "vscode";
import {
  DashCommand,
  Source,
  Let,
  If,
  While,
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
} from "@shapled/mtparser/ast";
import type {
  Span$ as Span,
  Statement$ as Statement,
  InterpolatedText,
} from "@shapled/mtparser/ast";
import {
  statementSpan,
  interpolatedToRaw,
  interpolatedVariables,
} from "./helpers";

/**
 * AST query helpers. Pure functions over Statement[] — no vscode dependency
 * except where a Position/Range is needed for the public API.
 *
 * mtparser 0.4 wraps `--` prefixed commands in a DashCommand node; queries
 * unwrap it so callers always see the inner command (Source, Let, ...).
 */

/** Unwrap `--` prefixed commands to the inner command statement. */
export function unwrapStatement(stmt: Statement): Statement {
  return stmt instanceof DashCommand ? stmt.statement : stmt;
}

/**
 * Walk every statement in document order, unwrapping `--` commands and
 * recursing into If/While bodies. Block statements themselves are yielded
 * before their children.
 */
export function* walkStatements(
  statements: Statement[]
): Generator<Statement> {
  for (const top of statements) {
    const stmt = unwrapStatement(top);
    yield stmt;
    if (stmt instanceof If || stmt instanceof While) {
      yield* walkStatements([...stmt.body]);
    }
  }
}

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

/**
 * Find the innermost statement containing the given byte offset, if any.
 * Statements nested in If/While bodies take precedence over their enclosing
 * block (whose span covers the whole block).
 */
export function findStatementAtOffset(
  statements: Statement[],
  offset: number
): Statement | undefined {
  for (const top of statements) {
    const stmt = unwrapStatement(top);
    if (!spanContains(statementSpan(top), offset)) continue;
    if (stmt instanceof If || stmt instanceof While) {
      return findStatementAtOffset([...stmt.body], offset) ?? stmt;
    }
    return stmt;
  }
  return undefined;
}

// ── Source / include commands ────────────────────────────

/** Return all Source statements in the AST (incl. If/While bodies), in order. */
export function findSourceCommands(
  statements: Statement[]
): Source[] {
  const sources: Source[] = [];
  for (const stmt of walkStatements(statements)) {
    if (stmt instanceof Source) sources.push(stmt);
  }
  return sources;
}

/** Get the raw file path from a Source command (resolving $variables). */
export function sourcePath(cmd: Source): string {
  return interpolatedToRaw(cmd.file);
}

/** Check if a Source command's path contains a $variable reference. */
export function sourceHasVariables(cmd: Source): boolean {
  return interpolatedVariables(cmd.file).length > 0;
}

// ── Variables ────────────────────────────────────────────

/** Find a --let declaration for a variable name (without $ prefix). */
export function findVariableDeclaration(
  statements: Statement[],
  variableName: string
): Let | undefined {
  return findAllDeclarations(statements).find(
    (cmd) => cmd.variable === variableName
  );
}

/** All variable declarations in the AST (incl. If/While bodies), in source order. */
export function findAllDeclarations(statements: Statement[]): Let[] {
  const decls: Let[] = [];
  for (const stmt of walkStatements(statements)) {
    if (stmt instanceof Let) decls.push(stmt);
  }
  return decls;
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
 * --let declarations use the exact `variable_span` from the AST; other
 * references ($var in echo/source/let values, if/while conditions, ...) are
 * located by scanning the statement's source text for the literal `$name`
 * pattern. If/While blocks scan only their header (condition) — the body is
 * visited recursively, so nested occurrences aren't counted twice.
 */
export function findVariableOccurrences(
  statements: Statement[],
  variableName: string,
  sourceText: string
): VariableOccurrence[] {
  const results: VariableOccurrence[] = [];
  collectOccurrences(statements, variableName, sourceText, results);
  return results;
}

function collectOccurrences(
  statements: Statement[],
  variableName: string,
  sourceText: string,
  results: VariableOccurrence[]
): void {
  const needle = `$${variableName}`;

  for (const top of statements) {
    const stmt = unwrapStatement(top);
    const span = statementSpan(top); // covers the full command incl. `--`

    // --let declaration: exact span of the LHS `$name` token
    if (stmt instanceof Let && stmt.variable === variableName) {
      if (stmt.variable_span.len > 0) {
        results.push({
          offset: stmt.variable_span.offset,
          length: stmt.variable_span.len,
          name: variableName,
          isDeclaration: true,
        });
        // The general scan below would find the same token again — skip it.
        continue;
      }
    }

    // If/While: scan only the header (`while (cond) {`); recurse into body.
    if (stmt instanceof If || stmt instanceof While) {
      const headerEnd = stmt.open_brace.offset + Math.max(stmt.open_brace.len, 0);
      scanRange(
        sourceText,
        span.offset,
        Math.max(headerEnd, span.offset),
        needle,
        variableName,
        results
      );
      collectOccurrences([...stmt.body], variableName, sourceText, results);
      continue;
    }

    // For all other statements: scan interpolated text + body for the
    // variable (echo $x, source $VAR/path, let $y = $x, ...).
    scanRange(
      sourceText,
      span.offset,
      span.offset + span.len,
      needle,
      variableName,
      results
    );
  }
}

function scanRange(
  sourceText: string,
  start: number,
  end: number,
  needle: string,
  variableName: string,
  results: VariableOccurrence[]
): void {
  const region = sourceText.substring(start, end);
  let searchFrom = 0;
  while (true) {
    const rel = region.indexOf(needle, searchFrom);
    if (rel < 0) break;
    results.push({
      offset: start + rel,
      length: needle.length,
      name: variableName,
      isDeclaration: false,
    });
    searchFrom = rel + needle.length;
  }
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
 * Path token spans come straight from the AST's TextPart spans (exact),
 * so no source-text re-scanning is needed.
 */
export function findFilePaths(statements: Statement[]): FilePathRef[] {
  const refs: FilePathRef[] = [];

  for (const top of statements) {
    const stmt = unwrapStatement(top);

    if (stmt instanceof Source) {
      pushRef(refs, stmt.file);
    } else if (stmt instanceof WriteFile) {
      pushRef(refs, stmt.filename);
    } else if (stmt instanceof AppendFile) {
      pushRef(refs, stmt.filename);
    } else if (stmt instanceof RemoveFile) {
      pushRef(refs, stmt.file);
    } else if (stmt instanceof CatFile) {
      pushRef(refs, stmt.file);
    } else if (stmt instanceof Mkdir) {
      pushRef(refs, stmt.dir);
    } else if (stmt instanceof Rmdir) {
      pushRef(refs, stmt.dir);
    } else if (stmt instanceof FileExists) {
      pushRef(refs, stmt.file);
    } else if (stmt instanceof CopyFile) {
      pushRef(refs, stmt.source);
      pushRef(refs, stmt.dest);
    } else if (stmt instanceof MoveFile) {
      pushRef(refs, stmt.source);
      pushRef(refs, stmt.dest);
    } else if (stmt instanceof DiffFiles) {
      pushRef(refs, stmt.file1);
      pushRef(refs, stmt.file2);
    } else if (stmt instanceof Chmod) {
      pushRef(refs, stmt.file);
    }
  }

  return refs;
}

/** Span covering an interpolated-text argument (first part start → last part end). */
function partsSpan(
  parts: InterpolatedText
): { offset: number; length: number } | undefined {
  let first: Span | undefined;
  let last: Span | undefined;
  for (const part of parts) {
    const sp = part.span;
    if (!first) first = sp;
    last = sp;
  }
  if (!first || !last) return undefined;
  return { offset: first.offset, length: last.offset + last.len - first.offset };
}

function pushRef(refs: FilePathRef[], parts: InterpolatedText): void {
  const loc = partsSpan(parts);
  if (!loc || loc.length <= 0) return;
  const path = interpolatedToRaw(parts);
  refs.push({
    offset: loc.offset,
    length: loc.length,
    path,
    hasVariables: interpolatedVariables(parts).length > 0,
  });
}
