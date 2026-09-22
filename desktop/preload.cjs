const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("officeAgent", {
  discoverSources: (prompt) => ipcRenderer.invoke("sources:discover", prompt),
  getLlmConfig: () => ipcRenderer.invoke("llm:get-config"),
  saveLlmConfig: (config) => ipcRenderer.invoke("llm:save-config", config),
  testLlmConfig: () => ipcRenderer.invoke("llm:test-config"),
  startTask: (request) => ipcRenderer.invoke("task:start", request),
  openArtifact: (targetPath) => ipcRenderer.invoke("artifact:open", targetPath),
  onTaskEvent: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("task:event", handler);
    return () => ipcRenderer.removeListener("task:event", handler);
  }
});
