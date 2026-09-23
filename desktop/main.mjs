import { app, BrowserWindow, ipcMain, safeStorage, shell } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(desktopDir, "..");
const outputRoot = app.isPackaged
  ? path.join(app.getPath("documents"), "DeskResearch", "outputs")
  : path.join(rootDir, "outputs");
let mainWindow;
const tasks = new Map();
let taskSequence = 0;

function llmPaths() {
  const configDir = path.join(app.getPath("userData"), "llm");
  return {
    configDir,
    settingsPath: path.join(configDir, "settings.json"),
    secretPath: path.join(configDir, "api-key.bin")
  };
}

function normalizeBaseUrl(value) {
  const url = new URL(String(value || "").trim());
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname))) {
    throw new Error("模型地址必须使用 HTTPS；本机 localhost 可使用 HTTP");
  }
  return url.toString().replace(/\/$/, "");
}

async function readLlmConfig({ includeSecret = false } = {}) {
  const { settingsPath, secretPath } = llmPaths();
  let settings = { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" };
  try {
    settings = { ...settings, ...JSON.parse(await fs.readFile(settingsPath, "utf8")) };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let apiKey = "";
  try {
    const encrypted = await fs.readFile(secretPath);
    const available = await safeStorage.isAsyncEncryptionAvailable();
    if (!available) throw new Error("当前系统安全存储不可用");
    const decrypted = await safeStorage.decryptStringAsync(encrypted);
    apiKey = decrypted.result;
    if (decrypted.shouldReEncrypt) {
      await fs.writeFile(secretPath, await safeStorage.encryptStringAsync(apiKey), { mode: 0o600 });
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return {
    baseUrl: settings.baseUrl,
    model: settings.model,
    configured: Boolean(settings.baseUrl && settings.model && apiKey),
    ...(includeSecret ? { apiKey } : {})
  };
}

async function saveLlmConfig(input) {
  const baseUrl = normalizeBaseUrl(input?.baseUrl);
  const model = String(input?.model || "").trim();
  const apiKey = String(input?.apiKey || "").trim();
  if (!model) throw new Error("请填写模型名");
  const paths = llmPaths();
  await fs.mkdir(paths.configDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(paths.settingsPath, `${JSON.stringify({ baseUrl, model }, null, 2)}\n`, { mode: 0o600 });
  if (apiKey) {
    const available = await safeStorage.isAsyncEncryptionAvailable();
    if (!available) throw new Error("当前系统安全存储不可用，未保存 API Key");
    await fs.writeFile(paths.secretPath, await safeStorage.encryptStringAsync(apiKey), { mode: 0o600 });
  }
  const saved = await readLlmConfig();
  if (!saved.configured) throw new Error("请填写 API Key");
  return saved;
}

async function testLlmConfig() {
  const config = await readLlmConfig({ includeSecret: true });
  if (!config.configured) throw new Error("请先保存完整的模型配置");
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: "user", content: "只回复 OK" }],
      temperature: 0,
      max_tokens: 8
    }),
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`模型接口返回 HTTP ${response.status}${detail ? `：${detail}` : ""}`);
  }
  return { ok: true };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 760,
    minHeight: 640,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#F4F4F0",
    show: !process.argv.includes("--smoke-test"),
    webPreferences: {
      preload: path.join(desktopDir, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.loadFile(path.join(desktopDir, "ui/index.html"));
  if (process.argv.includes("--smoke-test")) {
    mainWindow.webContents.once("did-finish-load", async () => {
      const state = await mainWindow.webContents.executeJavaScript(`(async () => {
        const modelConfig = await window.officeAgent.getLlmConfig();
        return {
          title: document.title,
          hasPrompt: Boolean(document.querySelector('#taskPrompt')),
          hasRunButton: Boolean(document.querySelector('#runTask')),
          hasApproval: Boolean(document.querySelector('#approvalModal')),
          hasSettings: Boolean(document.querySelector('#settingsModal')),
          hasSecureApi: Boolean(window.officeAgent?.discoverSources && window.officeAgent?.startTask && window.officeAgent?.openArtifact && window.officeAgent?.getLlmConfig && window.officeAgent?.saveLlmConfig),
          secretHidden: !Object.hasOwn(modelConfig, 'apiKey')
        };
      })()`);
      console.log(JSON.stringify(state));
      app.exit(state.hasPrompt && state.hasRunButton && state.hasApproval && state.hasSettings && state.hasSecureApi && state.secretHidden ? 0 : 1);
    });
  }
}

function runJsonProcess(scriptName, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(rootDir, `src/${scriptName}`), ...args], {
      cwd: app.getPath("userData"),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) return reject(new Error(stderr.trim() || `来源搜索进程退出码 ${code}`));
      try {
        const line = stdout.trim().split("\n").filter(Boolean).at(-1);
        resolve(JSON.parse(line));
      } catch {
        reject(new Error("来源搜索返回了无法解析的结果"));
      }
    });
  });
}

ipcMain.handle("sources:discover", async (_event, prompt) => {
  if (!prompt?.trim()) throw new Error("请先输入研究任务");
  return runJsonProcess("discover_sources.mjs", ["--prompt", prompt.trim()]);
});

ipcMain.handle("llm:get-config", () => readLlmConfig());
ipcMain.handle("llm:save-config", (_event, input) => saveLlmConfig(input));
ipcMain.handle("llm:test-config", () => testLlmConfig());

ipcMain.handle("task:start", async (_event, request) => {
  const prompt = typeof request === "string" ? request : request?.prompt;
  const sources = Array.isArray(request?.sources) ? request.sources : [];
  const llmConfig = await readLlmConfig({ includeSecret: true });
  const taskId = `task-${Date.now()}-${++taskSequence}`;
  const child = spawn(process.execPath, [
    path.join(rootDir, "src/run_task.mjs"),
    "--prompt", prompt,
    "--sources-json", JSON.stringify(sources),
    "--output-root", outputRoot,
    "--task-id", taskId
  ], {
    cwd: app.getPath("userData"),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      DESKRESEARCH_LLM_BASE_URL: llmConfig.configured ? llmConfig.baseUrl : "",
      DESKRESEARCH_LLM_MODEL: llmConfig.configured ? llmConfig.model : "",
      DESKRESEARCH_LLM_API_KEY: llmConfig.configured ? llmConfig.apiKey : ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  tasks.set(taskId, { child, prompt });
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        mainWindow.webContents.send("task:event", { ...event, taskId: event.taskId || event.runId || taskId });
      } catch {
        mainWindow.webContents.send("task:event", { type: "task.log", taskId, message: line });
      }
    }
  });
  child.stderr.on("data", (chunk) => mainWindow.webContents.send("task:event", { type: "task.log", taskId, message: chunk.toString() }));
  child.on("exit", (code) => {
    if (code !== 0) mainWindow.webContents.send("task:event", { type: "task.failed", taskId, message: `任务进程退出码 ${code}` });
    tasks.delete(taskId);
  });
  return { started: true, taskId, prompt };
});

ipcMain.handle("artifact:open", async (_event, targetPath) => {
  const resolvedPath = path.resolve(targetPath);
  const relativePath = path.relative(outputRoot, resolvedPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) throw new Error("只能打开任务输出目录中的文件");
  const error = await shell.openPath(resolvedPath);
  if (error) throw new Error(error);
  return { opened: true };
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
