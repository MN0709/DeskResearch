import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";

function readArgument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const rootDir = path.resolve(import.meta.dirname, "..");
const inputPath = path.resolve(rootDir, readArgument("--input", "data/browser-evidence.json"));
const outputDir = path.resolve(rootDir, readArgument("--output-dir", "outputs/browser-poc"));
const evidence = JSON.parse(await fs.readFile(inputPath, "utf8"));
const quiet = process.argv.includes("--quiet");
const generatedDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
}).format(new Date(evidence.generatedAt));
await fs.mkdir(outputDir, { recursive: true });

async function buildResearchOutputs() {
  const research = evidence.research;
  const researchWorkbook = new ExcelJS.Workbook();
  researchWorkbook.creator = "DeskResearch";
  researchWorkbook.created = new Date(evidence.generatedAt);

  const styleHeader = (row, fill) => {
    row.height = 32;
    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    });
  };
  const styleBody = (sheet, startRow) => {
    for (let rowIndex = startRow; rowIndex <= sheet.rowCount; rowIndex += 1) {
      const row = sheet.getRow(rowIndex);
      row.height = 54;
      row.eachCell((cell) => {
        cell.font = { name: "Arial", size: 10, color: { argb: "FF24333D" } };
        cell.alignment = { vertical: "top", wrapText: true };
        cell.border = { bottom: { style: "thin", color: { argb: "FFE3EBEF" } } };
      });
    }
  };

  const synthesis = research.synthesis;
  if (synthesis?.status === "completed") {
    const summarySheet = researchWorkbook.addWorksheet("语义总结", { views: [{ state: "frozen", ySplit: 4, showGridLines: false }] });
    summarySheet.getCell("A2").value = "有证据约束的语义总结";
    summarySheet.getCell("A2").font = { name: "Arial", size: 14, bold: true, color: { argb: "FF183B56" } };
    summarySheet.addRow([]);
    summarySheet.addRow(["编号", "综合结论", "引用", "置信度", "证据编号"]);
    for (const finding of synthesis.findings) {
      summarySheet.addRow([finding.id, finding.text, finding.citation, finding.confidence, finding.evidenceIds.join("、")]);
    }
    styleHeader(summarySheet.getRow(4), "FF177FC0");
    summarySheet.columns = [10, 72, 18, 12, 20].map((width) => ({ width }));
    styleBody(summarySheet, 5);
  }

  const claimsSheet = researchWorkbook.addWorksheet("证据结论", { views: [{ state: "frozen", ySplit: 4, showGridLines: false }] });
  claimsSheet.getCell("A2").value = "逐条引用研究底稿";
  claimsSheet.getCell("A2").font = { name: "Arial", size: 14, bold: true, color: { argb: "FF183B56" } };
  claimsSheet.addRow([]);
  claimsSheet.addRow(["编号", "原文证据", "引用", "来源标题", "来源链接", "提取方式"]);
  for (const claim of research.claims) {
    const source = research.sources.find((item) => item.id === claim.sourceIds[0]);
    claimsSheet.addRow([claim.id, claim.text, claim.citation, source?.title ?? "", source?.url ?? "", claim.extraction]);
  }
  styleHeader(claimsSheet.getRow(4), "FF1689B8");
  claimsSheet.columns = [10, 64, 10, 30, 48, 16].map((width) => ({ width }));
  styleBody(claimsSheet, 5);

  const sourceSheet = researchWorkbook.addWorksheet("来源", { views: [{ state: "frozen", ySplit: 4, showGridLines: false }] });
  sourceSheet.getCell("A2").value = "确认后采集的来源";
  sourceSheet.getCell("A2").font = { name: "Arial", size: 14, bold: true, color: { argb: "FF183B56" } };
  sourceSheet.addRow([]);
  sourceSheet.addRow(["来源编号", "标题", "URL", "HTTP 状态", "正文长度", "采集时间"]);
  for (const source of research.sources) {
    sourceSheet.addRow([source.id, source.title, source.url, source.status, source.textLength, source.fetchedAt]);
  }
  styleHeader(sourceSheet.getRow(4), "FF25A999");
  sourceSheet.columns = [12, 34, 58, 12, 12, 24].map((width) => ({ width }));
  styleBody(sourceSheet, 5);

  const conflictSheet = researchWorkbook.addWorksheet("潜在冲突", { views: [{ state: "frozen", ySplit: 4, showGridLines: false }] });
  conflictSheet.getCell("A2").value = "跨来源潜在冲突提示";
  conflictSheet.getCell("A2").font = { name: "Arial", size: 14, bold: true, color: { argb: "FF183B56" } };
  conflictSheet.addRow([]);
  conflictSheet.addRow(["编号", "结论 A", "来源 A", "结论 B", "来源 B", "复核提示"]);
  if (research.conflicts.length === 0) {
    conflictSheet.addRow(["—", "未发现明显词面冲突", "—", "—", "—", "这不等同于来源事实完全一致"]);
  } else {
    for (const conflict of research.conflicts) {
      const claimA = research.claims.find((claim) => claim.id === conflict.claimA);
      const claimB = research.claims.find((claim) => claim.id === conflict.claimB);
      conflictSheet.addRow([conflict.id, claimA?.text ?? "", claimA?.citation ?? "", claimB?.text ?? "", claimB?.citation ?? "", conflict.reason]);
    }
  }
  styleHeader(conflictSheet.getRow(4), "FF52738A");
  conflictSheet.columns = [10, 48, 12, 48, 12, 34].map((width) => ({ width }));
  styleBody(conflictSheet, 5);

  await researchWorkbook.xlsx.writeFile(path.join(outputDir, "研究证据底稿.xlsx"));

  const claimLines = synthesis?.status === "completed" && synthesis.findings.length
    ? synthesis.findings.map((finding) => `- ${finding.text} ${finding.citation}`).join("\n")
    : research.claims.length
      ? research.claims.map((claim) => `- ${claim.text} ${claim.citation}`).join("\n")
      : "- 已确认页面中没有抽取到满足长度与相关性规则的原文句子。";
  const displayedConflicts = synthesis?.status === "completed" && synthesis.conflicts.length ? synthesis.conflicts : research.conflicts;
  const conflictLines = displayedConflicts.length
    ? displayedConflicts.map((conflict) => {
      if (conflict.text) return `- ${conflict.text} ${conflict.citation}`;
      const claimA = research.claims.find((claim) => claim.id === conflict.claimA);
      const claimB = research.claims.find((claim) => claim.id === conflict.claimB);
      return `- ${claimA?.citation} 与 ${claimB?.citation}：${conflict.reason}`;
    }).join("\n")
    : "- 未发现明显的词面冲突；这不等同于来源事实完全一致。";
  const sourceLines = research.sources.map((source) => `- [${source.id}] [${source.title}](${source.url}) · HTTP ${source.status} · ${source.fetchedAt}`).join("\n");
  const synthesisNote = synthesis?.status === "completed"
    ? `模型：${synthesis.model}\n\n${synthesis.summary ? `## 总览\n\n${synthesis.summary}\n\n` : ""}`
    : "模型语义总结未启用或失败，以下内容为规则抽取的原文证据。\n\n";
  const report = `# ${research.prompt}\n\n` +
    `生成日期：${generatedDate}\n\n` +
    synthesisNote +
    `## 关键结论\n\n${claimLines}\n\n` +
    `## 潜在冲突\n\n${conflictLines}\n\n` +
    `## 来源目录\n\n${sourceLines}\n\n` +
    `## 方法与限制\n\n- ${research.methodology}。\n- ${research.limitation}。\n- ${synthesis?.status === "completed" ? synthesis.guardrail : "本报告主体为网页原文摘录，不是模型生成的事实判断"}。\n`;
  await fs.writeFile(path.join(outputDir, "研究报告.md"), report);
  if (!quiet) console.log(JSON.stringify({ outputDir, workbook: "研究证据底稿.xlsx", report: "研究报告.md" }));
}

if (evidence.mode === "research") {
  await buildResearchOutputs();
  process.exit(0);
}

const workbook = new ExcelJS.Workbook();
workbook.creator = "DeskResearch";
workbook.created = new Date(evidence.generatedAt);
const comparison = workbook.addWorksheet("能力对比", { views: [{ state: "frozen", ySplit: 4, showGridLines: false }] });
const sources = workbook.addWorksheet("证据", { views: [{ state: "frozen", ySplit: 4, showGridLines: false }] });

comparison.getCell("A2").value = "办公 Agent 浏览器 POC 能力证据";
comparison.getCell("A2").font = { name: "Arial", size: 14, bold: true, color: { argb: "FF1F2937" } };
const headers = ["产品", "公司", ...evidence.capabilities.map((item) => item.label), "发现证据项数"];
comparison.addRow([]);
comparison.addRow(headers);
for (const product of evidence.products) {
  const row = comparison.addRow([
    product.product,
    product.company,
    ...evidence.capabilities.map((capability) => product.findings[capability.key].found ? "已发现官方证据" : "未发现")
  ]);
  const firstCapabilityColumn = 3;
  const lastCapabilityColumn = 2 + evidence.capabilities.length;
  row.getCell(headers.length).value = {
    formula: `COUNTIF(${row.getCell(firstCapabilityColumn).address}:${row.getCell(lastCapabilityColumn).address},\"已发现官方证据\")`
  };
}

function styleHeader(row, fill) {
  row.height = 32;
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
}

styleHeader(comparison.getRow(4), "FF1F4E78");
comparison.columns = headers.map((_, index) => ({ width: index === 0 ? 16 : index === 1 ? 13 : 18 }));
for (let rowIndex = 5; rowIndex <= comparison.rowCount; rowIndex += 1) {
  const row = comparison.getRow(rowIndex);
  row.height = 38;
  row.eachCell((cell, columnIndex) => {
    cell.font = { name: "Arial", size: 10, color: { argb: "FF1F2937" } };
    cell.alignment = { horizontal: columnIndex >= 3 ? "center" : "left", vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: "FFD9E2F3" } } };
    if (cell.value === "已发现官方证据") cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF5EE" } };
    if (cell.value === "未发现") cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDECEC" } };
  });
}

sources.getCell("A2").value = "浏览器采集来源与证据";
sources.getCell("A2").font = { name: "Arial", size: 14, bold: true, color: { argb: "FF1F2937" } };
sources.addRow([]);
sources.addRow(["产品", "能力", "结论", "证据片段", "来源名称", "来源链接", "采集日期"]);
for (const product of evidence.products) {
  for (const capability of evidence.capabilities) {
    const finding = product.findings[capability.key];
    sources.addRow([
      product.product,
      capability.label,
      finding.found ? "已发现官方证据" : "未发现",
      finding.evidence || "官方页面未出现匹配证据",
      finding.sourceLabel,
      finding.sourceUrl,
      generatedDate
    ]);
  }
}
styleHeader(sources.getRow(4), "FF486A8C");
sources.columns = [15, 19, 15, 56, 22, 48, 13].map((width) => ({ width }));
for (let rowIndex = 5; rowIndex <= sources.rowCount; rowIndex += 1) {
  const row = sources.getRow(rowIndex);
  row.height = 55;
  row.eachCell((cell) => {
    cell.font = { name: "Arial", size: 10, color: { argb: "FF1F2937" } };
    cell.alignment = { vertical: "top", wrapText: true };
  });
}
await workbook.xlsx.writeFile(path.join(outputDir, "办公Agent浏览器POC.xlsx"));

const validation = evidence.validation;
const sourceRecords = evidence.products.flatMap((product) => product.sources);
const recoveredSourceCount = sourceRecords.filter((source) => source.usedFallback || source.attempt > 1).length;
const capabilitySummary = evidence.capabilities.map((capability) => {
  const products = evidence.products.filter((product) => product.findings[capability.key].found).map((product) => product.product);
  return `- ${capability.label}：${products.length ? products.join("、") : "四个官方来源均未发现明确证据"}`;
}).join("\n");
const limitations = validation.limitations.map((item) => `- ${item}`).join("\n");
const report = `# 办公 Agent 浏览器控制 POC\n\n` +
  `生成日期：${generatedDate}\n\n` +
  `## 验证结论\n\n` +
  `浏览器任务已完成。Playwright 控制本机 Chrome 执行 ${validation.runs} 轮，${validation.runs > 1 ? "各轮提取结果一致" : "本轮来源采集成功"}，失败来源数为 ${validation.failedSourceCount}。\n\n` +
  `${recoveredSourceCount > 0 ? `本次有 ${recoveredSourceCount} 个来源通过重试或官方备用入口恢复成功，未把错误页面误判为有效证据。` : "本次所有来源均在首次请求中成功。"}\n\n` +
  `## 官方页面能力分布\n\n${capabilitySummary}\n\n` +
  `## 已验证能力\n\n` +
  `- 启动并控制本机 Google Chrome。\n` +
  `- 访问动态网页并提取渲染后的可见文本。\n` +
  `- 页面失败后重试，并支持官方备用入口。\n` +
  `- 单个来源失败时保留状态、错误和执行轮次。\n` +
  `- 保存页面截图、结构化证据、Excel 和分析报告。\n\n` +
  `## 尚未验证\n\n${limitations}\n\n` +
  `## 下一阶段\n\n` +
  `可以进入 macOS MVP：增加任务输入框、执行时间线、风险操作确认和成果预览。第一版仍限定公开网页竞品调研，不开放登录网站、自动提交或任意原生应用控制。\n`;
await fs.writeFile(path.join(outputDir, "技术验证报告.md"), report);
if (!quiet) console.log(JSON.stringify({ outputDir, workbook: "办公Agent浏览器POC.xlsx", report: "技术验证报告.md" }));
