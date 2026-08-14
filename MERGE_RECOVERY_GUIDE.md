# 🛡️ ZeniManager 병합 복구 및 안정화 가이드 (Merge Recovery Guide)

본 가이드는 `dev` 브랜치 병합 후 발생할 수 있는 주요 장애(DB 연결 끊김, 흰 화면, 날짜 오류 등)를 빠르게 해결하기 위한 체크리스트입니다.

---

## ✅ 1. Supabase 접속 및 세션 체크 (가장 중요)

병합 후 DB 접속이 안 되거나 자꾸 로그아웃된다면 아래 파일들을 확인하세요.

- [ ] **`.env` 파일 존재 확인**: 프로젝트 루트에 `.env`가 있고 `VITE_SUPABASE_URL` 등이 올바른지 확인.
- [ ] **`client/src/lib/supabase.ts` 접속 로직**:
    - `getSupabaseUrl()` 등에서 `import.meta.env`를 참조하는 **Fallback 로직**이 살아있는지 확인. (유실 시 `localStorage`가 비어있으면 접속 불가)
    - `getSupabaseClient()` 내부 `auth.storage`가 `window.localStorage`로 되어있는지 확인. (`sessionStorage`로 되어있으면 새로고침 시 로그아웃됨)
- [ ] **`client/src/main.tsx` 초기화 로직**:
    - `resetTransientSessionOnLaunch();` 코드가 **주석 처리** 되어 있는지 확인. (활성화 시 앱 시작 시마다 세션이 초기화됨)

---

## ✅ 2. 데이터 로딩 오류 방지 (`Invalid time value`)

내담자 목록이 안 뜨거나 "Invalid time value" 에러가 발생한다면 이 로직을 확인하세요.

- [ ] **`api.ts` & `api.dashboard.ts` 날짜 파싱**:
    - `liveClientToRow` 함수 내부에서 `${row.update_at}T00:00:00` 처럼 날짜 문자열을 강제로 합치는 코드가 있는지 확인.
    - 반드시 `parseSafeDate` 헬퍼 함수를 사용하여 **NaN(Invalid Date)** 처리를 하고 있는지 확인하세요.
- [ ] **함수 유실 확인**: `api.ts` 하단의 `mockClientToRow`, `mockSessionToRow` 등 변환 함수가 머지 과정에서 지워지지 않았는지 확인.

---

## ✅ 3. UI 및 라이브러리 체크

- [ ] **`ClientRegister.tsx` (주소 검색)**:
    - `react-daum-postcode` 모듈을 찾을 수 없다는 에러 발생 시 즉시 **`pnpm install`** 실행.
- [ ] **`ClientDetail.tsx` (진행도 보드)**:
    - 상세 페이지 상단에 **참여 진행도(Stepper)** UI가 정상적으로 노출되는지 확인.

---

## 🚀 4. 장애 발생 시 즉시 실행 명령어 (Quick Fix)

문제가 해결되지 않을 때 터미널에서 아래 명령어를 순서대로 실행해 보세요.

```bash
# 1. 의존성 패키지 재설치
pnpm install

# 2. 로컬 스토리지 강제 초기화 (접속 정보가 꼬였을 때)
# 브라우저 콘솔(F12) -> Application -> Local Storage -> Clear All -> 새로고침(F5)
```

---

> [!TIP]
> **Antigravity AI 팁**: 병합 후 문제가 생기면 저에게 "@antigravity 가이드 파일 참고해서 접속 설정이랑 날짜 파싱 로직 좀 다시 봐줘"라고 말씀하시면 더 빠르게 복구해 드릴 수 있습니다!
