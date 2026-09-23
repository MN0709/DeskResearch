const runButton = document.querySelector("#runTask");
const promptInput = document.querySelector("#taskPrompt");
const homeView = document.querySelector("#homeView");
const tasksView = document.querySelector("#tasksView");
const workspace = document.querySelector(".workspace");
const openTasksButton = document.querySelector("#openTasks");
const backToHomeButton = document.querySelector("#backToHome");
const startFirstTaskButton = document.querySelector("#startFirstTask");
const taskList = document.querySelector("#taskList");
const tasksEmpty = document.querySelector("#tasksEmpty");
const taskBadge = document.querySelector("#taskBadge");
const toast = document.querySelector("#toast");
const modal = document.querySelector("#approvalModal");
const confirmButton = document.querySelector("#confirmApproval");
const cancelButton = document.querySelector("#cancelApproval");
const approvalTitle = document.querySelector("#approvalTitle");
const sourceHint = document.querySelector("#sourceHint");
const sourceDiscovery = document.querySelector("#sourceDiscovery");
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
const tasks = new Map();
let discoveredSources = [];
let discoveryAttempt = 0;
let toastTimer;

function showHome() {
  tasksView.classList.add("hidden");
  homeView.classList.remove("hidden");
  promptInput.focus();
}

function showTasks() {
  homeView.classList.add("hidden");
  tasksView.classList.remove("hidden");
  workspace.scrollTop = 0;
  updateEmptyState();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 4000);
}

function updateBadge() {
  const runningCount = [...tasks.values()].filter((task) => task.status === "running").length;
  taskBadge.textContent = String(runningCount);
  taskBadge.classList.toggle("hidden", runningCount === 0);
}

function updateEmptyState() {
  tasksEmpty.classList.toggle("hidden", tasks.size > 0);
  taskList.classList.toggle("hidden", tasks.size === 0);
}

function createTaskCard(taskId, prompt) {
  const card = document.createElement("article");
  card.className = "task-card";
  card.dataset.taskId = taskId;

  const head = document.createElement("div");
  head.className = "task-card-head";
  const title = document.createElement("strong");
  title.className = "task-title";
  title.textContent = prompt.length > 72 ? `${prompt.slice(0, 72)}…` : prompt;
  title.title = prompt;
  const statusChip = document.createElement("span");
  statusChip.className = "status-chip running";
  statusChip.textContent = "运行中";
  head.append(title, statusChip);

  const progress = document.createElement("div");
  progress.className = "task-progress";
  progress.textContent = "正在准备…";

  const steps = document.createElement("div");
  steps.className = "task-steps";
  const stepDots = {};
  for (const name of ["approval", "browse", "extract", "generate"]) {
    const dot = document.createElement("span");
    dot.className = "task-step";
    dot.dataset.step = name;
    steps.appendChild(dot);
    stepDots[name] = dot;
  }

  const logDetails = document.createElement("details");
  logDetails.className = "task-log";
  const summary = document.createElement("summary");
  summary.textContent = "运行日志";
  const pre = document.createElement("pre");
  pre.className = "task-log-pre";
  pre.textContent = "";
  logDetails.append(summary, pre);

  const artifacts = document.createElement("div");
  artifacts.className = "task-artifacts";

  card.append(head, progress, steps, logDetails, artifacts);
  taskList.prepend(card);

  return {
    id: taskId,
    prompt,
    status: "running",
    stepStates: { approval: "pending", browse: "pending", extract: "pending", generate: "pending" },
    logs: [],
    artifacts: [],
    refs: { title, statusChip, progress, stepDots, logDetails, pre, artifacts }
  };
}

function setTaskStatus(task, text, state) {
  task.status = state === "running" ? "running" : (state === "done" ? "done" : state);
  task.refs.statusChip.textContent = text;
  task.refs.statusChip.className = `status-chip ${state}`;
  updateBadge();
}

function setTaskStep(task, name, state) {
  task.stepStates[name] = state;
  const dot = task.refs.stepDots[name];
  if (dot) dot.className = `task-step ${state}`;
}

function setTaskProgress(task, text) {
  task.refs.progress.textContent = text;
}

function appendTaskLog(task, message) {
  task.logs.push(message);
  const pre = task.refs.pre;
  pre.textContent += `${message}\n`;
  pre.scrollTop = pre.scrollHeight;
}

function showTaskArtifacts(task, artifacts) {
  task.artifacts = artifacts;
  const container = task.refs.artifacts;
  container.innerHTML = "";
  for (const artifact of artifacts) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "artifact-button";
    button.innerHTML = `<span class="artifact-kind">${artifact.kind}</span><span><strong>${artifact.label}</strong><small>点击打开本地文件</small></span>`;
    button.addEventListener("click", () => window.officeAgent.openArtifact(artifact.path));
    container.appendChild(button);
  }
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
  sourceHint.textContent = result.discoveredProducts?.length
    ? `识别到这些调研对象：${result.discoveredProducts.slice(0, 8).join("、")}。正在搜索它们的官方来源，请勾选要访问的页面。`
    : `搜索关键词：“${result.query}”。请取消不可信或与任务无关的网站，Agent 只会访问勾选页面。`;
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

openTasksButton.addEventListener("click", showTasks);
backToHomeButton.addEventListener("click", () => {
  promptInput.value = "";
  showHome();
});
startFirstTaskButton.addEventListener("click", showHome);

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
  const prompt = promptInput.value.trim();
  modal.classList.add("hidden");
  confirmButton.disabled = true;
  try {
    const result = await window.officeAgent.startTask({ prompt, sources });
    const task = createTaskCard(result.taskId, result.prompt || prompt);
    tasks.set(result.taskId, task);
    updateEmptyState();
    updateBadge();
    promptInput.value = "";
    showHome();
    showToast("任务已在后台开始，可随时在「任务」中查看进度");
  } catch (error) {
    showToast(error.message || "任务启动失败");
  }
});

window.officeAgent.onTaskEvent((event) => {
  const task = tasks.get(event.taskId);
  if (!task) return;

  if (event.type === "task.started") {
    setTaskProgress(task, "开始采集公开网页");
    setTaskStep(task, "approval", "done");
    setTaskStep(task, "browse", "active");
  }
  if (event.state === "started") {
    setTaskProgress(task, `正在访问 ${event.product} · ${event.source}`);
    appendTaskLog(task, `访问：${event.product} / ${event.source}`);
  }
  if (event.state === "finished") {
    appendTaskLog(task, `${event.status === 200 ? "完成" : "异常"}：${event.product} / ${event.source} · HTTP ${event.status}`);
  }
  if (event.type === "task.synthesizing") {
    setTaskStep(task, "browse", "done");
    setTaskStep(task, "extract", "active");
    setTaskProgress(task, event.configured ? "正在生成带引用语义总结" : "未配置模型，使用规则证据摘要");
    appendTaskLog(task, event.configured ? "模型正在依据已采集证据生成总结…" : "未配置模型，保留规则抽取结果");
  }
  if (event.type === "task.collected") {
    setTaskStep(task, "extract", "done");
    setTaskStep(task, "generate", "active");
    setTaskProgress(task, "正在生成 Excel 和报告");
  }
  if (event.type === "task.generating") {
    appendTaskLog(task, "正在生成本地办公成果…");
  }
  if (event.type === "task.log" && event.message) appendTaskLog(task, event.message);
  if (event.type === "task.completed") {
    setTaskStep(task, "generate", "done");
    setTaskStatus(task, "已完成", "done");
    setTaskProgress(task, `完成 · 失败来源 ${event.failedSourceCount}`);
    appendTaskLog(task, "任务完成，成果已保存到本地");
    showTaskArtifacts(task, event.artifacts);
    showToast(`任务「${task.refs.title.textContent}」已完成，可打开成果文件`);
  }
  if (event.type === "task.failed") {
    setTaskStep(task, "generate", "failed");
    setTaskStatus(task, "执行失败", "failed");
    setTaskProgress(task, event.message || "任务失败");
    appendTaskLog(task, event.message || "任务失败");
    showToast(`任务「${task.refs.title.textContent}」执行失败`);
  }
});

loadModelConfig();
updateEmptyState();
