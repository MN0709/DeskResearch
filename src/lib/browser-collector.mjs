import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { analyzeProduct, capabilities } from "./evidence.mjs";

const chromeCandidates = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
];

async function findBrowser() {
  for (const candidate of chromeCandidates) {
    try {
      await fs.access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error("未找到可执行的 Chrome、Edge 或 Chromium");
}

async function collectSource(context, source, screenshotPath) {
  let lastError;
  let lastStatus = 0;
  const candidateUrls = [source.url, ...(source.fallbackUrls ?? [])];
  for (const candidateUrl of candidateUrls) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const page = await context.newPage();
      try {
        const response = await page.goto(candidateUrl, { waitUntil: "domcontentloaded", timeout: 35_000 });
        lastStatus = response?.status() ?? 0;
        if (lastStatus === 429 || lastStatus >= 500) {
          throw new Error(`可重试的 HTTP ${lastStatus}`);
        }
        if (lastStatus >= 400) {
          throw new Error(`HTTP ${lastStatus}`);
        }
        await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
        await page.waitForTimeout(700);
        const pageData = await page.evaluate(() => ({
          title: document.title,
          description: document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "",
          text: document.body?.innerText ?? ""
        }));
        if (screenshotPath) {
          await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
          await page.screenshot({ path: screenshotPath, fullPage: false });
        }
        return {
          ...source,
          requestedUrl: candidateUrl,
          status: response?.status() ?? 0,
          finalUrl: page.url(),
          fetchedAt: new Date().toISOString(),
          attempt,
          usedFallback: candidateUrl !== source.url,
          textLength: pageData.text.length,
          text: `${pageData.title} ${pageData.description} ${pageData.text}`.replace(/\s+/g, " ").trim()
        };
      } catch (error) {
        lastError = error;
      } finally {
        await page.close().catch(() => {});
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, attempt * 3_000));
    }
  }
  return { ...source, status: lastStatus, error: lastError?.message ?? "未知错误", text: "", attempt: 2 };
}

export async function collectBrowserEvidence({ sources, runId, screenshotDir, includeText = false }) {
  const executablePath = await findBrowser();
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) OfficeAgentBrowserPOC/0.1"
  });
  const products = [];
  try {
    for (const product of sources) {
      const fetchedSources = [];
      for (let index = 0; index < product.sources.length; index += 1) {
        const source = product.sources[index];
        const screenshotPath = index === 0 ? path.join(screenshotDir, `${product.product.replaceAll(" ", "-")}.png`) : null;
        console.log(JSON.stringify({ runId, product: product.product, source: source.label, state: "started" }));
        const fetchedSource = await collectSource(context, source, screenshotPath);
        fetchedSources.push(fetchedSource);
        console.log(JSON.stringify({
          runId,
          product: product.product,
          source: source.label,
          state: "finished",
          status: fetchedSource.status,
          textLength: fetchedSource.textLength ?? 0,
          error: fetchedSource.error ?? ""
        }));
      }
      products.push(analyzeProduct(product, fetchedSources, { includeText }));
    }
  } finally {
    await context.close();
    await browser.close();
  }
  return {
    generatedAt: new Date().toISOString(),
    runId,
    method: "Playwright 控制本机 Chrome 渲染官方网页并提取可见文本",
    runtime: { executablePath, engine: "playwright-core" },
    capabilities: capabilities.map(({ pattern, ...capability }) => capability),
    products
  };
}
