import * as fs from "fs";
import * as path from "path";
import { findMysqlTestRoot, resolveRealPath } from "../utils/path-utils";

/**
 * Core completion logic for --source / --include path arguments.
 *
 * A single-line regex is sufficient here: completion only cares whether the
 * cursor sits in a path argument, and the filesystem scan is the expensive
 * part. No AST needed.
 */

/** File extensions to include in completion candidates. */
const RELEVANT_EXTENSIONS = new Set([".inc", ".test", ".sql"]);

export interface CompletionEntry {
  label: string;
  insertText: string;
  detail: string;
  isDirectory: boolean;
}

/** Provide path completions for a Source/Include command. */
export function getCompletions(
  currentFilePath: string,
  lineText: string,
  cursorColumn: number
): CompletionEntry[] {
  const partialPath = extractPartialPath(lineText, cursorColumn);
  if (partialPath === undefined) return [];

  const baseDir = resolveBaseDir(currentFilePath, partialPath);
  if (!baseDir) return [];

  const { dir, prefix } = splitPartialPath(baseDir, partialPath);

  if (!fs.existsSync(dir)) return [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const lowerPrefix = prefix.toLowerCase();
  const results: CompletionEntry[] = [];

  for (const entry of entries) {
    const name = entry.name;
    if (lowerPrefix && !name.toLowerCase().startsWith(lowerPrefix)) {
      continue;
    }
    if (entry.isDirectory()) {
      results.push({
        label: name + "/",
        insertText: name + "/",
        detail: "directory",
        isDirectory: true,
      });
    } else if (entry.isFile()) {
      const ext = path.extname(name);
      if (!RELEVANT_EXTENSIONS.has(ext)) continue;
      results.push({
        label: name,
        insertText: name,
        detail: ext,
        isDirectory: false,
      });
    }
  }

  return results;
}

/** Extract the partial path if cursor is in a source/include argument. */
function extractPartialPath(
  lineText: string,
  cursorColumn: number
): string | undefined {
  const re = /^\s*(?:--\s*)?(?:source|include)\s+([^\s;]*)/;
  const m = lineText.substring(0, cursorColumn).match(re);
  if (!m) return undefined;
  return m[1];
}

/** Determine the base directory for resolving a partial path. */
function resolveBaseDir(
  currentFilePath: string,
  partialPath: string
): string | undefined {
  const normalized = partialPath.replace(/\\/g, "/");

  if (normalized.startsWith("./") || normalized.startsWith("../")) {
    return resolveRealPath(path.dirname(currentFilePath));
  }
  if (path.isAbsolute(normalized)) {
    return normalized;
  }
  return findMysqlTestRoot(currentFilePath);
}

/** Split a partial path into its containing directory and name prefix. */
function splitPartialPath(
  baseDir: string,
  partialPath: string
): { dir: string; prefix: string } {
  const normalized = partialPath.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");

  if (lastSlash < 0) {
    return { dir: baseDir, prefix: normalized };
  }

  const dirPart = normalized.substring(0, lastSlash);
  const prefix = normalized.substring(lastSlash + 1);

  let resolvedDir: string;
  if (normalized.startsWith("./") || normalized.startsWith("../")) {
    resolvedDir = path.resolve(baseDir, dirPart);
  } else if (path.isAbsolute(normalized)) {
    resolvedDir = dirPart;
  } else {
    resolvedDir = path.join(baseDir, dirPart);
  }

  return { dir: resolvedDir, prefix };
}
