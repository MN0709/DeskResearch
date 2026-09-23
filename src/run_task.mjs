import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { collectBrowserEvidence } from "./lib/browser-collector.mjs";
import { analyzeResearchEvidence } from "./lib/research-evidence.mjs";
import { synthesizeResearch } from "./lib/llm-synthesis.mjs";

const rootDir = path.resolve(import.meta.dirname, "..");
const promptIndex = process.argv.indexOf("--prompt");
const prompt = promptIndex >= 0 ? process.argv[promptIndex + 1] : "调研 Kimi Work、豆包工作、WorkBuddy、千问办公";
const sourcesJsonIndex = process.argv.indexOf("--sources-json");
const selectedSources = sourcesJsonIndex >= 0 ? JSON.parse(process.argv[sourcesJsonIndex + 1]) : [];
const outputRootIndex = process.argv.indexOf("--output-root");
const outputRoot = outputRootIndex >= 0 ? path.resolve(process.argv[outputRootIndex + 1]) : path.join(rootDir, "outputs");
const taskIdIndex = process.argv.indexOf("--task-id");
const taskId = taskIdIndex >= 0 ? process.argv[taskIdIndex + 1] : `task-${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}`;
const taskDir = path.join(outputRoot, "mvp-task", taskId);
const configuredSources = JSON.parse(await fs.readFile(path.join(rootDir, "config/sources.json"), "utf8"));
const customResearch = selectedSources.length > 0;
const sources = customResearch ? [{
  product: "自定义研究",
  company: "",
  sources: selectedSources.map((source) => ({ label: source.title || source.domain, url: source.url }))
}] : configuredSources;

function emit(type, payload = {}) {
  process.stdout.write(`${JSON.stringify({ type, taskId, at: new Date().toISOString(), ...payload })}\n`);
}

async function runBuilder(inputPath) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(rootDir, "src/build_outputs.mjs"),
      "--input", inputPath,
      "--output-dir", taskDir,
      "--quiet"
    ], { cwd: outputRoot, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(stderr || `文件生成器退出码 ${code}`)));
  });
}

try {
  await fs.mkdir(taskDir, { recursive: true });
  emit("task.started", { prompt });
  const evidence = await collectBrowserEvidence({
    sources,
    runId: taskId,
    screenshotDir: path.join(taskDir, "screenshots"),
    includeText: customResearch
  });
  if (customResearch) {
    const pages = evidence.products.flatMap((product) => product.sources);
    evidence.mode = "research";
    evidence.research = analyzeResearchEvidence(prompt, pages);
    emit("task.synthesizing", { configured: Boolean(process.env.DESKRESEARCH_LLM_API_KEY) });
    try {
      evidence.research.synthesis = await synthesizeResearch(evidence.research);
    } catch (error) {
      evidence.research.synthesis = { status: "failed", message: error.message, findings: [], conflicts: [] };
      emit("task.log", { message: `语义总结失败，已保留原始证据输出：${error.message}` });
    }
    for (const page of pages) delete page.text;
  }
  const failedSources = evidence.products.flatMap((product) => product.sources.map((source) => ({
    product: product.product,
    label: source.label,
    status: source.status,
    textLength: source.textLength ?? 0,
    error: source.error ?? ""
  }))).filter((source) => source.status < 200 || source.status >= 400 || source.textLength === 0);
  evidence.validation = {
    runs: 1,
    consistent: true,
    failedSourceCount: failedSources.length,
    failedSources,
    passed: failedSources.length === 0,
    limitations: [
      "仅验证公开网页，不包含登录、验证码和 Cookie 复用",
      "未验证 Pages、Numbers、Excel、Word 等原生应用控制",
      evidence.research?.synthesis?.status === "completed"
        ? "模型总结仅使用已采集证据，引用已校验；仍需人工判断来源可靠性与适用范围"
        : "未启用或未完成模型总结，报告回退为原文证据摘录"
    ]
  };
  const evidencePath = path.join(taskDir, "evidence.json");
  await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  emit("task.collected", { failedSourceCount: failedSources.length });
  emit("task.generating");
  await runBuilder(evidencePath);
  const artifacts = [
    { label: customResearch ? "研究证据底稿" : "竞品能力对比", path: path.join(taskDir, customResearch ? "研究证据底稿.xlsx" : "办公Agent浏览器POC.xlsx"), kind: "xlsx" },
    { label: customResearch ? "带引用研究报告" : "技术验证报告", path: path.join(taskDir, customResearch ? "研究报告.md" : "技术验证报告.md"), kind: "markdown" },
    { label: "结构化证据", path: evidencePath, kind: "json" }
  ];
  emit("task.completed", { artifacts, failedSourceCount: failedSources.length });
} catch (error) {
  emit("task.failed", { message: error.message });
  process.exitCode = 1;
}
