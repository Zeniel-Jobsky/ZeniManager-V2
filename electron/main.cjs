/**
 * electron/main.js
 * Electron Main Process for 상담 관리 시스템 (Zeniel)
 *
 * - Dev mode: loads Vite dev server from ELECTRON_RENDERER_URL (default: http://127.0.0.1:5181)
 * - Production: loads built index.html from dist/public
 */
const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  Menu,
  dialog,
} = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const XLSX = require("xlsx");
const isDev = !app.isPackaged;

// electron/main.cjs 최상단 부근에 Supabase 클라이언트 세팅 추가
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_SETTING_KEYS = {
  URL: "counsel_supabase_url",
  ANON_KEY: "counsel_supabase_anon_key",
  SERVICE_ROLE_KEY: "counsel_supabase_service_role_key",
};

let supabaseAdmin = null;
let supabaseAdminUrl = null;
let supabaseAdminKey = null;
let supabaseWrite = null;
let supabaseWriteUrl = null;
let supabaseWriteKey = null;

function getSupabaseAdminClient() {
  const persistedSettings = readAppSettings();
  const supabaseUrl = String(
    persistedSettings[SUPABASE_SETTING_KEYS.URL] || ""
  ).trim();
  const supabaseServiceRoleKey = String(
    persistedSettings[SUPABASE_SETTING_KEYS.SERVICE_ROLE_KEY] || ""
  ).trim();

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return null;
  }

  if (
    supabaseAdmin &&
    supabaseAdminUrl === supabaseUrl &&
    supabaseAdminKey === supabaseServiceRoleKey
  ) {
    return supabaseAdmin;
  }

  try {
    supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    supabaseAdminUrl = supabaseUrl;
    supabaseAdminKey = supabaseServiceRoleKey;
  } catch (error) {
    console.error("Supabase 관리자 클라이언트 초기화 실패:", error);
    supabaseAdmin = null;
    supabaseAdminUrl = null;
    supabaseAdminKey = null;
    return null;
  }

  return supabaseAdmin;
}

function getSupabaseWriteClient() {
  const persistedSettings = readAppSettings();
  const supabaseUrl = String(
    persistedSettings[SUPABASE_SETTING_KEYS.URL] || ""
  ).trim();
  const supabaseServiceRoleKey = String(
    persistedSettings[SUPABASE_SETTING_KEYS.SERVICE_ROLE_KEY] || ""
  ).trim();
  const writeKey = supabaseServiceRoleKey;

  if (!supabaseUrl || !writeKey) {
    return null;
  }

  if (
    supabaseWrite &&
    supabaseWriteUrl === supabaseUrl &&
    supabaseWriteKey === writeKey
  ) {
    return supabaseWrite;
  }

  try {
    supabaseWrite = createClient(supabaseUrl, writeKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    supabaseWriteUrl = supabaseUrl;
    supabaseWriteKey = writeKey;
  } catch (error) {
    console.error("Supabase 저장 클라이언트 초기화 실패:", error);
    supabaseWrite = null;
    supabaseWriteUrl = null;
    supabaseWriteKey = null;
    return null;
  }

  return supabaseWrite;
}

// ─── Keep a global reference to prevent garbage collection ───────────────────
let mainWindow = null;

function getSettingsFilePath() {
  return path.join(app.getPath("userData"), "app-settings.json");
}

function readAppSettings() {
  try {
    const raw = fs.readFileSync(getSettingsFilePath(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAppSettings(settings) {
  fs.writeFileSync(
    getSettingsFilePath(),
    JSON.stringify(settings, null, 2),
    "utf8"
  );
}

function toErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === "object") {
    const message =
      typeof error.message === "string"
        ? error.message
        : typeof error.error_description === "string"
          ? error.error_description
          : typeof error.details === "string"
            ? error.details
            : null;
    if (message) return message;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      ...options,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", chunk => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", chunk => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(stderr || stdout || `${command} exited with code ${code}`)
      );
    });
  });
}

async function tryConvertWithLibreOffice(inputPath, outputDir) {
  const candidates = [
    "soffice",
    "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
    "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
  ];

  for (const candidate of candidates) {
    try {
      await runCommand(candidate, [
        "--headless",
        "--convert-to",
        "pdf",
        "--outdir",
        outputDir,
        inputPath,
      ]);

      const pdfPath = path.join(
        outputDir,
        `${path.basename(inputPath, path.extname(inputPath))}.pdf`
      );
      if (fs.existsSync(pdfPath)) {
        return { pdfPath, method: "libreoffice" };
      }
    } catch {
      // Try the next converter.
    }
  }

  return null;
}

async function tryConvertWithHancom(inputPath, outputDir) {
  const pdfPath = path.join(
    outputDir,
    `${path.basename(inputPath, path.extname(inputPath))}.pdf`
  );

  const script = [
    '$ErrorActionPreference = "Stop"',
    `$inputPath = '${inputPath.replace(/'/g, "''")}'`,
    `$outputPath = '${pdfPath.replace(/'/g, "''")}'`,
    "$hwp = $null",
    "try {",
    "  $hwp = New-Object -ComObject HWPFrame.HwpObject",
    "  try { $null = $hwp.XHwpWindows.Item(0).Visible = $false } catch {}",
    '  try { $hwp.RegisterModule("FilePathCheckDLL", "SecurityModule") | Out-Null } catch {}',
    "  $opened = $hwp.Open($inputPath)",
    '  if (-not $opened) { throw "Failed to open HWP file." }',
    '  $saved = $hwp.SaveAs($outputPath, "PDF")',
    '  if (-not $saved) { throw "Failed to save PDF file." }',
    "} finally {",
    "  if ($hwp) {",
    "    try { $hwp.Quit() } catch {}",
    "  }",
    "}",
  ].join("; ");

  try {
    await runCommand("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
    ]);

    if (fs.existsSync(pdfPath)) {
      return { pdfPath, method: "hancom-office" };
    }
  } catch {
    // Fall back to other converters.
  }

  return null;
}

function getCfbEntry(cfb, entryPath) {
  return XLSX.CFB.find(cfb, entryPath) || XLSX.CFB.find(cfb, `/${entryPath}`);
}

function decodeHwpSectionText(sectionBuffer) {
  const chunks = [];
  let offset = 0;

  while (offset + 4 <= sectionBuffer.length) {
    const header = sectionBuffer.readUInt32LE(offset);
    offset += 4;

    const tagId = header & 0x3ff;
    let size = (header >>> 20) & 0xfff;

    if (size === 0xfff) {
      if (offset + 4 > sectionBuffer.length) break;
      size = sectionBuffer.readUInt32LE(offset);
      offset += 4;
    }

    if (offset + size > sectionBuffer.length) break;

    if (tagId === 67 && size > 0) {
      const text = sectionBuffer
        .subarray(offset, offset + size)
        .toString("utf16le")
        .replace(/[\u0000-\u001f]+/g, " ")
        .trim();

      if (text) chunks.push(text);
    }

    offset += size;
  }

  return chunks.join("\n");
}

function extractHwpTextBuffer(bytes) {
  const buffer = Buffer.from(bytes);
  const cfb = XLSX.CFB.read(buffer, { type: "buffer" });
  const headerEntry = getCfbEntry(cfb, "FileHeader");
  const headerBuffer = headerEntry?.content
    ? Buffer.from(headerEntry.content)
    : null;

  if (!headerBuffer || headerBuffer.length < 40) {
    throw new Error("HWP 파일 헤더를 읽을 수 없습니다.");
  }

  const flags = headerBuffer.readUInt32LE(36);
  const isCompressed = (flags & 0x01) === 0x01;
  const sectionEntries = cfb.FileIndex.filter((entry, index) => {
    const fullPath = cfb.FullPaths[index] || "";
    return /bodytext\/section\d+$/i.test(fullPath);
  });

  const sections = sectionEntries
    .sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { numeric: true })
    )
    .map(entry => {
      const sectionContent = entry.content
        ? Buffer.from(entry.content)
        : Buffer.alloc(0);
      return isCompressed
        ? zlib.inflateRawSync(sectionContent)
        : sectionContent;
    })
    .map(section => decodeHwpSectionText(section))
    .filter(Boolean);

  if (sections.length === 0) {
    throw new Error("HWP 본문에서 읽을 수 있는 텍스트를 찾지 못했습니다.");
  }

  return sections.join("\n\n");
}

async function convertHwpToPdfBuffer(fileName, bytes) {
  const tempRoot = fs.mkdtempSync(path.join(app.getPath("temp"), "zeni-hwp-"));
  const inputPath = path.join(tempRoot, fileName);

  try {
    fs.writeFileSync(inputPath, Buffer.from(bytes));

    const converted =
      (await tryConvertWithHancom(inputPath, tempRoot)) ??
      (await tryConvertWithLibreOffice(inputPath, tempRoot));

    if (!converted) {
      throw new Error(
        "HWP 자동 변환을 실행할 수 없습니다. 한컴오피스 또는 LibreOffice가 설치되어 있는지 확인해 주세요."
      );
    }

    return {
      fileName: `${path.basename(fileName, path.extname(fileName))}.pdf`,
      method: converted.method,
      data: new Uint8Array(fs.readFileSync(converted.pdfPath)),
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

// ─── App metadata ─────────────────────────────────────────────────────────────
const APP_NAME = "상담 관리 시스템";
const APP_VERSION = app.getVersion();

// ─── Create the main BrowserWindow ───────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: APP_NAME,
    // Use the app icon from resources
    icon: path.join(
      __dirname,
      "icons",
      process.platform === "win32" ? "zeniel-logo.ico" : "zeniel-logo.png"
    ),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      // Security best practices
      contextIsolation: true, // Isolate renderer from main process
      nodeIntegration: false, // Disable Node.js in renderer
      sandbox: false, // Allow preload script
      webSecurity: true,
    },
    // Window appearance
    backgroundColor: "#F0EEE9",
    show: false, // Don't show until ready-to-show
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
  });

  // ── Load URL ──────────────────────────────────────────────────────────────
  const devServerUrl =
    process.env.ELECTRON_RENDERER_URL || "http://127.0.0.1:5181";
  const startUrl = isDev
    ? devServerUrl
    : `file://${path.join(__dirname, "..", "dist", "public", "index.html")}`;

  mainWindow.loadURL(startUrl);

  // ── Show when ready (prevents white flash) ────────────────────────────────
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    if (isDev) {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  });

  // ── Handle external links in default browser ──────────────────────────────
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // ── Cleanup on close ──────────────────────────────────────────────────────
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ─── Application Menu ─────────────────────────────────────────────────────────
function buildMenu() {
  const isMac = process.platform === "darwin";

  const template = [
    // macOS App menu
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    // File menu
    {
      label: "파일",
      submenu: [
        {
          label: "설정",
          accelerator: "CmdOrCtrl+,",
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send("navigate", "/settings");
            }
          },
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit", label: "종료" },
      ],
    },
    // Edit menu
    {
      label: "편집",
      submenu: [
        { role: "undo", label: "실행 취소" },
        { role: "redo", label: "다시 실행" },
        { type: "separator" },
        { role: "cut", label: "잘라내기" },
        { role: "copy", label: "복사" },
        { role: "paste", label: "붙여넣기" },
        { role: "selectAll", label: "전체 선택" },
      ],
    },
    // View menu
    {
      label: "보기",
      submenu: [
        { role: "reload", label: "새로고침" },
        { role: "forceReload", label: "강제 새로고침" },
        { type: "separator" },
        { role: "resetZoom", label: "기본 크기" },
        { role: "zoomIn", label: "확대" },
        { role: "zoomOut", label: "축소" },
        { type: "separator" },
        { role: "togglefullscreen", label: "전체 화면" },
        ...(isDev
          ? [
              { type: "separator" },
              { role: "toggleDevTools", label: "개발자 도구" },
            ]
          : []),
      ],
    },
    // Window menu
    {
      label: "창",
      submenu: [
        { role: "minimize", label: "최소화" },
        { role: "zoom", label: "최대화" },
        ...(isMac ? [{ type: "separator" }, { role: "front" }] : []),
      ],
    },
    // Help menu
    {
      label: "도움말",
      submenu: [
        {
          label: `버전 ${APP_VERSION}`,
          enabled: false,
        },
        { type: "separator" },
        {
          label: "제니엘 홈페이지",
          click: () => shell.openExternal("https://www.zeniel.com"),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

// Get app version
ipcMain.handle("app:version", () => APP_VERSION);

// Get app name
ipcMain.handle("app:name", () => APP_NAME);

ipcMain.handle("settings:getAll", () => readAppSettings());

ipcMain.handle("settings:set", (_, { key, value }) => {
  const settings = readAppSettings();
  if (typeof value === "string" && value.length > 0) {
    settings[key] = value;
  } else {
    delete settings[key];
  }
  writeAppSettings(settings);
  return true;
});

ipcMain.handle("settings:remove", (_, key) => {
  const settings = readAppSettings();
  delete settings[key];
  writeAppSettings(settings);
  return true;
});

ipcMain.handle("settings:clear", (_, keys = []) => {
  const settings = readAppSettings();
  for (const key of keys) {
    delete settings[key];
  }
  writeAppSettings(settings);
  return true;
});

// Open file dialog (for future CSV import feature)
ipcMain.handle("dialog:openFile", async (_, options) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: options?.filters || [
      { name: "Excel Files", extensions: ["xlsx", "xls"] },
      { name: "CSV Files", extensions: ["csv"] },
      { name: "All Files", extensions: ["*"] },
    ],
    ...options,
  });
  return result;
});

// Save file dialog (for CSV export)
ipcMain.handle("dialog:saveFile", async (_, options) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: options?.filters || [{ name: "CSV Files", extensions: ["csv"] }],
    ...options,
  });
  return result;
});

// Show message box
ipcMain.handle("dialog:message", async (_, options) => {
  const result = await dialog.showMessageBox(mainWindow, options);
  return result;
});

// Open external URL
ipcMain.handle("shell:openExternal", (_, url) => {
  shell.openExternal(url);
});

// 관리자 권한으로 상담사 등록
ipcMain.handle("document:convertHwpToPdf", async (_, payload) => {
  if (!payload?.fileName || !payload?.data) {
    throw new Error("변환할 HWP 파일 데이터가 없습니다.");
  }

  return convertHwpToPdfBuffer(payload.fileName, payload.data);
});

ipcMain.handle("document:extractHwpText", async (_, payload) => {
  if (!payload?.data) {
    throw new Error("HWP 본문을 추출할 파일 데이터가 없습니다.");
  }

  return {
    text: extractHwpTextBuffer(payload.data),
    method: "hwp-binary",
  };
});

ipcMain.handle("summary-analysis:upload-files", async (_, payload) => {
  try {
    const supabaseWriteClient = getSupabaseWriteClient();
    if (!supabaseWriteClient) {
      throw new Error(
        "Electron 저장에는 Supabase Service Role Key가 필요합니다. Settings에서 Supabase URL과 Service Role Key를 입력해 주세요."
      );
    }

    const clientId = String(payload?.clientId || "").trim();
    const files = Array.isArray(payload?.files) ? payload.files : [];
    if (!clientId || files.length === 0) {
      return [];
    }

    const bucket = "summary-analysis-files";
    const uploadedAt = new Date().toISOString();
    const refs = [];

    for (const file of files) {
      const originalName = String(file.name || "document");
      const extension = path.extname(originalName).replace(/[^A-Za-z0-9.]/g, "");
      const baseName =
        path
          .basename(originalName, extension)
          .replace(/[^A-Za-z0-9._-]/g, "_")
          .replace(/_+/g, "_")
          .replace(/^_+|_+$/g, "")
          .slice(0, 80) || "document";
      const safeName = `${baseName}${extension}`;
      const pathKey = `${clientId}/${Date.now()}-${safeName}`;
      const fileBuffer = Buffer.from(file.data || []);

      const { error } = await supabaseWriteClient.storage
        .from(bucket)
        .upload(pathKey, fileBuffer, {
          upsert: true,
          contentType: file.type || "application/octet-stream",
        });

      if (error) {
        throw error;
      }

      const { data } = supabaseWriteClient.storage
        .from(bucket)
        .getPublicUrl(pathKey);
      refs.push({
        name: originalName,
        path: pathKey,
        url: data.publicUrl,
        uploaded_at: uploadedAt,
      });
    }

    return refs;
  } catch (error) {
    console.error("summary-analysis:upload-files error", error);
    throw new Error(toErrorMessage(error));
  }
});

ipcMain.handle("summary-analysis:save", async (_, payload) => {
  try {
    const supabaseWriteClient = getSupabaseWriteClient();
    if (!supabaseWriteClient) {
      throw new Error(
        "Electron 저장에는 Supabase Service Role Key가 필요합니다. Settings에서 Supabase URL과 Service Role Key를 입력해 주세요."
      );
    }

    const clientId = Number(payload?.clientId);
    if (!Number.isFinite(clientId)) {
      throw new Error("저장할 clientId가 올바르지 않습니다.");
    }

    const savePayload = {
      client_id: clientId,
      updated_at: new Date().toISOString(),
    };

    if (payload?.structuredJson) {
      savePayload.structured_json = payload.structuredJson;
    }
    if (payload?.competencyScoring) {
      savePayload.competency_scoring = payload.competencyScoring;
    }
    if (payload?.recommendation) {
      savePayload.recommendation = payload.recommendation;
    }
    if (payload?.promptSnapshot) {
      savePayload.prompt_snapshot = payload.promptSnapshot;
    }
    if (Array.isArray(payload?.fileRefs) && payload.fileRefs.length > 0) {
      savePayload.file_refs = payload.fileRefs;
    }

    const { error } = await supabaseWriteClient
      .from("client_summary_analysis")
      .upsert(savePayload, { onConflict: "client_id" });

    if (error) {
      throw error;
    }

    return { success: true, mode: "electron-main-upsert" };
  } catch (error) {
    console.error("summary-analysis:save error", error);
    throw new Error(toErrorMessage(error));
  }
});

ipcMain.handle("admin-register-counselor", async (event, payload) => {
  try {
    const { supabaseUrl, serviceRoleKey, email, password, user_name, department } = payload;

    if (!supabaseUrl || !serviceRoleKey) {
      return { success: false, error: "Supabase URL 또는 Service Role Key가 없습니다." };
    }

    const supabaseAdminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Auth: 이메일과 비밀번호로 계정 생성
    const { data: authData, error: authError } =
      await supabaseAdminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // 생성 즉시 이메일 인증 통과 처리
      });

    if (authError) throw authError;

    // 2. DB: 생성된 uid를 사용하여 user 테이블에 정보 삽입
    const { error: dbError } = await supabaseAdminClient.from("user").insert([
      {
        user_id: authData.user.id,
        role: 5,
        user_name,
        department,
      },
    ]);

    if (dbError) throw dbError;

    return { success: true }; // 불필요한 데이터 전송 생략
  } catch (error) {
    console.error("상담사 등록 에러:", error); // 디버깅용 에러 로그는 유지
    return { success: false, error: error.message };
  }
});

// 관리자 권한으로 상담사 완전 삭제
ipcMain.handle("admin-delete-counselor", async (event, payload) => {
  try {
    const { supabaseUrl, serviceRoleKey, userId } = payload;

    if (!supabaseUrl || !serviceRoleKey) {
      return { success: false, error: "Supabase URL 또는 Service Role Key가 없습니다." };
    }

    // 🚨 방어 코드: 프론트엔드나 IPC 브릿지에서 userId가 객체 형태로 잘못 넘어올 경우 강제로 문자열(UUID)만 추출
    let targetId = userId;
    if (typeof userId === 'object' && userId !== null) {
      targetId = userId.userId || userId.user_id || userId.id || String(userId);
    }
    targetId = String(targetId);

    const supabaseAdminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. public.user 테이블에서 프로필 정보 먼저 삭제 (외래키 충돌 방지)
    const { error: dbError } = await supabaseAdminClient
      .from("user")
      .delete()
      .eq("user_id", targetId);

    if (dbError) throw dbError;

    // 2. auth.users 테이블에서 로그인 계정 완전 삭제
    const { error: authError } = await supabaseAdminClient.auth.admin.deleteUser(targetId);

    if (authError) throw authError;

    return { success: true };
  } catch (error) {
    console.error("상담사 삭제 에러:", error);
    return { success: false, error: error.message };
  }
});

// ─── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  buildMenu();
  createWindow();

  // macOS: re-create window when dock icon is clicked
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed (except macOS)
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Security: prevent new window creation
app.on("web-contents-created", (_, contents) => {
  contents.on("will-navigate", (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    // Allow loopback host in dev mode
    if (isDev && (parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1")) return;
    // Allow file:// protocol in production
    if (parsedUrl.protocol === "file:") return;
    // Block all other navigation
    event.preventDefault();
  });
});
