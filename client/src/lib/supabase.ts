/**
 * supabase.ts
 * 
 * SECURITY: No API keys are hardcoded here.
 * All credentials are read at runtime from localStorage (set by user in Settings).
 * This file is safe to commit to a public GitHub repository.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { AppRole } from '@shared/const';
import { COUNSEL_SESSION_EXPIRED_MESSAGE } from './authAccess';

export const STORAGE_KEYS = {
  SUPABASE_URL: 'counsel_supabase_url',
  SUPABASE_ANON_KEY: 'counsel_supabase_anon_key',
  SUPABASE_SERVICE_ROLE_KEY: 'counsel_supabase_service_role_key',
  OPENAI_API_KEY: 'counsel_openai_api_key',
  USER: 'counsel_user',
} as const;

export const SUPABASE_SESSION_STORAGE_KEY = 'counsel_sb_session';
export const SUPABASE_REQUEST_TIMEOUT_MS = 8000;
const APP_SETTING_KEYS = [
  STORAGE_KEYS.SUPABASE_URL,
  STORAGE_KEYS.SUPABASE_ANON_KEY,
  STORAGE_KEYS.SUPABASE_SERVICE_ROLE_KEY,
  STORAGE_KEYS.OPENAI_API_KEY,
] as const;

type SupabaseRequestResult<T> = {
  data: T | null;
  error: unknown;
  status?: number | null;
  statusText?: string;
  count?: number | null;
};

type SupabaseAuthFailureListener = (error: Error) => void;

const supabaseAuthFailureListeners = new Set<SupabaseAuthFailureListener>();
let lastSupabaseAuthFailureAt = 0;

function getWindowIfAvailable() {
  return typeof window === 'undefined' ? null : window;
}

function getLocalStorage() {
  if (typeof localStorage !== 'undefined') {
    return localStorage;
  }

  return getWindowIfAvailable()?.localStorage;
}

function getSessionStorage() {
  if (typeof sessionStorage !== 'undefined') {
    return sessionStorage;
  }

  return getWindowIfAvailable()?.sessionStorage;
}

function removeStorageItem(storage: Storage | null | undefined, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Ignore storage cleanup failures and continue clearing the remaining state.
  }
}

function getElectronApi() {
  return getWindowIfAvailable()?.electronAPI;
}

function isUnauthorizedStatus(status: number | null | undefined): boolean {
  return status === 401;
}

function isUnauthorizedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const maybeError = error as {
    status?: number;
    code?: string;
    message?: string;
  };

  if (isUnauthorizedStatus(maybeError.status)) {
    return true;
  }

  if (maybeError.code === 'PGRST301') {
    return true;
  }

  const message = maybeError.message?.toLowerCase() ?? '';
  return message.includes('jwt') || message.includes('unauthorized');
}

function createSupabaseTimeoutError(operationLabel: string, timeoutMs: number): Error {
  const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const error = new Error(
    `${operationLabel} 요청이 ${timeoutSeconds}초 안에 끝나지 않았습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.`,
  );
  error.name = 'SupabaseRequestTimeoutError';
  return error;
}

export function createSupabaseSessionExpiredError(
  message = COUNSEL_SESSION_EXPIRED_MESSAGE,
): Error {
  const error = new Error(message);
  error.name = 'SupabaseSessionExpiredError';
  return error;
}

export function isSupabaseSessionExpiredError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'SupabaseSessionExpiredError';
}

export function subscribeSupabaseAuthFailure(listener: SupabaseAuthFailureListener): () => void {
  supabaseAuthFailureListeners.add(listener);
  return () => {
    supabaseAuthFailureListeners.delete(listener);
  };
}

export function notifySupabaseAuthFailure(error: Error): void {
  const now = Date.now();
  if (now - lastSupabaseAuthFailureAt < 1000) {
    return;
  }

  lastSupabaseAuthFailureAt = now;
  supabaseAuthFailureListeners.forEach(listener => {
    try {
      listener(error);
    } catch {
      // Ignore listener failures so one bad consumer does not block auth recovery.
    }
  });
}

export async function executeSupabaseRequest<T>(
  operationLabel: string,
  request: PromiseLike<SupabaseRequestResult<T>>,
  options?: {
    timeoutMs?: number;
    authFailureMessage?: string;
    requireStoredSession?: boolean;
  },
): Promise<SupabaseRequestResult<T>> {
  const timeoutMs = options?.timeoutMs ?? SUPABASE_REQUEST_TIMEOUT_MS;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    if (options?.requireStoredSession && !hasStoredSupabaseSession()) {
      const authError = createSupabaseSessionExpiredError(options.authFailureMessage);
      notifySupabaseAuthFailure(authError);
      throw authError;
    }

    const result = await Promise.race([
      Promise.resolve(request),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(createSupabaseTimeoutError(operationLabel, timeoutMs));
        }, timeoutMs);
      }),
    ]);

    if (isUnauthorizedStatus(result.status) || isUnauthorizedError(result.error)) {
      const authError = createSupabaseSessionExpiredError(options?.authFailureMessage);
      notifySupabaseAuthFailure(authError);
      throw authError;
    }

    return result;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

/** Returns the Supabase URL stored by the user in Settings, or null if not set. */
export function getSupabaseUrl(): string | null {
  return localStorage.getItem(STORAGE_KEYS.SUPABASE_URL) || (import.meta.env.VITE_SUPABASE_URL as string) || null;
}

/** Returns the Supabase anon key stored by the user in Settings, or null if not set. */
export function getSupabaseAnonKey(): string | null {
  return localStorage.getItem(STORAGE_KEYS.SUPABASE_ANON_KEY) || (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || null;
}

/** Returns the Supabase service role key stored by the user in Settings, or null if not set. */
export function getSupabaseServiceRoleKey(): string | null {
  return localStorage.getItem(STORAGE_KEYS.SUPABASE_SERVICE_ROLE_KEY) || (import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY as string) || null;
}

/** Returns the OpenAI API key stored by the user in Settings, or null if not set. */
export function getOpenAIKey(): string | null {
  return localStorage.getItem(STORAGE_KEYS.OPENAI_API_KEY) || null;
}

/** Returns true if both Supabase URL and anon key are configured. */
export function isSupabaseConfigured(): boolean {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();
  return !!(url && key && url.startsWith('https://') && key.length > 20);
}

let _client: SupabaseClient | null = null;
let _clientUrl: string | null = null;
let _clientKey: string | null = null;

/**
 * Returns a Supabase client using the credentials stored in localStorage.
 * Returns null if credentials are not configured.
 * The client is cached and re-created only when credentials change.
 */
export function getSupabaseClient(): SupabaseClient | null {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();
  const storage = getLocalStorage() ?? getSessionStorage();

  if (!url || !key || !storage) return null;

  // Re-create client if credentials changed
  if (_client && _clientUrl === url && _clientKey === key) {
    return _client;
  }

  try {
    _client = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: SUPABASE_SESSION_STORAGE_KEY,
        storage,
      },
    });
    _clientUrl = url;
    _clientKey = key;
    return _client;
  } catch {
    return null;
  }
}

export function getCachedSupabaseClient(): SupabaseClient | null {
  return _client;
}

/** Clears the cached Supabase client (call after credentials change). */
export function resetSupabaseClient(): void {
  _client = null;
  _clientUrl = null;
  _clientKey = null;
}

export function clearStoredSupabaseSession(): void {
  removeStorageItem(getSessionStorage(), SUPABASE_SESSION_STORAGE_KEY);
  removeStorageItem(getLocalStorage(), SUPABASE_SESSION_STORAGE_KEY);
}

export function hasStoredSupabaseSession(): boolean {
  return Boolean(
    getSessionStorage()?.getItem(SUPABASE_SESSION_STORAGE_KEY)
    || getLocalStorage()?.getItem(SUPABASE_SESSION_STORAGE_KEY),
  );
}

export function clearStoredAuthState(): void {
  removeStorageItem(getLocalStorage(), STORAGE_KEYS.USER);
  clearStoredSupabaseSession();
}

export async function bootstrapStoredAppSettings(): Promise<void> {
  const electronAPI = getElectronApi();
  if (!electronAPI?.getAppSettings) return;

  try {
    const persisted = await electronAPI.getAppSettings();
    for (const key of APP_SETTING_KEYS) {
      const value = persisted[key];
      if (typeof value === 'string' && value.length > 0) {
        localStorage.setItem(key, value);
      }
    }
    resetSupabaseClient();
  } catch {
    // Ignore native storage bootstrap failures and fall back to localStorage only.
  }
}

/**
 * Clears transient auth/session state on Electron launch.
 * Persistent app settings remain in the shared app-settings store and are
 * bootstrapped back into localStorage afterwards.
 */
export function resetTransientSessionOnLaunch(): void {
  const electronAPI = getElectronApi();
  if (!electronAPI?.isElectron) return;

  clearStoredAuthState();
  resetSupabaseClient();
}

export async function setStoredAppSetting(key: string, value: string): Promise<void> {
  const trimmed = value.trim();
  if (trimmed) {
    localStorage.setItem(key, trimmed);
  } else {
    localStorage.removeItem(key);
  }

  const electronAPI = getElectronApi();
  if (!electronAPI?.setAppSetting) return;

  if (trimmed) {
    await electronAPI.setAppSetting(key, trimmed);
  } else {
    await electronAPI.removeAppSetting(key);
  }
}

export async function removeStoredAppSetting(key: string): Promise<void> {
  localStorage.removeItem(key);
  const electronAPI = getElectronApi();
  if (electronAPI?.removeAppSetting) {
    await electronAPI.removeAppSetting(key);
  }
}

/** Clears locally stored app settings and cached auth/session state. */
export async function resetStoredAppSettings(): Promise<void> {
  [
    STORAGE_KEYS.SUPABASE_URL,
    STORAGE_KEYS.SUPABASE_ANON_KEY,
    STORAGE_KEYS.SUPABASE_SERVICE_ROLE_KEY,
    STORAGE_KEYS.OPENAI_API_KEY,
  ].forEach(key => removeStorageItem(getLocalStorage(), key));

  clearStoredAuthState();

  const electronAPI = getElectronApi();
  if (electronAPI?.clearAppSettings) {
    await electronAPI.clearAppSettings([...APP_SETTING_KEYS]);
  }

  resetSupabaseClient();
}

export type Database = {
  public: {
    Tables: {
      clients: { Row: ClientRow; Insert: ClientInsert; Update: Partial<ClientInsert> };
      sessions: { Row: SessionRow; Insert: SessionInsert; Update: Partial<SessionInsert> };
      counselors: { Row: CounselorRow; Insert: CounselorInsert; Update: Partial<CounselorInsert> };
      survey_responses: { Row: SurveyRow; Insert: SurveyInsert; Update: Partial<SurveyInsert> };
      memo_cards: { Row: MemoCardRow; Insert: MemoCardInsert; Update: Partial<MemoCardInsert> };
      client_chat_history: {
        Row: ClientChatHistoryRow;
        Insert: Partial<ClientChatHistoryRow> & { client_id: number };
        Update: Partial<ClientChatHistoryRow>;
      };
    };
  };
};

// ─── Row types matching the Supabase schema ───────────────────────────────────

export interface ClientRow {
  id: string; // 기존 호환용
  client_id?: number; // DB 실제
  seq_no?: number | null;
  year?: number | null;
  assignment_type: string | null;
  name: string; // 기존 호환용
  client_name?: string; // DB 실제
  resident_id: string | null;
  resident_id_masked?: string | null;
  phone?: string | null;
  phone_encrypted?: string | null;
  last_counsel_date?: string | null;
  age: number | null;
  gender?: '남' | '여' | null;
  gender_code?: string | null;
  birth_date: string | null;
  email: string | null;
  MBTI: string | null;
  certifications?: string | null;
  certificates?: { certificate_name: string; acquisition_date: string | null }[];
  future_card_stat: number | null;
  business_type?: string | null;
  business_type_code: number | null;
  participation_type: string | null;
  participation_stage: string | null;
  capa: string | null;
  recognition_date?: string | null;
  notificate_date: string | null;
  desired_job?: string | null;
  desired_job_1: string | null;
  desired_job_2: string | null;
  desired_job_3: string | null;
  desired_area_1: string | null;
  desired_area_2: string | null;
  desired_area_3: string | null;
  desired_payment: number | null;
  has_car: boolean | null;
  is_working_parttime: boolean | null;
  can_drive: boolean | null;
  counsel_notes?: string | null;
  address?: string | null;
  address_1: string | null;
  address_2: string | null;
  school_name: string | null;
  major: string | null;
  education_level: string | null;
  initial_counsel_date?: string | null;
  iap_date?: string | null;
  iap_duration?: string | null;
  allowance_apply_date?: string | null;
  rediagnosis_date?: string | null;
  rediagnosis_yn?: string | null;
  work_exp_type?: string | null;
  work_exp_intent?: string | null;
  work_exp_company?: string | null;
  work_exp_period?: string | null;
  work_exp_completed?: string | null;
  training_name?: string | null;
  training_start?: string | null;
  training_end?: string | null;
  training_allowance?: string | null;
  intensive_start?: string | null;
  intensive_end?: string | null;
  support_end_date?: string | null;
  employment_duration?: string | null;
  employment_type: string | null; // 취업유형 (본인 등)
  counselor_name?: string | null;
  counselor_id: string | null;
  branch?: string | null;
  follow_up?: boolean;
  score?: number | null;
  participate_type?: string | null;
  
  // 실제 DB 스키마 속성들
  iap_todate: number | null;
  iap_to: string | null;
  retest_stat: number | null;
  retest_date: string | null;
  work_ex_type: number | null;
  work_ex_desire: number | null;
  work_ex_history: string | null;
  work_ex_company: string | null;
  work_ex_start: string | null;
  work_ex_end: string | null;
  work_ex_graduate: number | null;
  job_place_start: string | null;
  job_place_end: string | null;
  job_place_support_end: string | null;
  hire_type: string | null;
  hire_place: string | null;
  hire_job_type: string | null;
  hire_payment: string | null;
  retirement_date: string | null;
  continue_serv_1_date: string | null;
  continue_serv_1_stat: number | null;
  continue_serv_6_date: string | null;
  continue_serv_6_stat: number | null;
  continue_serv_12_date: string | null;
  continue_serv_12_stat: number | null;
  continue_serv_18_date: string | number | null; 
  continue_serv_18_stat: number | null;
  created_at: string;
  update_at: string | null;
  memo: string | null;
}


export type ClientInsert = Omit<ClientRow, 'id' | 'client_id' | 'created_at' | 'update_at'> & {
  id?: string;
};

export interface SessionRow {
  id: string;
  client_id: string;
  date: string;
  type: string; // 초기상담/심층상담/취업지원/사후관리
  content: string | null;
  counselor_name: string | null;
  counselor_id: string | null;
  next_action: string | null;
  session_number: number | null;
  start_time?: string | null;
  end_time?: string | null;
  document_link?: string | null;
  economic_situation?: number | null;
  social_situation_family?: number | null;
  social_situation_society?: number | null;
  self_esteem?: number | null;
  self_efficacy?: number | null;
  holland_code?: string | null;
  career_fluidity?: number | null;
  info_gathering?: number | null;
  personality_test_result?: string | null;
  life_history_result?: string | null;
  profiling_grade?: string | null;
  memo?: string | null;
  created_at: string;
}

export type SessionInsert = Omit<SessionRow, 'id' | 'created_at' | 'session_number'> & { id?: string; session_number?: number | null };

// DB 스키마: public.user 테이블 기준
export interface CounselorRow {
  user_id: string;       // PK (uuid)
  user_name: string;
  department: string;
  memo: string | null;           // 상담사 개인 메모 (Notepad)
  role: AppRole | null;   // integer in DB — mapped via AppRole
  // 클라이언트 계산 필드 (집계용)
  client_count: number;
  completed_count: number;
  // UI 매핑용 (manager_memo 테이블에서 가져옴)
  memo_bymanager?: string | null; 
}

export interface ManagerMemoRow {
  id?: number | string;
  manager_id: string;   // 작성한 매니저 ID
  counselor_id: string; // 대상 상담사 ID
  memo: string | null;
  created_at?: string;
}

export type CounselorInsert = Omit<CounselorRow, 'client_count' | 'completed_count' | 'user_id'> & {
  user_id?: string;
};

export interface SurveyRow {
  survey_id: string;
  client_id: string;
  survey_date: string;
  survey_1: number | null;
  survey_2: number | null;
  survey_3: number | null;
  survey_4: number | null;
  survey_5: number | null;
  survey_6: number | null;
  survey_7: number | null;
  survey_8: number | null;
  survey_7_memo: string | null;
  total_score: number | null;
  created_at: string;
}

export type SurveyInsert = Partial<SurveyRow> & { client_id: string; survey_date: string };

export interface MemoCardRow {
  id: string;
  counselor_id: string;
  column_id: string; // todo / inprogress / done
  title: string;
  content: string | null;
  priority: 'high' | 'medium' | 'low';
  due_date: string | null;
  client_name: string | null;
  sort_order: number;
  created_at: string;
  update_at: string;
}

export type MemoCardInsert = Omit<MemoCardRow, 'id' | 'created_at' | 'update_at'> & { id?: string };

export interface ClientChatHistoryRow {
  client_id: number;
  messages: { role: 'user' | 'assistant'; content: string }[];
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}
