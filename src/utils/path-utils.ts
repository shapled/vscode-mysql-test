import * as path from "path";
import * as fs from "fs";

/**
 * Normalize path separators to forward slashes for consistent matching.
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Resolve symlinks and normalize path separators.
 */
export function resolveRealPath(p: string): string {
  try {
    return normalizePath(fs.realpathSync(p));
  } catch {
    return normalizePath(p);
  }
}

/**
 * Find the mysql-test root directory from a file path.
 * Returns the original path prefix up to and including "mysql-test".
 */
export function findMysqlTestRoot(
  filePath: string
): string | undefined {
  const resolved = resolveRealPath(filePath);
  const parts = resolved.split("/");

  const idx = parts.lastIndexOf("mysql-test");
  if (idx < 0) {
    return undefined;
  }

  // Reconstruct the real path up to and including "mysql-test"
  return parts.slice(0, idx + 1).join(path.sep);
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
 * Resolve a --source or --include path.
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
    // Relative to current file's real directory
    resolved = path.resolve(resolveRealPath(path.dirname(currentFile)), incPath);
  } else {
    // Relative to mysql-test root
    resolved = path.join(root, incPath);
  }

  return resolved;
}

/**
 * Derive the MTR fully qualified test name from a .test file path.
 * e.g. /repo/mysql-test/suite/innodb/t/alias.test → "innodb.alias"
 *       /repo/mysql-test/suite/starsql/rpl/t/x.test → "starsql/rpl.x"
 *       /repo/mysql-test/t/alias.test               → "main.alias"
 * Returns undefined if the path doesn't match the expected structure.
 */
export function deriveTestName(fsPath: string): string | undefined {
  const root = findMysqlTestRoot(fsPath);
  if (!root) return undefined;

  const normalized = fsPath.replace(/\\/g, "/");
  const normalizedRoot = root.replace(/\\/g, "/");
  const relative = normalized.substring(normalizedRoot.length);

  // Nested suite: /suite/parent/child/t/name.test → "parent/child.name"
  const nestedMatch = relative.match(/^\/suite\/(.+)\/t\/([^/]+)\.test$/);
  if (nestedMatch) return `${nestedMatch[1]}.${nestedMatch[2]}`;

  // Main suite: /t/name.test → "main.name"
  const mainMatch = relative.match(/^\/t\/([^/]+)\.test$/);
  if (mainMatch) return `main.${mainMatch[1]}`;

  return undefined;
}

/**
 * Scan filesystem for suite directories under installDir/mysql-test/.
 * - "main" suite: <installDir>/mysql-test/t/
 * - Top-level suites: <installDir>/mysql-test/suite/<name>/t/
 * - Nested suites: <installDir>/mysql-test/suite/<parent>/<name>/t/
 */
export function scanSuites(installDir: string): string[] {
  const suites: string[] = [];

  if (fs.existsSync(path.join(installDir, "mysql-test", "t"))) {
    suites.push("main");
  }

  const suiteDir = path.join(installDir, "mysql-test", "suite");
  if (!fs.existsSync(suiteDir)) return suites;

  for (const entry of fs.readdirSync(suiteDir, { withFileTypes: true })) {
    if (entry.isDirectory() && fs.existsSync(path.join(suiteDir, entry.name, "t"))) {
      suites.push(entry.name);

      // Nested: suite/<parent>/<child>/t/
      for (const sub of fs.readdirSync(path.join(suiteDir, entry.name), { withFileTypes: true })) {
        if (sub.isDirectory() && fs.existsSync(path.join(suiteDir, entry.name, sub.name, "t"))) {
          suites.push(`${entry.name}/${sub.name}`);
        }
      }
    }
  }

  return suites.sort();
}
