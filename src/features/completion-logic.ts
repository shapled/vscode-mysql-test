import * as fs from "fs";
import * as path from "path";
import { findMysqlTestRoot, resolveRealPath } from "../utils/path-utils";

/**
 * Regex for --source / --include directive (with or without -- prefix).
 * Captures group 1: the path argument (may be partial during typing).
 */
const SOURCE_INCLUDE_RE =
  /^\s*(?:--\s*)?(?:source|include)\s+([^\s;]*)/;

/** File extensions to include in completion candidates. */
const RELEVANT_EXTENSIONS = new Set([
  ".inc",
  ".test",
  ".sql",
]);

/**
 * Determine the base directory for resolving a partial path.
 * - Relative paths (./, ../) → current file's directory
 * - Absolute paths → use as-is
 * - Otherwise → mysql-test root
 */
function resolveBaseDir(
  currentFilePath: string,
  partialPath: string
): string | undefined {
  const normalized = partialPath.replace(/\\/g, "/");

  if (
    normalized.startsWith("./") ||
    normalized.startsWith("../")
  ) {
    return resolveRealPath(path.dirname(currentFilePath));
  }

  if (path.isAbsolute(normalized)) {
    return normalized;
  }

  const root = findMysqlTestRoot(currentFilePath);
  return root;
}

/**
 * Extract the directory portion and name prefix from a partial path.
 * e.g. "include/have_d" → { dir: "<base>/include", prefix: "have_d" }
 *      "./"              → { dir: "<currentDir>", prefix: "" }
 *      ""                → { dir: "<base>", prefix: "" }
 */
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
  if (
    normalized.startsWith("./") ||
    normalized.startsWith("../")
  ) {
    resolvedDir = path.resolve(baseDir, dirPart);
  } else if (path.isAbsolute(normalized)) {
    resolvedDir = dirPart;
  } else {
    resolvedDir = path.join(baseDir, dirPart);
  }

  return { dir: resolvedDir, prefix };
}

export interface CompletionEntry {
  label: string;
  insertText: string;
  detail: string;
  isDirectory: boolean;
}

/**
 * Core completion logic (no vscode dependency).
 * Returns matching file/directory entries for a partial path
 * in a --source / --include command.
 */
export function getCompletions(
  currentFilePath: string,
  lineText: string,
  cursorColumn: number
): CompletionEntry[] {
  const textBeforeCursor = lineText.substring(0, cursorColumn);

  const match = textBeforeCursor.match(SOURCE_INCLUDE_RE);
  if (!match) {
    return [];
  }

  const partialPath = match[1];

  const baseDir = resolveBaseDir(currentFilePath, partialPath);
  if (!baseDir) {
    return [];
  }

  const { dir, prefix } = splitPartialPath(baseDir, partialPath);

  if (!fs.existsSync(dir)) {
    return [];
  }

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
    if (
      lowerPrefix &&
      !name.toLowerCase().startsWith(lowerPrefix)
    ) {
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
      if (!RELEVANT_EXTENSIONS.has(ext)) {
        continue;
      }
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
