import fs from "node:fs/promises";
import { chromium } from "playwright-core";

const chromeCandidates = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
];

const promptIndex = process.argv.indexOf("--prompt");
const prompt = promptIndex >= 0 ? process.argv[promptIndex + 1] : "";

async function findBrowser() {
  for (const candidate of chromeCandidates) {
    try {
      await fs.access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error("未找到可执行的 Chrome、Edge 或 Chromium");
}

function searchQuery(value) {
  return value
    .replace(/[，。！？；、,.!?;:：]/g, " ")
    .replace(/(请|帮我|希望|需要|生成|输出|制作|整理|调研|研究|分析|比较|对比|一份|一个|带来源|报告|表格|Excel|PPT|产品能力|产品功能)/giu, " ")
    .replace(/(^|\s)(和|与|及|并|的)(?=\s|$)/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

function decodeBingUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const encoded = parsed.searchParams.get("u");
    if (parsed.hostname.endsWith("bing.com") && encoded?.startsWith("a1")) {
      return Buffer.from(encoded.slice(2), "base64url").toString("utf8");
    }
  } catch {}
  return rawUrl;
}

function isPublicUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local")) return false;
    if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(host)) return false;
    const private172 = host.match(/^172\.(\d+)\./);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
    return true;
  } catch {
    return false;
  }
}

const executablePath = await findBrowser();
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1280, height: 900 } });

try {
  const query = searchQuery(prompt) || prompt.trim().slice(0, 100);
  const namedEntities = [...new Set((prompt.match(/[A-Z][A-Za-z0-9-]*(?:\s+[A-Z][A-Za-z0-9-]*)*/g) ?? [])
    .map((item) => item.trim())
    .filter((item) => !/^(AI|Agent|Excel|PPT)$/i.test(item)))];
  const queries = namedEntities.length > 1 ? namedEntities.slice(0, 4) : [query];
  const resultGroups = [];
  for (const itemQuery of queries) {
    const response = await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(`${itemQuery} 官方 介绍`)}`, {
      waitUntil: "domcontentloaded",
      timeout: 35_000
    });
    if (!response || response.status() >= 400) throw new Error(`搜索服务返回 HTTP ${response?.status() ?? 0}`);
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    let group = [];
    let readError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.waitForTimeout(500 + attempt * 400);
      try {
        group = await page.locator("li.b_algo").evaluateAll((items) => items.slice(0, 12).map((item) => {
          const link = item.querySelector("h2 a");
          return {
            title: link?.textContent?.trim() || "",
            url: link?.href || "",
            snippet: item.querySelector(".b_caption p")?.textContent?.trim() || ""
          };
        }));
        if (group.length > 0) break;
      } catch (error) {
        readError = error;
      }
    }
    if (group.length === 0 && readError) throw readError;
    resultGroups.push(group);
  }
  const rawResults = [];
  for (let index = 0; index < 12; index += 1) {
    for (const group of resultGroups) {
      if (group[index]) rawResults.push(group[index]);
    }
  }
  const seen = new Set();
  const domainCounts = new Map();
  const results = [];
  for (const result of rawResults) {
    const url = decodeBingUrl(result.url);
    if (!result.title || !isPublicUrl(url)) continue;
    const parsed = new URL(url);
    const key = `${parsed.hostname}${parsed.pathname}`.replace(/\/$/, "");
    const domain = parsed.hostname.replace(/^www\./, "");
    if (seen.has(key) || parsed.hostname.endsWith("bing.com") || (domainCounts.get(domain) ?? 0) >= 2) continue;
    seen.add(key);
    domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
    results.push({
      id: `R${results.length + 1}`,
      title: result.title,
      url,
      domain,
      snippet: result.snippet.slice(0, 220)
    });
    if (results.length >= 8) break;
  }
  if (results.length === 0) throw new Error("未找到可用候选来源，请调整任务描述后重试");
  process.stdout.write(`${JSON.stringify({ query: queries.join(" / "), provider: "Bing", results })}\n`);
} finally {
  await browser.close();
}
