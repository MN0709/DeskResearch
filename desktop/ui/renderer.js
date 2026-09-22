const runButton = document.querySelector("#runTask");
const newTaskButton = document.querySelector("#newTask");
const promptInput = document.querySelector("#taskPrompt");
const modal = document.querySelector("#approvalModal");
const confirmButton = document.querySelector("#confirmApproval");
const cancelButton = document.querySelector("#cancelApproval");
const approvalTitle = document.querySelector("#approvalTitle");
const sourceHint = document.querySelector("#sourceHint");
const sourceDiscovery = document.querySelector("#sourceDiscovery");
const statusChip = document.querySelector("#taskStatus");
const progressLabel = document.querySelector("#progressLabel");
const liveLog = document.querySelector("#liveLog");
const artifactsContainer = document.querySelector("#artifacts");
const historyStatus = document.querySelector(".history-item small");
const logPanel = document.querySelector(".log-panel");
const quickActions = [...document.querySelectorAll("[data-prompt]")];
const openSettingsButton = document.querySelector("#openSettings");
const settingsModal = document.querySelector("#settingsModal");
const settingsForm = document.querySelector("#settingsForm");
const closeSettingsButton = document.querySelector("#closeSettings");
const testSettingsButton = document.querySelector("#testSettings");
const baseUrlInput = document.querySelector("#baseUrl");
const modelNameInput = document.querySelector("#modelName");
const apiKeyInput = document.querySelector("#apiKey");
const settingsStatus = document.querySelector("#settingsStatus");
const modelStatus = document.querySelector("#modelStatus");
const steps = Object.fromEntries([...document.querySelectorAll(".timeline-item")].map((item) => [item.dataset.step, item]));
let discoveredSources = [];
let discoveryAttempt = 0;

function setStatus(text, state) {
  statusChip.textContent = text;
  statusChip.className = `status-chip ${state}`;
  historyStatus.textContent = text;
}

function setStep(name, state) {
  const step = steps[name];
  if (step) step.className = `timeline-item ${state}`;
}

function appendLog(message) {
  if (liveLog.textContent === "等待任务开始…") liveLog.textContent = "";
  liveLog.textContent += `${message}\n`;
  liveLog.scrollTop = liveLog.scrollHeight;
}

function showModelState(config) {
  modelStatus.innerHTML = "<i></i>";
  modelStatus.append(config.configured ? `模型 · ${config.model}` : "规则模式");
  settingsStatus.textContent = config.configured ? `已安全保存 · ${config.model}` : "尚未配置 API Key";
  settingsStatus.className = `settings-status ${config.configured ? "success" : ""}`;
}

async function loadModelConfig() {
  try {
    const config = await window.officeAgent.getLlmConfig();
    baseUrlInput.value = config.baseUrl || "";
    modelNameInput.value = config.model || "";
    apiKeyInput.value = "";
    showModelState(config);
  } catch (error) {
    settingsStatus.textContent = error.message;
    settingsStatus.className = "settings-status error";
  }
}

function resetTask() {
  Object.values(steps).forEach((step) => { step.className = "timeline-item pending"; });
  liveLog.textContent = "等待任务开始…";
  artifactsContainer.className = "empty-state";
  artifactsContainer.innerHTML = '<div class="empty-visual"><span></span><span></span><span></span></div><strong>成果将在这里出现</strong><small>完成后可直接打开 Excel、报告和证据文件。</small>';
}

function showArtifacts(artifacts) {
  artifactsContainer.className = "artifact-list";
  artifactsContainer.innerHTML = "";
  for (const artifact of artifacts) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "artifact-button";
    button.innerHTML = `<span class="artifact-kind">${artifact.kind}</span><span><strong>${artifact.label}</strong><small>点击打开本地文件</small></span>`;
    button.addEventListener("click", () => window.officeAgent.openArtifact(artifact.path));
    artifactsContainer.appendChild(button);
  }
}

function selectedSources() {
  return [...sourceDiscovery.querySelectorAll("input:checked")]
    .map((input) => discoveredSources[Number(input.value)])
    .filter(Boolean);
}

function updateConfirmState() {
  const count = selectedSources().length;
  confirmButton.disabled = count === 0;
  confirmButton.textContent = count > 0 ? `确认 ${count} 个来源并开始` : "确认来源并开始";
}

function renderSources(result) {
  discoveredSources = result.results;
  sourceDiscovery.className = "source-discovery";
  sourceDiscovery.innerHTML = "";
  result.results.forEach((source, index) => {
    const option = document.createElement("label");
    option.className = "source-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = String(index);
    checkbox.checked = index < 4;
    checkbox.addEventListener("change", updateConfirmState);
    const copy = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = source.title;
    const snippet = document.createElement("small");
    snippet.textContent = source.snippet || source.url;
    const domain = document.createElement("em");
    domain.textContent = source.domain;
    copy.append(title, snippet);
    option.append(checkbox, copy, domain);
    sourceDiscovery.appendChild(option);
  });
  approvalTitle.textContent = "确认本次研究来源";
  sourceHint.textContent = `搜索关键词：“${result.query}”。请取消不可信或与任务无关的网站，Agent 只会访问勾选页面。`;
  updateConfirmState();
}

function renderDiscoveryError(error) {
  discoveredSources = [];
  sourceDiscovery.className = "source-discovery";
  sourceDiscovery.innerHTML = "";
  const message = document.createElement("div");
  message.className = "source-error";
  message.textContent = error.message || "来源搜索失败，请调整任务描述后重试。";
  sourceDiscovery.appendChild(message);
  approvalTitle.textContent = "没有找到可用来源";
  sourceHint.textContent = "关闭窗口并补充更具体的主题、产品名或机构名后重试。";
  updateConfirmState();
}

runButton.addEventListener("click", async () => {
  if (!promptInput.value.trim()) return;
  const attempt = ++discoveryAttempt;
  modal.classList.remove("hidden");
  approvalTitle.textContent = "正在查找候选来源…";
  sourceHint.textContent = "Agent 会把精简后的研究关键词发送给 Bing 搜索。找到候选网页后，由你确认哪些页面可以访问。";
  sourceDiscovery.className = "source-discovery loading-state";
  sourceDiscovery.innerHTML = "<span></span><strong>正在搜索公开网页</strong><small>不会访问你的浏览历史或登录状态</small>";
  confirmButton.disabled = true;
  confirmButton.textContent = "确认来源并开始";
  try {
    const result = await window.officeAgent.discoverSources(promptInput.value.trim());
    if (attempt === discoveryAttempt) renderSources(result);
  } catch (error) {
    if (attempt === discoveryAttempt) renderDiscoveryError(error);
  }
});
newTaskButton.addEventListener("click", () => {
  resetTask();
  setStatus("准备就绪", "idle");
  progressLabel.textContent = "尚未开始";
  promptInput.focus();
});
for (const action of quickActions) {
  action.addEventListener("click", () => {
    promptInput.value = action.dataset.prompt;
    promptInput.focus();
  });
}
openSettingsButton.addEventListener("click", async () => {
  settingsModal.classList.remove("hidden");
  await loadModelConfig();
  baseUrlInput.focus();
});
closeSettingsButton.addEventListener("click", () => settingsModal.classList.add("hidden"));
settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  settingsStatus.textContent = "正在安全保存…";
  settingsStatus.className = "settings-status";
  try {
    const config = await window.officeAgent.saveLlmConfig({
      baseUrl: baseUrlInput.value,
      model: modelNameInput.value,
      apiKey: apiKeyInput.value
    });
    apiKeyInput.value = "";
    showModelState(config);
  } catch (error) {
    settingsStatus.textContent = error.message;
    settingsStatus.className = "settings-status error";
  }
});
testSettingsButton.addEventListener("click", async () => {
  testSettingsButton.disabled = true;
  settingsStatus.textContent = "正在请求模型接口…";
  settingsStatus.className = "settings-status";
  try {
    await window.officeAgent.testLlmConfig();
    settingsStatus.textContent = "连接成功，模型可用";
    settingsStatus.className = "settings-status success";
  } catch (error) {
    settingsStatus.textContent = error.message;
    settingsStatus.className = "settings-status error";
  } finally {
    testSettingsButton.disabled = false;
  }
});
cancelButton.addEventListener("click", () => {
  discoveryAttempt += 1;
  modal.classList.add("hidden");
});
confirmButton.addEventListener("click", async () => {
  const sources = selectedSources();
  if (sources.length === 0) return;
  modal.classList.add("hidden");
  resetTask();
  runButton.disabled = true;
  setStatus("执行中", "running");
  progressLabel.textContent = "正在确认权限";
  setStep("approval", "done");
  setStep("browse", "active");
  logPanel.open = true;
  appendLog(`已确认 ${sources.length} 个公开来源：${sources.map((source) => source.domain).join("、")}`);
  try {
    await window.officeAgent.startTask({ prompt: promptInput.value.trim(), sources });
  } catch (error) {
    setStatus("启动失败", "failed");
    appendLog(error.message);
    runButton.disabled = false;
  }
});

window.officeAgent.onTaskEvent((event) => {
  if (event.state === "started") {
    progressLabel.textContent = `正在访问 ${event.product} · ${event.source}`;
    appendLog(`访问：${event.product} / ${event.source}`);
  }
  if (event.state === "finished") {
    appendLog(`${event.status === 200 ? "完成" : "异常"}：${event.product} / ${event.source} · HTTP ${event.status}`);
  }
  if (event.type === "task.collected") {
    setStep("browse", "done");
    setStep("extract", "done");
    setStep("generate", "active");
    progressLabel.textContent = "正在生成 Excel 和报告";
  }
  if (event.type === "task.synthesizing") {
    setStep("browse", "done");
    setStep("extract", "active");
    progressLabel.textContent = event.configured ? "正在生成带引用语义总结" : "未配置模型，使用规则证据摘要";
    appendLog(event.configured ? "模型正在依据已采集证据生成总结…" : "未配置模型，保留规则抽取结果");
  }
  if (event.type === "task.log" && event.message) appendLog(event.message);
  if (event.type === "task.generating") appendLog("正在生成本地办公成果…");
  if (event.type === "task.completed") {
    setStep("generate", "done");
    setStatus("已完成", "done");
    progressLabel.textContent = `完成 · 失败来源 ${event.failedSourceCount}`;
    appendLog("任务完成，成果已保存到本地");
    showArtifacts(event.artifacts);
    logPanel.open = false;
    runButton.disabled = false;
  }
  if (event.type === "task.failed") {
    setStep("browse", "failed");
    setStep("generate", "failed");
    setStatus("执行失败", "failed");
    progressLabel.textContent = event.message || "任务失败";
    appendLog(event.message || "任务失败");
    runButton.disabled = false;
  }
});

loadModelConfig();
