import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bootstrapStoredAppSettings,
  clearStoredAuthState,
  clearStoredSupabaseSession,
  executeSupabaseRequest,
  resetTransientSessionOnLaunch,
  STORAGE_KEYS,
  subscribeSupabaseAuthFailure,
  SUPABASE_SESSION_STORAGE_KEY,
} from './supabase';

function createMemoryStorage(seed: Record<string, string> = {}): Storage {
  const entries = new Map(Object.entries(seed));

  return {
    get length() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
    getItem(key: string) {
      return entries.has(key) ? entries.get(key)! : null;
    },
    key(index: number) {
      return Array.from(entries.keys())[index] ?? null;
    },
    removeItem(key: string) {
      entries.delete(key);
    },
    setItem(key: string, value: string) {
      entries.set(key, String(value));
    },
  };
}

const originalWindow = (globalThis as { window?: Window }).window;
const originalLocalStorage = (globalThis as { localStorage?: Storage }).localStorage;
const originalSessionStorage = (globalThis as { sessionStorage?: Storage }).sessionStorage;

function setGlobalProperty(name: 'window' | 'localStorage' | 'sessionStorage', value: unknown) {
  if (typeof value === 'undefined') {
    delete (globalThis as Record<string, unknown>)[name];
    return;
  }

  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true,
  });
}

function installWindow(options?: {
  localStorageSeed?: Record<string, string>;
  sessionStorageSeed?: Record<string, string>;
  electronAPI?: Record<string, unknown>;
}) {
  const nextLocalStorage = createMemoryStorage(options?.localStorageSeed);
  const nextSessionStorage = createMemoryStorage(options?.sessionStorageSeed);
  const nextWindow = {
    localStorage: nextLocalStorage,
    sessionStorage: nextSessionStorage,
    electronAPI: options?.electronAPI,
  } as Window & { electronAPI?: Record<string, unknown> };

  setGlobalProperty('window', nextWindow);
  setGlobalProperty('localStorage', nextLocalStorage);
  setGlobalProperty('sessionStorage', nextSessionStorage);

  return nextWindow;
}

describe('supabase storage helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    setGlobalProperty('window', originalWindow);
    setGlobalProperty('localStorage', originalLocalStorage);
    setGlobalProperty('sessionStorage', originalSessionStorage);
  });

  it('clears stale Supabase session tokens from both browser storages', () => {
    installWindow({
      localStorageSeed: {
        [SUPABASE_SESSION_STORAGE_KEY]: 'stale-local-token',
      },
      sessionStorageSeed: {
        [SUPABASE_SESSION_STORAGE_KEY]: 'stale-session-token',
      },
    });

    clearStoredSupabaseSession();

    expect(sessionStorage.getItem(SUPABASE_SESSION_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(SUPABASE_SESSION_STORAGE_KEY)).toBeNull();
  });

  it('clears runtime auth state on Electron launch without deleting saved settings', () => {
    installWindow({
      localStorageSeed: {
        [STORAGE_KEYS.SUPABASE_URL]: 'https://example.supabase.co',
        [STORAGE_KEYS.USER]: '{"id":"user-1"}',
        [SUPABASE_SESSION_STORAGE_KEY]: 'stale-local-token',
      },
      sessionStorageSeed: {
        [SUPABASE_SESSION_STORAGE_KEY]: 'stale-session-token',
      },
      electronAPI: {
        isElectron: true,
      },
    });

    resetTransientSessionOnLaunch();

    expect(localStorage.getItem(STORAGE_KEYS.SUPABASE_URL)).toBe('https://example.supabase.co');
    expect(localStorage.getItem(STORAGE_KEYS.USER)).toBeNull();
    expect(localStorage.getItem(SUPABASE_SESSION_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(SUPABASE_SESSION_STORAGE_KEY)).toBeNull();
  });

  it('hydrates persisted Electron settings into localStorage before the app uses them', async () => {
    const getAppSettings = vi.fn().mockResolvedValue({
      [STORAGE_KEYS.SUPABASE_URL]: 'https://example.supabase.co',
      [STORAGE_KEYS.SUPABASE_ANON_KEY]: 'persisted-anon-key',
      [STORAGE_KEYS.OPENAI_API_KEY]: '',
    });

    installWindow({
      electronAPI: {
        getAppSettings,
      },
    });

    await bootstrapStoredAppSettings();

    expect(getAppSettings).toHaveBeenCalledOnce();
    expect(localStorage.getItem(STORAGE_KEYS.SUPABASE_URL)).toBe('https://example.supabase.co');
    expect(localStorage.getItem(STORAGE_KEYS.SUPABASE_ANON_KEY)).toBe('persisted-anon-key');
    expect(localStorage.getItem(STORAGE_KEYS.OPENAI_API_KEY)).toBeNull();
  });

  it('clears the stored user profile together with the cached auth session', () => {
    installWindow({
      localStorageSeed: {
        [STORAGE_KEYS.USER]: '{"id":"user-1"}',
        [SUPABASE_SESSION_STORAGE_KEY]: 'stale-local-token',
      },
      sessionStorageSeed: {
        [SUPABASE_SESSION_STORAGE_KEY]: 'stale-session-token',
      },
    });

    clearStoredAuthState();

    expect(localStorage.getItem(STORAGE_KEYS.USER)).toBeNull();
    expect(localStorage.getItem(SUPABASE_SESSION_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(SUPABASE_SESSION_STORAGE_KEY)).toBeNull();
  });

  it('turns unauthorized Supabase responses into a session-expired error and notifies listeners', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSupabaseAuthFailure(listener);

    await expect(executeSupabaseRequest('상담사 목록 조회', Promise.resolve({
      data: null,
      error: { message: 'Unauthorized' },
      status: 401,
    }))).rejects.toMatchObject({
      name: 'SupabaseSessionExpiredError',
      message: '세션이 만료되었거나 연결이 끊어졌습니다. 다시 로그인해주세요.',
    });

    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it('fails before sending protected requests when the stored Supabase session is already missing', async () => {
    installWindow();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 10_000);
    const listener = vi.fn();
    const unsubscribe = subscribeSupabaseAuthFailure(listener);
    const request = vi.fn().mockResolvedValue({
      data: null,
      error: null,
      status: 200,
    });

    await expect(executeSupabaseRequest('상담사 목록 조회', {
      then: request,
    } as PromiseLike<{ data: null; error: null; status: 200 }>, {
      requireStoredSession: true,
    })).rejects.toMatchObject({
      name: 'SupabaseSessionExpiredError',
      message: '세션이 만료되었거나 연결이 끊어졌습니다. 다시 로그인해주세요.',
    });

    expect(request).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it('fails fast when a Supabase request hangs longer than the configured timeout', async () => {
    vi.useFakeTimers();
    try {
      const pendingRequest = new Promise<never>(() => {
        // Keep pending to simulate a hung network request.
      });

      const requestPromise = executeSupabaseRequest('고객 목록 조회', pendingRequest, {
        timeoutMs: 50,
      });
      const assertion = expect(requestPromise).rejects.toMatchObject({
        name: 'SupabaseRequestTimeoutError',
        message: '고객 목록 조회 요청이 1초 안에 끝나지 않았습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.',
      });

      await vi.advanceTimersByTimeAsync(50);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
