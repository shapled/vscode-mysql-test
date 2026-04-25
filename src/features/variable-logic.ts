import * as fs from "fs";
import { resolveIncPathString } from "../utils/path-utils";

/** Maximum include nesting depth (matches MySQL MTR limit). */
export const MAX_INCLUDE_DEPTH = 16;

/** Regex matching a $variable token in a line. */
const VARIABLE_REGEX = /\$[A-Za-z_][A-Za-z0-9_]*/g;

/** Non-global version for single match extraction. */
const VARIABLE_REGEX_SINGLE = /\$[A-Za-z_][A-Za-z0-9_]*/;

/** Regex for --source / --include directive (with -- prefix). */
const SOURCE_INCLUDE_REGEX = /^\s*--\s*(?:source|include)\s+(\S+)/;

/** Regex for source/include without -- prefix (semicolon-terminated). */
const SOURCE_INCLUDE_NO_PREFIX_REGEX = /^\s*(?:source|include)\s+(\S+)/;

/** Regex for --let declaration (with -- prefix). */
const LET_DECLARATION_REGEX = /^\s*--\s*let\s+(\$[A-Za-z_][A-Za-z0-9_]*)/;

/** Regex for let declaration without -- prefix. */
const LET_NO_PREFIX_REGEX = /^\s*let\s+(\$[A-Za-z_][A-Za-z0-9_]*)/;

export interface VariableLocation {
  lineIndex: number;
  startCol: number;
  endCol: number;
}

export interface FileVariableLocation extends VariableLocation {
  filePath: string;
}

/**
 * Extract the $variable name at a given character position in a line.
 * Works correctly even when the variable is adjacent to other characters
 * (e.g. `d$i` returns `$i`, not `d$i`).
 * Returns undefined if no variable is found at the position.
 */
export function getVariableAtPosition(
  line: string,
  character: number
): string | undefined {
  VARIABLE_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = VARIABLE_REGEX.exec(line)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (character >= start && character < end) {
      return m[0];
    }
  }
  return undefined;
}

/**
 * Check whether a line is a comment line.
 */
export function isCommentLine(line: string): boolean {
  return /^\s*#/.test(line);
}

/**
 * Find the declaration of a $variable in lines.
 * Matches both `--let $var` and `let $var;` forms.
 */
export function findVariableDeclarationInLines(
  lines: string[],
  varName: string
): VariableLocation | undefined {
  for (let i = 0; i < lines.length; i++) {
    if (isCommentLine(lines[i])) continue;

    let m = lines[i].match(LET_DECLARATION_REGEX);
    if (!m) {
      m = lines[i].match(LET_NO_PREFIX_REGEX);
    }
    if (m && m[1] === varName) {
      const col = lines[i].indexOf(varName);
      return {
        lineIndex: i,
        startCol: col,
        endCol: col + varName.length,
      };
    }
  }
  return undefined;
}

/**
 * Find all occurrences of a $variable in lines.
 * Exact match only: $var does not match $variable.
 * Skips comment lines.
 */
/** Regex for die command (variables in die strings are not expanded). */
const DIE_LINE_REGEX = /^\s*(?:--\s*)?die\b/;

export function findVariableOccurrencesInLines(
  lines: string[],
  varName: string
): VariableLocation[] {
  const results: VariableLocation[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isCommentLine(lines[i])) continue;
    if (DIE_LINE_REGEX.test(lines[i])) continue;

    VARIABLE_REGEX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = VARIABLE_REGEX.exec(lines[i])) !== null) {
      if (m[0] === varName) {
        results.push({
          lineIndex: i,
          startCol: m.index,
          endCol: m.index + m[0].length,
        });
      }
    }
  }
  return results;
}

/**
 * Extract all --source / --include paths from lines.
 * Matches both --source and bare source forms.
 */
export function extractIncludePaths(lines: string[]): string[] {
  const paths: string[] = [];
  for (const line of lines) {
    if (isCommentLine(line)) continue;

    let m = line.match(SOURCE_INCLUDE_REGEX);
    if (!m) {
      m = line.match(SOURCE_INCLUDE_NO_PREFIX_REGEX);
    }
    if (m) {
      // Strip trailing semicolons from the path
      paths.push(m[1].replace(/;$/, ""));
    }
  }
  return paths;
}

/**
 * Recursively find all references to a $variable across files,
 * following --source / --include directives.
 */
export function findVariableReferencesRecursive(
  currentFilePath: string,
  varName: string,
  readFile: (path: string) => string = (p: string) =>
    fs.readFileSync(p, "utf-8"),
  depth: number = 0,
  visited?: Set<string>
): FileVariableLocation[] {
  if (depth > MAX_INCLUDE_DEPTH) return [];

  if (!visited) {
    visited = new Set();
  }
  if (visited.has(currentFilePath)) return [];
  visited.add(currentFilePath);

  let content: string;
  try {
    content = readFile(currentFilePath);
  } catch {
    return [];
  }

  const lines = content.split("\n");
  const results: FileVariableLocation[] = [];

  // Find references in current file
  const occurrences = findVariableOccurrencesInLines(lines, varName);
  for (const occ of occurrences) {
    results.push({ filePath: currentFilePath, ...occ });
  }

  // Find includes and recurse
  const includes = extractIncludePaths(lines);
  for (const incPath of includes) {
    const resolved = resolveIncPathString(currentFilePath, incPath);
    if (!resolved) continue;

    try {
      readFile(resolved); // check file exists
    } catch {
      continue;
    }

    const childRefs = findVariableReferencesRecursive(
      resolved,
      varName,
      readFile,
      depth + 1,
      visited
    );
    results.push(...childRefs);
  }

  return results;
}
