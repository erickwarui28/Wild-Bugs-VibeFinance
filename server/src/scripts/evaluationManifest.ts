import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

export function evaluationManifest(root: string) {
  const hash = createHash("sha256");
  function scan(directory: string) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) scan(file);
      else if (/\.(ts|sql)$/.test(file)) hash.update(path.relative(root, file).replaceAll("\\", "/")).update(fs.readFileSync(file).toString().replaceAll("\r\n", "\n"));
    }
  }
  scan(path.join(root, "server/src")); scan(path.join(root, "shared/src"));
  return { generatedAt: new Date().toISOString(), baseRevision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    workingTreeDirty: Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()),
    sourceHash: hash.digest("hex"), nodeVersion: process.version, platform: process.platform, seed: 42, provider: "mock" };
}
