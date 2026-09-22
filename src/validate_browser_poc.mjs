import fs from "node:fs/promises";
import path from "node:path";
import { collectBrowserEvidence } from "./lib/browser-collector.mjs";
import { evidenceSignature } from "./lib/evidence.mjs";

const rootDir = path.resolve(import.meta.dirname, "..");
const sources = JSON.parse(await fs.readFile(path.join(rootDir, "config/sources.json"), "utf8"));
const outputDir = path.join(rootDir, "outputs/browser-poc");
const runsDir = path.join(outputDir, "runs");
await fs.mkdir(runsDir, { recursive: true });

const runs = [];
for (let index = 1; index <= 3; index += 1) {
  const runId = `run-${index}`;
  const evidencePath = path.join(runsDir, runId, "evidence.json");
  try {
    const existingEvidence = JSON.parse(await fs.readFile(evidencePath, "utf8"));
    const existingSources = existingEvidence.products.flatMap((product) => product.sources);
    const usable = existingSources.every((source) => source.status >= 200 && source.status < 400 && (source.textLength ?? 0) > 0);
    if (usable) {
      runs.push(existingEvidence);
      console.log(JSON.stringify({ runId, products: existingEvidence.products.length, resumed: true }));
      continue;
    }
    console.log(JSON.stringify({ runId, resumed: false, reason: "existing run contains failed sources" }));
  } catch {}
  const evidence = await collectBrowserEvidence({
    sources,
    runId,
    screenshotDir: path.join(runsDir, runId, "screenshots")
  });
  runs.push(evidence);
  await fs.mkdir(path.join(runsDir, runId), { recursive: true });
  await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ runId, products: evidence.products.length }));
}

const signatures = runs.map(evidenceSignature);
const signatureTexts = signatures.map((signature) => JSON.stringify(signature));
const consistent = signatureTexts.every((signature) => signature === signatureTexts[0]);
const sourceChecks = runs.flatMap((run) => run.products.flatMap((product) => product.sources.map((source) => ({
  runId: run.runId,
  product: product.product,
  label: source.label,
  status: source.status,
  textLength: source.textLength ?? 0,
  error: source.error ?? ""
}))));
const failedSources = sourceChecks.filter((source) => source.status < 200 || source.status >= 400 || source.textLength === 0);
const validation = {
  generatedAt: new Date().toISOString(),
  runs: runs.length,
  consistent,
  failedSourceCount: failedSources.length,
  failedSources,
  passed: consistent && failedSources.length === 0
};

const finalEvidence = {
  ...runs.at(-1),
  validation: {
    ...validation,
    limitations: [
      "仅验证公开网页，不包含登录、验证码和 Cookie 复用",
      "未验证 Pages、Numbers、Excel、Word 等原生应用控制",
      "关键词规则用于验证链路，不替代最终产品的语义抽取与冲突核验"
    ]
  }
};
await fs.mkdir(path.join(rootDir, "data"), { recursive: true });
await fs.writeFile(path.join(rootDir, "data/browser-evidence.json"), `${JSON.stringify(finalEvidence, null, 2)}\n`);
await fs.writeFile(path.join(outputDir, "validation.json"), `${JSON.stringify(validation, null, 2)}\n`);
console.log(JSON.stringify(validation));
if (!validation.passed) process.exitCode = 1;
