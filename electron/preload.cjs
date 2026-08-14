/**
 * electron/preload.js
 * Preload script — runs in renderer context with access to Node.js APIs
 * Exposes a safe, limited API to the renderer via contextBridge
 */

const { contextBridge, ipcRenderer } = require("electron");

// ─── Expose safe APIs to the renderer process ─────────────────────────────────
contextBridge.exposeInMainWorld("electronAPI", {
  // ── App info ──────────────────────────────────────────────────────────────
  getVersion: () => ipcRenderer.invoke("app:version"),
  getAppName: () => ipcRenderer.invoke("app:name"),
  getAppSettings: () => ipcRenderer.invoke("settings:getAll"),
  setAppSetting: (key, value) =>
    ipcRenderer.invoke("settings:set", { key, value }),
  removeAppSetting: key => ipcRenderer.invoke("settings:remove", key),
  clearAppSettings: keys => ipcRenderer.invoke("settings:clear", keys),

  // ── File dialogs ──────────────────────────────────────────────────────────
  openFileDialog: options => ipcRenderer.invoke("dialog:openFile", options),
  saveFileDialog: options => ipcRenderer.invoke("dialog:saveFile", options),
  showMessage: options => ipcRenderer.invoke("dialog:message", options),

  // ── Shell ─────────────────────────────────────────────────────────────────
  openExternal: url => ipcRenderer.invoke("shell:openExternal", url),

  // 상담사 등록 API
  adminRegisterCounselor: data =>
    ipcRenderer.invoke("admin-register-counselor", data),

  // 상담사 삭제 API
  adminDeleteCounselor: userId =>
    ipcRenderer.invoke("admin-delete-counselor", userId),
  convertHwpToPdf: payload =>
    ipcRenderer.invoke("document:convertHwpToPdf", payload),
  extractHwpText: payload =>
    ipcRenderer.invoke("document:extractHwpText", payload),
  saveSummaryAnalysis: payload =>
    ipcRenderer.invoke("summary-analysis:save", payload),
  uploadSummaryAnalysisFiles: payload =>
    ipcRenderer.invoke("summary-analysis:upload-files", payload),

  // ── Navigation from main process (e.g., menu items) ──────────────────────
  onNavigate: callback => {
    ipcRenderer.on("navigate", (_event, path) => callback(path));
    // Return cleanup function
    return () => ipcRenderer.removeAllListeners("navigate");
  },

  // ── Platform detection ────────────────────────────────────────────────────
  platform: process.platform,
  isElectron: true,
});
