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

/**
 * clients.participation_stage는 자유 텍스트다 (2026-08-26 확인: "취업완료"라는 정확한 문자열은
 * 실데이터에 단 한 건도 없고, "취업"/"사후관리 취업"/"취업(일본)" 등 30여 종 변형으로 존재).
 * 정확 일치(`=== '취업완료'`) 대신 이 헬퍼로 취업 완료 여부를 판정한다 — "취업"을 포함하되
 * 아직 취업 전 단계인 "취업지원"은 제외한다.
 */
export const isEmploymentCompletedStage = (stage: unknown): boolean => {
  if (typeof stage !== 'string') return false;
  const trimmed = stage.trim();
  if (!trimmed) return false;
  return trimmed.includes('취업') && trimmed !== '취업지원';
};
