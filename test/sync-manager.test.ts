import { describe, it, expect, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { syncTestFile, syncTestByInstallPath } from "../src/testing/sync-manager";

const tmpDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function write(p: string, content = "x"): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf-8");
}

afterAll(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("syncTestFile", () => {
  it("syncs under <installDir>/mysql-test/, preserving the suite path", async () => {
    const srcRoot = makeTempDir("mtr-src-");
    const installDir = makeTempDir("mtr-install-");
    const testPath = path.join(
      srcRoot, "mysql-test", "suite", "raft_replication", "t", "recovery_check_gtid.test"
    );
    write(testPath);

    await syncTestFile(testPath, installDir);

    const target = path.join(
      installDir, "mysql-test", "suite", "raft_replication", "t", "recovery_check_gtid.test"
    );
    expect(fs.existsSync(target), `synced file must land at ${target}`).toBe(true);
    // The wrong (segment-dropping) location must NOT be used.
    const wrongTarget = path.join(
      installDir, "suite", "raft_replication", "t", "recovery_check_gtid.test"
    );
    expect(fs.existsSync(wrongTarget), "must not sync to <installDir>/suite/...").toBe(false);
  });

  it("syncs associated .result/.opt and -master variants alongside", async () => {
    const srcRoot = makeTempDir("mtr-src-");
    const installDir = makeTempDir("mtr-install-");
    const dir = path.join(srcRoot, "mysql-test", "t");
    write(path.join(dir, "alias.test"));
    write(path.join(dir, "alias.result"));
    write(path.join(dir, "alias-master.opt"));

    await syncTestFile(path.join(dir, "alias.test"), installDir);

    const targetDir = path.join(installDir, "mysql-test", "t");
    expect(fs.existsSync(path.join(targetDir, "alias.test"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "alias.result"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "alias-master.opt"))).toBe(true);
  });

  it("throws when the source is not under a mysql-test tree", async () => {
    const srcRoot = makeTempDir("mtr-src-");
    const stray = path.join(srcRoot, "orphan.test");
    write(stray);
    await expect(syncTestFile(stray, makeTempDir("mtr-install-"))).rejects.toThrow(/mysql-test root/);
  });
});

describe("syncTestByInstallPath", () => {
  it("maps an install-tree path back to source and syncs (incl. mysql-test segment)", async () => {
    const srcRoot = makeTempDir("mtr-src-");
    const installDir = makeTempDir("mtr-install-");
    const source = path.join(srcRoot, "mysql-test", "suite", "innodb", "t", "alias.test");
    write(source);

    const installPath = path.join(installDir, "mysql-test", "suite", "innodb", "t", "alias.test");
    const found = await syncTestByInstallPath(installPath, installDir, [srcRoot]);

    expect(found).toBe(source);
    expect(fs.existsSync(installPath)).toBe(true);
  });
});
