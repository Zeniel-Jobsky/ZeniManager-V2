export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';
export const ROLE_ADMIN = 4 as const;
export const ROLE_COUNSELOR = 5 as const;
export type AppRole = typeof ROLE_ADMIN | typeof ROLE_COUNSELOR;

export const normalizeAppRole = (role: unknown): AppRole => {
  if (role === ROLE_ADMIN || role === "4" || role === "admin") {
    return ROLE_ADMIN;
  }
  if (
    role === ROLE_COUNSELOR ||
    role === "5" ||
    role === "counselor" ||
    role === "user"
  ) {
    return ROLE_COUNSELOR;
  }

  return ROLE_COUNSELOR;
};

export const isAdminRole = (role: unknown): boolean =>
  normalizeAppRole(role) === ROLE_ADMIN;
