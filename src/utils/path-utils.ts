import * as path from "path";

/**
 * Find the mysql-test root directory from a file path.
 */
export function findMysqlTestRoot(
  filePath: string
): string | undefined {
  const dir = path.dirname(filePath);
  const parts = dir.split(path.sep);

  const idx = parts.lastIndexOf("mysql-test");
  if (idx < 0) {
    return undefined;
  }

  return parts.slice(0, idx + 1).join(path.sep);
}

/**
 * Pair a .test file with its .result file (or vice versa).
 * Returns the paired file path string, or undefined.
 */
export function pairTestResultPath(
  filePath: string
): string | undefined {
  const tMatch = filePath.match(/\/t\/([^/]+)\.test$/);
  const rMatch = filePath.match(/\/r\/([^/]+)\.result$/);

  if (tMatch) {
    return filePath
      .replace(/\/t\//, "/r/")
      .replace(/\.test$/, ".result");
  }
  if (rMatch) {
    return filePath
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
  const match = filePath.match(
    new RegExp(
      `/t/([^/]+?)(-master|-slave)\\.${ext}$`
    )
  );
  if (!match) {
    // No -master/-slave suffix, just replace extension
    const simple = filePath.match(
      new RegExp(`/t/([^/]+)\\.${ext}$`)
    );
    if (!simple) {
      return undefined;
    }
    return filePath.replace(
      new RegExp(`/t/[^/]+\\.${ext}$`),
      `/t/${simple[1]}.test`
    );
  }

  const baseName = match[1];
  return filePath.replace(
    new RegExp(`/t/[^/]+(-master|-slave)\\.${ext}$`),
    `/t/${baseName}.test`
  );
}

/**
 * Resolve a --source or --include path to a .inc file path.
 * Paths starting with `../` are relative to the current file's directory.
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
  if (incPath.startsWith("../") || incPath.startsWith("./")) {
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
