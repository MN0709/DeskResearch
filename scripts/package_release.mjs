import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const rootDir = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));
const appPath = path.join(rootDir, "release/mac-arm64/DeskResearch.app");
const zipPath = path.join(rootDir, `release/DeskResearch-${packageJson.version}-mac-arm64.zip`);

await fs.rm(zipPath, { force: true });
await new Promise((resolve, reject) => {
  const child = spawn("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, zipPath], {
    stdio: "inherit"
  });
  child.on("error", reject);
  child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`ditto 退出码 ${code}`)));
});

console.log(zipPath);
