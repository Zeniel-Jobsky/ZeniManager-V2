// Windows NSIS updates use the public GitHub release metadata.
function createUpdates({ app, dialog, updater, platform = process.platform }) {
  let busy = false;
  let downloaded = false;
  let initialized = false;
  const supported = app.isPackaged && platform === "win32";
  const notify = (message, detail = "") => dialog.showMessageBox({
    type: "info", title: "앱 업데이트", message, detail,
  });

  async function installPrompt() {
    const result = await dialog.showMessageBox({
      type: "question", title: "앱 업데이트",
      message: "업데이트를 설치할 준비가 됐습니다.",
      detail: "작성 중인 내용을 저장한 뒤 재시작해 주세요.",
      buttons: ["나중에", "저장 완료 · 재시작"], defaultId: 0, cancelId: 0,
    });
    if (result.response === 1) updater.quitAndInstall(false, true);
  }

  function initialize() {
    if (!supported || initialized) return;
    initialized = true;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    // Errors are surfaced by check(); an error listener also prevents crashes.
    updater.on("error", () => {});
    updater.on("update-downloaded", () => { downloaded = true; });
  }

  async function check(manual = false) {
    if (!supported) {
      if (manual) await notify("설치된 Windows 앱에서 업데이트를 사용할 수 있습니다.");
      return;
    }
    initialize();
    if (busy) {
      if (manual) await notify("업데이트를 확인하거나 다운로드하고 있습니다.");
      return;
    }
    busy = true;
    let interactive = manual;
    try {
      if (downloaded) { await installPrompt(); return; }
      const result = await updater.checkForUpdates();
      if (!result || !result.isUpdateAvailable) {
        if (manual) await notify("현재 최신 버전입니다.", `버전 ${app.getVersion()}`);
        return;
      }
      const answer = await dialog.showMessageBox({
        type: "question", title: "앱 업데이트",
        message: `새 버전 ${result.updateInfo.version}을 사용할 수 있습니다.`,
        detail: "앱에서 업데이트를 다운로드합니다. 설치 전 재시작 여부를 확인합니다.",
        buttons: ["나중에", "업데이트 받기"], defaultId: 1, cancelId: 0,
      });
      if (answer.response !== 1) return;
      interactive = true;
      await updater.downloadUpdate();
      downloaded = true;
      await installPrompt();
    } catch {
      if (interactive) await notify("업데이트를 완료하지 못했습니다.", "인터넷 연결을 확인하고 잠시 후 다시 시도해 주세요.");
    } finally { busy = false; }
  }

  return { check, start() {
    if (!supported) return;
    initialize();
    const timer = setTimeout(() => void check(false), 15000);
    timer.unref?.();
  } };
}

module.exports = { createUpdates };
