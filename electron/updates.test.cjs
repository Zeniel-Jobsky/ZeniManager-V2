const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createUpdates } = require("./updates.cjs");

function fixture(responses = [], available = true) {
  const updater = new EventEmitter();
  let downloads = 0, installs = 0;
  updater.checkForUpdates = async () => ({ isUpdateAvailable: available, updateInfo: { version: "1.0.2" } });
  updater.downloadUpdate = async () => { downloads++; updater.emit("update-downloaded"); };
  updater.quitAndInstall = () => { installs++; };
  const messages = [];
  const dialog = { showMessageBox: async options => { messages.push(options); return { response: responses.shift() ?? 0 }; } };
  const updates = createUpdates({ app: { isPackaged: true, getVersion: () => "1.0.1" }, dialog, updater, platform: "win32" });
  return { updater, updates, messages, counts: () => ({ downloads, installs }) };
}

test("download consent and explicit restart consent are separate", async () => {
  const f = fixture([1, 0, 1]);
  await f.updates.check(true);
  assert.deepEqual(f.counts(), { downloads: 1, installs: 0 });
  assert.equal(f.updater.autoInstallOnAppQuit, false);
  await f.updates.check(true);
  assert.deepEqual(f.counts(), { downloads: 1, installs: 1 });
});
test("later does not download or install", async () => {
  const f = fixture([0]); await f.updates.check(true);
  assert.deepEqual(f.counts(), { downloads: 0, installs: 0 });
});
test("latest version and network failure leave app running", async () => {
  const f = fixture([], false); await f.updates.check(true);
  assert.match(f.messages[0].message, /최신/);
  f.updater.checkForUpdates = async () => { throw new Error("network"); };
  await f.updates.check(true);
  assert.match(f.messages[1].message, /완료하지/);
});
test("simultaneous requests do not start duplicate downloads", async () => {
  const f = fixture([1, 0]);
  await Promise.all([f.updates.check(false), f.updates.check(false)]);
  assert.equal(f.counts().downloads, 1);
});
test("startup download failure after consent shows an error", async () => {
  const f = fixture([1]);
  f.updater.downloadUpdate = async () => { throw new Error("download failed"); };
  await f.updates.check(false);
  assert.match(f.messages[1].message, /완료하지/);
  assert.equal(f.counts().installs, 0);
});
