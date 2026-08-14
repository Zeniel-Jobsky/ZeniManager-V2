import { isAdminRole } from '@shared/const';

export type PageAccessRequirement = 'authenticated' | 'admin' | 'counselor';

export const COUNSEL_SERVER_UNAVAILABLE_MESSAGE =
  '상담 관리 서버에 접근할 수 없어 로그인할 수 없습니다. Supabase 연결 상태를 확인한 뒤 다시 시도해주세요.';

export const COUNSEL_ACCOUNT_NOT_FOUND_MESSAGE =
  '상담 관리 서버에서 로그인 정보를 확인할 수 없습니다. 계정 등록 상태를 확인해주세요.';

export const COUNSEL_SESSION_EXPIRED_MESSAGE =
  '세션이 만료되었거나 연결이 끊어졌습니다. 다시 로그인해주세요.';

const AUTH_NOTICE_STORAGE_KEY = 'counsel_auth_notice';

export function matchesAccessRequirement(
  role: unknown,
  requirement: PageAccessRequirement,
): boolean {
  if (requirement === 'authenticated') {
    return role != null;
  }

  if (requirement === 'admin') {
    return isAdminRole(role);
  }

  return role != null && !isAdminRole(role);
}

export function persistAuthNotice(message: string): void {
  if (typeof window === 'undefined' || !message) return;
  sessionStorage.setItem(AUTH_NOTICE_STORAGE_KEY, message);
}

export function consumeAuthNotice(): string | null {
  if (typeof window === 'undefined') return null;

  const message = sessionStorage.getItem(AUTH_NOTICE_STORAGE_KEY);
  if (message) {
    sessionStorage.removeItem(AUTH_NOTICE_STORAGE_KEY);
  }

  return message;
}
