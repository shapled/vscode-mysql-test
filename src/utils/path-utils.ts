import * as path from "path";

/**
 * Normalize path separators to forward slashes for consistent matching.
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Find the mysql-test root directory from a file path.
 * Returns the original path prefix up to and including "mysql-test".
 */
export function findMysqlTestRoot(
  filePath: string
): string | undefined {
  const normalized = normalizePath(filePath);
  const parts = normalized.split("/");
  const originalParts = filePath.split(/[/\\]/);

  const idx = parts.lastIndexOf("mysql-test");
  if (idx < 0) {
    return undefined;
  }

  return originalParts.slice(0, idx + 1).join(path.sep);
}

/**
 * Pair a .test file with its .result file (or vice versa).
 * Returns the paired file path string, or undefined.
 */
export function pairTestResultPath(
  filePath: string
): string | undefined {
  const normalized = normalizePath(filePath);
  const tMatch = normalized.match(/\/t\/([^/]+)\.test$/);
  const rMatch = normalized.match(/\/r\/([^/]+)\.result$/);

  if (tMatch) {
    return normalized
      .replace(/\/t\//, "/r/")
      .replace(/\.test$/, ".result");
  }
  if (rMatch) {
    return normalized
      .replace(/\/r\//, "/t/")
      .replace(/\.result$/, ".test");
  }
  return undefined;
}

/**
 * Pair a .opt/.cnf file with its .test file.
 * Handles -master and -slave suffixes.
 */
export function pairSuffixFileToTest(
  filePath: string,
  ext: string
): string | undefined {
  const normalized = normalizePath(filePath);
  const match = normalized.match(
    new RegExp(`/t/([^/]+?)(-master|-slave)\\.${ext}$`)
  );
  if (!match) {
    const simple = normalized.match(
      new RegExp(`/t/([^/]+)\\.${ext}$`)
    );
    if (!simple) {
      return undefined;
    }
    return normalized.replace(
      new RegExp(`/t/[^/]+\\.${ext}$`),
      `/t/${simple[1]}.test`
    );
  }

  const baseName = match[1];
  return normalized.replace(
    new RegExp(`/t/[^/]+(-master|-slave)\\.${ext}$`),
    `/t/${baseName}.test`
  );
}

/**
 * Resolve a --source or --include path to a .inc file path.
 * Paths starting with `../` or `./` are relative to the current file's directory.
 * Other paths are relative to the mysql-test root directory.
 */
export function resolveIncPathString(
  currentFile: string,
  incPath: string
): string | undefined {
  const root = findMysqlTestRoot(currentFile);
  if (!root) {
    return undefined;
  }

  let resolved: string;
  const normalized = incPath.replace(/\\/g, "/");
  if (normalized.startsWith("../") || normalized.startsWith("./")) {
    // Relative to current file's directory
    resolved = path.resolve(path.dirname(currentFile), incPath);
  } else {
    // Relative to mysql-test root
    resolved = path.join(root, incPath);
  }

  if (path.extname(resolved) !== ".inc") {
    return resolved + ".inc";
  }
  return resolved;
}
