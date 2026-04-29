import * as fs from "fs";
import * as path from "path";
import { findMysqlTestRoot } from "../utils/path-utils";

/**
 * File extensions that should be synced alongside .test files.
 */
const SYNC_EXTENSIONS = [".test", ".result", ".opt", ".cnf", ".inc"];

/**
 * Sync a source .test file (and its associated files) to the install directory.
 *
 * The relative path under `mysql-test/` is preserved:
 *   source: /repo/mysql-test/suite/innodb/t/alias.test
 *   target: <installDir>/mysql-test/suite/innodb/t/alias.test
 */
export async function syncTestFile(sourcePath: string, installDir: string): Promise<void> {
  const root = findMysqlTestRoot(sourcePath);
  if (!root) {
    throw new Error(`Cannot find mysql-test root for: ${sourcePath}`);
  }

  const normalizedSource = sourcePath.replace(/\\/g, "/");
  const normalizedRoot = root.replace(/\\/g, "/");
  const relativePath = normalizedSource.substring(normalizedRoot.length);

  // Sync the main file
  await copyFile(sourcePath, path.join(installDir, relativePath));

  // Sync associated files (same base name, different extension)
  const dir = path.dirname(sourcePath);
  const baseName = path.basename(sourcePath, path.extname(sourcePath));

  for (const ext of SYNC_EXTENSIONS) {
    if (ext === path.extname(sourcePath)) continue; // Already synced
    const associatedPath = path.join(dir, baseName + ext);
    if (fs.existsSync(associatedPath)) {
      const associatedRelative = path.join(path.dirname(relativePath), baseName + ext);
      await copyFile(associatedPath, path.join(installDir, associatedRelative));
    }
  }

  // Also sync -master and -slave variants
  for (const suffix of ["-master", "-slave"]) {
    for (const ext of [".opt", ".cnf"]) {
      const variantPath = path.join(dir, baseName + suffix + ext);
      if (fs.existsSync(variantPath)) {
        const variantRelative = path.join(
          path.dirname(relativePath),
          baseName + suffix + ext
        );
        await copyFile(variantPath, path.join(installDir, variantRelative));
      }
    }
  }
}

/**
 * Sync a test by its install path — find the corresponding source file and sync.
 */
export async function syncTestByInstallPath(
  installPath: string,
  installDir: string,
  sourceRoots: string[]
): Promise<string | undefined> {
  const normalizedInstall = installPath.replace(/\\/g, "/");
  const mysqlTestIdx = normalizedInstall.indexOf("/mysql-test/");
  if (mysqlTestIdx < 0) return undefined;

  const relativePath = normalizedInstall.substring(mysqlTestIdx + "/mysql-test/".length);

  for (const root of sourceRoots) {
    const normalizedRoot = root.replace(/\\/g, "/");
    const sourcePath = path.join(normalizedRoot, "mysql-test", relativePath);
    if (fs.existsSync(sourcePath)) {
      await syncTestFile(sourcePath, installDir);
      return sourcePath;
    }
  }

  return undefined;
}

function copyFile(src: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.mkdir(path.dirname(dest), { recursive: true }, (mkdirErr) => {
      if (mkdirErr) {
        reject(mkdirErr);
        return;
      }
      const readStream = fs.createReadStream(src);
      const writeStream = fs.createWriteStream(dest);
      readStream.pipe(writeStream);
      writeStream.on("finish", () => {
        writeStream.close();
        resolve();
      });
      writeStream.on("error", reject);
      readStream.on("error", reject);
    });
  });
}
