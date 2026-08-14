/**
 * useElectron.ts
 * React hook for Electron IPC integration.
 * Safely detects if running inside Electron and exposes IPC APIs.
 * Falls back gracefully in web browser context.
 */

// 🚨 상담사 등록 시 사용할 데이터 타입에 키 추가
export interface CounselorRegisterData {
  supabaseUrl: string;
  serviceRoleKey: string;
  email: string;
  password?: string;
  user_name: string;
  department: string;
}

// 🚨 상담사 삭제 시 사용할 데이터 타입 정의 추가
export interface CounselorDeleteData {
  supabaseUrl: string;
  serviceRoleKey: string;
  userId: string;
}

// Extend Window interface for Electron API
declare global {
  interface Window {
    electronAPI?: {
      getVersion: () => Promise<string>;
      getAppName: () => Promise<string>;
      getAppSettings: () => Promise<Record<string, string>>;
      setAppSetting: (key: string, value: string) => Promise<void>;
      removeAppSetting: (key: string) => Promise<void>;
      clearAppSettings: (keys: string[]) => Promise<void>;
      openFileDialog: (options?: {
        filters?: { name: string; extensions: string[] }[];
        title?: string;
      }) => Promise<{ canceled: boolean; filePaths: string[] }>;
      saveFileDialog: (options?: {
        filters?: { name: string; extensions: string[] }[];
        defaultPath?: string;
        title?: string;
      }) => Promise<{ canceled: boolean; filePath?: string }>;
      showMessage: (options: {
        type?: "none" | "info" | "error" | "question" | "warning";
        title?: string;
        message: string;
        detail?: string;
        buttons?: string[];
      }) => Promise<{ response: number }>;
      openExternal: (url: string) => Promise<void>;
      convertHwpToPdf: (payload: {
        fileName: string;
        data: Uint8Array;
      }) => Promise<{
        fileName: string;
        method: string;
        data: Uint8Array;
      }>;
      extractHwpText: (payload: {
        fileName: string;
        data: Uint8Array;
      }) => Promise<{
        text: string;
        method: string;
      }>;
      saveSummaryAnalysis: (payload: {
        clientId: string;
        structuredJson?: unknown;
        competencyScoring?: unknown;
        recommendation?: unknown;
        promptSnapshot?: Record<string, unknown>;
        fileRefs?: Array<{
          name: string;
          path: string;
          url: string;
          uploaded_at: string;
        }>;
      }) => Promise<{ success: boolean; mode?: string; error?: string }>;
      uploadSummaryAnalysisFiles: (payload: {
        clientId: string;
        files: Array<{
          name: string;
          type: string;
          data: Uint8Array;
        }>;
      }) => Promise<
        Array<{
          name: string;
          path: string;
          url: string;
          uploaded_at: string;
        }>
      >;
      onNavigate: (callback: (path: string) => void) => () => void;
      platform: string;
      isElectron: boolean;
      // 상담사 등록 API
      adminRegisterCounselor: (
        data: CounselorRegisterData
      ) => Promise<{ success: boolean; error?: string }>;
      // 🚨 상담사 삭제 API (string 대신 객체를 받도록 수정됨)
      adminDeleteCounselor: (
        data: CounselorDeleteData
      ) => Promise<{ success: boolean; error?: string }>;
    };
  }
}

export function useElectron() {
  const isElectron =
    typeof window !== "undefined" && !!window.electronAPI?.isElectron;
  const api = window.electronAPI;

  return {
    /** Whether the app is running inside Electron */
    isElectron,

    /** Current platform: 'win32' | 'darwin' | 'linux' | 'web' */
    platform: isElectron ? (api?.platform ?? "web") : "web",

    /** Open a native file picker dialog */
    openFileDialog: isElectron
      ? api!.openFileDialog
      : async () => ({ canceled: true, filePaths: [] }),

    /** Read app settings shared across Electron dev/prod origins */
    getAppSettings: isElectron ? api!.getAppSettings : async () => ({}),

    /** Persist an app setting outside origin-scoped localStorage */
    setAppSetting: isElectron ? api!.setAppSetting : async () => {},

    /** Remove one persisted app setting */
    removeAppSetting: isElectron ? api!.removeAppSetting : async () => {},

    /** Clear persisted app settings */
    clearAppSettings: isElectron ? api!.clearAppSettings : async () => {},

    /** Open a native save dialog */
    saveFileDialog: isElectron
      ? api!.saveFileDialog
      : async () => ({ canceled: true, filePath: undefined }),

    /** Show a native message box */
    showMessage: isElectron
      ? api!.showMessage
      : async (opts: { message: string }) => {
          alert(opts.message);
          return { response: 0 };
        },

    /** Open URL in default browser */
    openExternal: isElectron
      ? api!.openExternal
      : async (url: string) => {
          window.open(url, "_blank");
        },

    /** Convert HWP to PDF through the Electron main process */
    convertHwpToPdf: isElectron
      ? api!.convertHwpToPdf
      : async () => {
          throw new Error(
            "HWP 자동 변환은 데스크톱 앱에서만 사용할 수 있습니다."
          );
        },
    extractHwpText: isElectron
      ? api!.extractHwpText
      : async () => {
          throw new Error(
            "HWP 본문 추출은 데스크톱 앱에서만 사용할 수 있습니다."
          );
        },

    /** Listen for navigation events from the main process menu */
    onNavigate: isElectron
      ? api!.onNavigate
      : (_cb: (path: string) => void) => () => {},

    /** Register a new counselor using Admin privileges (Electron Only) */
    adminRegisterCounselor: isElectron
      ? api!.adminRegisterCounselor
      : async () => ({
          success: false,
          error: "데스크톱 앱(관리자 모드)에서만 지원되는 기능입니다.",
        }),

    /** Delete a counselor using Admin privileges (Electron Only) */
    adminDeleteCounselor: isElectron
      ? api!.adminDeleteCounselor
      : async () => ({
          success: false,
          error: "데스크톱 앱(관리자 모드)에서만 지원되는 기능입니다.",
        }),
  };
}