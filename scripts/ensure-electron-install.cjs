const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function getElectronDir() {
  const electronPackageJson = require.resolve("electron/package.json");
  return path.dirname(electronPackageJson);
}

function getInstalledBinaryPath(electronDir) {
  const markerPath = path.join(electronDir, "path.txt");
  if (!fs.existsSync(markerPath)) {
    return null;
  }

  const relativeBinaryPath = fs.readFileSync(markerPath, "utf8").trim();
  if (!relativeBinaryPath) {
    return null;
  }

  const absoluteBinaryPath = path.join(electronDir, "dist", relativeBinaryPath);
  return fs.existsSync(absoluteBinaryPath) ? absoluteBinaryPath : null;
}

function ensureElectronInstall() {
  const electronDir = getElectronDir();
  const installedBinaryPath = getInstalledBinaryPath(electronDir);

  if (installedBinaryPath) {
    console.log(`[electron] binary already installed: ${installedBinaryPath}`);
    return;
  }

  const installScript = path.join(electronDir, "install.js");
  if (!fs.existsSync(installScript)) {
    throw new Error(`Electron install script not found: ${installScript}`);
  }

  console.log("[electron] missing binary metadata, running Electron installer...");

  const result = spawnSync(process.execPath, [installScript], {
    cwd: electronDir,
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error(`Electron installer exited with status ${result.status ?? "unknown"}`);
  }

  const repairedBinaryPath = getInstalledBinaryPath(electronDir);
  if (!repairedBinaryPath) {
    throw new Error("Electron install completed, but binary metadata is still missing.");
  }

  console.log(`[electron] binary installed: ${repairedBinaryPath}`);
}

try {
  ensureElectronInstall();
} catch (error) {
  console.error(`[electron] ${error.message}`);
  process.exit(1);
}
