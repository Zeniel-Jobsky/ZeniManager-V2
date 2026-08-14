# ✋ ZeniManager 병합 체크포인트 (Update v2)

이 문서는 `dev` 브랜치를 머지하거나 리베이스(Rebase)한 후 발생하는 **신규 증상들**을 해결하기 위한 체크리스트입니다.

---

### ✅ 1. 대시보드 및 상세 페이지 "하얀 화면 / 로딩 불가" 해결
*   **파일 위치**: `client/src/lib/api.ts` 및 `client/src/lib/api.dashboard.ts` 확인.
*   **체크 사항**: `Invalid time value` 에러가 발생하는 날짜 파싱 코드가 있는지 확인.
*   **해결 방법**: 반드시 `parseSafeDate` 헬퍼 함수를 사용하여 유효하지 않은 날짜에 대응해야 합니다.

### ✅ 2. DB 연결 및 로그아웃 현상 복구
*   **파일 위치**: `client/src/lib/supabase.ts` 확인.
*   **체크 사항**: 
    1. `localStorage` 비어있어도 `.env` 참조하는 Fallback 코드가 살아있는가?
    2. `supabaseClient`의 `storage`가 `localStorage`로 되어있는가?
    3. `main.tsx`의 `resetTransientSessionOnLaunch();`가 주석 처리 되어있는가?

### ✅ 3. 상담 상세 페이지 진행도 보드 (Stepper) 확인
*   **파일 위치**: `client/src/pages/counselor/ClientDetail.tsx` 확인.
*   **체크 사항**: 상단에 `초기상담 → 심층상담 → 취업지원...` 시각적 진행 보드가 정상 노출되는가?
*   **추가 조치**: `pnpm install`을 다시 실행하여 `react-daum-postcode` 등 빌드 시 누락된 모듈을 복구하세요.
