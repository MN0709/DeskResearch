import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "..");
const appPath = path.join(rootDir, "release/mac-arm64/DeskResearch.app");

function run(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  return {
    code: result.status,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim()
  };
}

const sections = [];
let ok = true;

if (!fs.existsSync(appPath)) {
  console.error(`未找到应用：${appPath}`);
  console.error("请先运行 npm run package:mac 或 npm run package:mac:signed 构建应用。");
  process.exit(1);
}

// 1. 签名身份
const sig = run("codesign", ["-dv", "--verbose=4", appPath]);
const sigText = `${sig.stdout}\n${sig.stderr}`;
const authorityLine = sigText.split("\n").find((l) => l.includes("Authority="));
const isAdHoc = /adhoc/i.test(sigText);
const isDeveloperId = /Developer ID Application/i.test(sigText);
let identity;
if (authorityLine) {
  identity = authorityLine.replace(/^.*Authority=/, "");
} else if (isAdHoc) {
  identity = "ad-hoc 临时签名";
} else {
  identity = "未签名或未识别";
}
sections.push({
  title: "代码签名",
  detail: identity,
  pass: sig.code === 0 && isDeveloperId && !isAdHoc,
  hint: isDeveloperId ? "" : (isAdHoc ? "当前为 ad-hoc 临时签名，未使用 Developer ID。" : "未检测到有效签名。")
});

// 2. 公证票据（stapler）
const stapler = run("xcrun", ["stapler", "validate", appPath]);
const staplerOk = stapler.code === 0 && /worked/i.test(`${stapler.stdout}\n${stapler.stderr}`);
sections.push({
  title: "公证票据（stapler）",
  detail: `${stapler.stdout}${stapler.stderr ? `\n${stapler.stderr}` : ""}`.trim() || "（无输出）",
  pass: staplerOk,
  hint: staplerOk ? "" : "未检测到已装订的公证票据，可能尚未完成公证。"
});

// 3. Gatekeeper 评估
const spctl = run("spctl", ["--assess", "--type", "execute", "--verbose=4", appPath]);
const spctlText = `${spctl.stdout}\n${spctl.stderr}`;
const spctlOk = spctl.code === 0 && /accepted/.test(spctlText);
const notarized = /source=Notarized Developer ID/i.test(spctlText);
sections.push({
  title: "Gatekeeper 评估",
  detail: spctlText.trim() || "（无输出）",
  pass: spctlOk,
  hint: notarized ? "" : (spctlOk ? "已通过 Gatekeeper，但来源并非「Notarized Developer ID」。" : "")
});

console.log(`\n签名与公证校验：${appPath}\n`);
console.log("=".repeat(60));
for (const s of sections) {
  const mark = s.pass ? "✓" : "✗";
  if (!s.pass) ok = false;
  console.log(`\n[${mark}] ${s.title}`);
  console.log(`    ${s.detail.replace(/\n/g, "\n    ")}`);
  if (s.hint) console.log(`    ⚠ ${s.hint}`);
}
console.log("\n" + "=".repeat(60));

if (ok) {
  console.log("✓ 应用已通过 Developer ID 签名、公证并装订票据，可用于公开分发。\n");
} else {
  console.log("✗ 应用尚未满足公开分发的签名/公证要求。\n");
  console.log("如需正式签名与公证，请：");
  console.log("  1. 在钥匙串中安装「Developer ID Application」证书（Apple Developer 账号）。");
  console.log("  2. 设置环境变量 APPLE_ID、APPLE_APP_SPECIFIC_PASSWORD、APPLE_TEAM_ID。");
  console.log("  3. 运行 npm run release:zip:signed 重新构建。\n");
  process.exitCode = 1;
}
