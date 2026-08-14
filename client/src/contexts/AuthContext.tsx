/**
 * AuthContext
 *
 * Uses Supabase Auth when Supabase URL + anon key are configured in Settings.
 *
 * SECURITY: No API keys are hardcoded. All credentials come from localStorage.
 */
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { normalizeAppRole, ROLE_ADMIN, ROLE_COUNSELOR, type AppRole } from '@shared/const';
import {
  clearStoredAuthState,
  clearStoredSupabaseSession,
  createSupabaseSessionExpiredError,
  getCachedSupabaseClient,
  getSupabaseClient,
  hasStoredSupabaseSession,
  isSupabaseConfigured,
  subscribeSupabaseAuthFailure,
} from '@/lib/supabase';
import {
  COUNSEL_ACCOUNT_NOT_FOUND_MESSAGE,
  COUNSEL_SERVER_UNAVAILABLE_MESSAGE,
  COUNSEL_SESSION_EXPIRED_MESSAGE,
  persistAuthNotice,
} from '@/lib/authAccess';
import {
  createCounselorProfileLookups,
  mapCounselorProfileToUser,
  normalizeLoginEmail,
  resolveCounselorProfile,
} from './authProfile';

export type UserRole = AppRole;

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  profileImage?: string;
  department?: string;
  branch?: string;
  counselorId?: string; // Current profile key used by downstream filters
}

export interface LoginResult {
  success: boolean;
  error?: string;
  user?: User;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const USER_STORAGE_KEY = 'counsel_user';
const SESSION_REVALIDATION_INTERVAL_MS = 20_000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const stored = localStorage.getItem(USER_STORAGE_KEY);
      if (!stored) return null;
      const parsed = JSON.parse(stored) as Partial<User> & { role?: unknown };
      return {
        ...parsed,
        role: normalizeAppRole(parsed.role),
      } as User;
    } catch {
      return null;
    }
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInitializing, setIsInitializing] = useState(() => {
    return isSupabaseConfigured() && hasStoredSupabaseSession() && !user;
  });
  const authRevisionRef = useRef(0);
  const isLoading = isSubmitting || isInitializing;

  const bumpAuthRevision = useCallback(() => {
    authRevisionRef.current += 1;
    return authRevisionRef.current;
  }, []);

  const isCurrentAuthRevision = useCallback((revision: number) => {
    return authRevisionRef.current === revision;
  }, []);

  const persistResolvedUser = useCallback((resolvedUser: User) => {
    setUser(resolvedUser);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(resolvedUser));
  }, []);

  const clearLocalAuthState = useCallback(() => {
    authRevisionRef.current += 1;
    setUser(null);
    clearStoredAuthState();
  }, []);

  const clearSupabaseSession = useCallback(async () => {
    const sb = getCachedSupabaseClient();

    try {
      if (sb) {
        await Promise.race([
          sb.auth.signOut({ scope: 'local' }),
          new Promise(resolve => setTimeout(resolve, 1500)),
        ]);
      }
    } catch {
      // Ignore sign-out failures and continue clearing the local auth state.
    } finally {
      clearStoredSupabaseSession();
    }
  }, []);

  const resolveSupabaseUser = useCallback(async (
    authUserId: string,
    email: string,
    accessToken?: string | null,
  ): Promise<LoginResult> => {
    const normalizedEmail = normalizeLoginEmail(email);

    const sb = getSupabaseClient();
    if (!sb) {
      const fallbackUser: User = {
        id: authUserId,
        name: normalizedEmail.split('@')[0] || '사용자',
        email,
        role: ROLE_COUNSELOR,
      };

      return {
        success: true,
        user: fallbackUser,
      };
    }

    const { profile, hadLookupError } = await Promise.race([
      resolveCounselorProfile(
        { authUserId, email: normalizedEmail },
        createCounselorProfileLookups(sb, accessToken),
      ),
      new Promise<{ profile: Awaited<ReturnType<typeof resolveCounselorProfile>>['profile']; hadLookupError: boolean }>(resolve =>
        setTimeout(() => resolve({ profile: null, hadLookupError: false }), 3000)
      )
    ]);

    if (profile) {
      const resolvedUser = mapCounselorProfileToUser(
        { authUserId, email: normalizedEmail },
        profile,
      );

      return {
        success: true,
        user: resolvedUser,
      };
    }

    if (hadLookupError) {
      return {
        success: false,
        error: COUNSEL_SERVER_UNAVAILABLE_MESSAGE,
      };
    }

    const resolvedUser: User = {
      id: authUserId,
      name: normalizedEmail.split('@')[0] || '사용자',
      email,
      role: ROLE_COUNSELOR,
    };

    return {
      success: true,
      user: resolvedUser,
    };
  }, []);

  // Listen for Supabase session changes when configured
  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setIsInitializing(false);
      return;
    }

    const sb = getSupabaseClient();
    if (!sb) {
      setIsInitializing(false);
      return;
    }

    let isDisposed = false;
    let isSessionCheckInFlight = false;

    const syncResolvedUser = async (
      authUserId: string,
      email: string,
      accessToken?: string | null,
      options: { persistFailureNotice?: boolean } = {},
    ) => {
      const revision = bumpAuthRevision();
      const result = await resolveSupabaseUser(authUserId, email, accessToken);
      if (isDisposed || !isCurrentAuthRevision(revision)) {
        return;
      }

      if (result.success && result.user) {
        persistResolvedUser(result.user);
        return;
      }

      if (options.persistFailureNotice !== false) {
        persistAuthNotice(result.error || COUNSEL_SERVER_UNAVAILABLE_MESSAGE);
      }

      clearLocalAuthState();
      await clearSupabaseSession();
    };

    const forceLogoutWithNotice = async (message: string) => {
      if (isDisposed) return;
      persistAuthNotice(message);
      clearLocalAuthState();
      await clearSupabaseSession();
      if (!isDisposed) {
        setIsInitializing(false);
      }
    };

    const revalidateSession = async () => {
      if (isDisposed || isSessionCheckInFlight) {
        return;
      }

      const hasPersistedUser = Boolean(localStorage.getItem(USER_STORAGE_KEY));
      if (!hasStoredSupabaseSession() && !hasPersistedUser) {
        return;
      }

      isSessionCheckInFlight = true;
      try {
        const { data: { session }, error } = await sb.auth.getSession();
        if (isDisposed) {
          return;
        }

        if (error || !session?.user) {
          await forceLogoutWithNotice(COUNSEL_SESSION_EXPIRED_MESSAGE);
        }
      } catch {
        await forceLogoutWithNotice(COUNSEL_SESSION_EXPIRED_MESSAGE);
      } finally {
        isSessionCheckInFlight = false;
      }
    };

    void sb.auth.getSession()
      .then(async ({ data: { session }, error }) => {
        if (error) {
          await forceLogoutWithNotice(COUNSEL_SERVER_UNAVAILABLE_MESSAGE);
          return;
        }

        if (session?.user) {
          await syncResolvedUser(session.user.id, session.user.email || '', session.access_token, {
            persistFailureNotice: false,
          });
          return;
        }

        clearLocalAuthState();
      })
      .catch(async () => {
        await forceLogoutWithNotice(COUNSEL_SERVER_UNAVAILABLE_MESSAGE);
      })
      .finally(() => {
        if (!isDisposed) {
          setIsInitializing(false);
        }
      });

    const { data: { subscription } } = sb.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        await syncResolvedUser(session.user.id, session.user.email || '', session.access_token);
      } else {
        clearLocalAuthState();
      }
    });

    const unsubscribeAuthFailure = subscribeSupabaseAuthFailure((error) => {
      void forceLogoutWithNotice(
        error.message || createSupabaseSessionExpiredError().message,
      );
    });

    const handleWindowFocus = () => {
      void revalidateSession();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void revalidateSession();
      }
    };

    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      void revalidateSession();
    }, SESSION_REVALIDATION_INTERVAL_MS);

    return () => {
      isDisposed = true;
      subscription.unsubscribe();
      unsubscribeAuthFailure();
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [
    bumpAuthRevision,
    clearLocalAuthState,
    clearSupabaseSession,
    isCurrentAuthRevision,
    persistResolvedUser,
    resolveSupabaseUser,
  ]);

  const login = useCallback(async (
    email: string,
    password: string
  ): Promise<LoginResult> => {
    setIsSubmitting(true);
    const normalizedEmail = normalizeLoginEmail(email);
    try {
      // ── Supabase Auth ──────────────────────────────────────────────────────
      if (isSupabaseConfigured()) {
        const sb = getSupabaseClient();
        if (!sb) throw new Error('Supabase 클라이언트 초기화 실패');

        const { data, error } = await sb.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (error) return { success: false, error: error.message };

        if (data.user) {
          const revision = bumpAuthRevision();
          const resolvedResult = await resolveSupabaseUser(
            data.user.id,
            data.user.email || normalizedEmail,
            data.session?.access_token,
          );

          if (!resolvedResult.success) {
            clearLocalAuthState();
            void clearSupabaseSession();
          } else if (resolvedResult.user && isCurrentAuthRevision(revision)) {
            persistResolvedUser(resolvedResult.user);
          }

          return resolvedResult;
        }
        return { success: false, error: '로그인 실패' };
      }

      return {
        success: false,
        error: 'Supabase 설정이 필요합니다. 설정 화면에서 Supabase URL과 API 키를 먼저 입력하세요.',
      };
    } catch (e: any) {
      return { success: false, error: e.message || '로그인 중 오류 발생' };
    } finally {
      setIsSubmitting(false);
    }
  }, [
    bumpAuthRevision,
    clearLocalAuthState,
    clearSupabaseSession,
    isCurrentAuthRevision,
    persistResolvedUser,
    resolveSupabaseUser,
  ]);

  const logout = useCallback(async () => {
    clearLocalAuthState();
    if (isSupabaseConfigured()) {
      await clearSupabaseSession();
    }
  }, [clearLocalAuthState, clearSupabaseSession]);

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      isLoading,
      login,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
