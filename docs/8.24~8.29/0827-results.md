# 작업 결과 — 2026-08-27

> 작성자: BE-wookhyun (Claude Code와 함께 진행)
> 관련 문서: [0826-results.md](./0826-results.md), [UX-Flow.md](./UX-Flow.md), [기능테스트.md](./기능테스트.md)

어제(8/26) 커밋·푸시까지 마친 뒤, 오늘은 (1) 상담자 등록 폼에서 저장되지도 않던 죽은 입력 필드 정리, (2) 취업 성공사례 AI 매칭 기능이 403/500으로 실패하던 문제를 로그 기반으로 추적해 근본 원인(service_role 권한 누락)까지 해결, (3) 그 과정에서 에러 메시지가 뭉개지던 Edge Function 코드 개선 및 재배포, (4) 완전히 별개로 방치돼 있던 "고객 챗봇 대화 이력" 기능의 스키마 버그 발견·수정, (5) 프로젝트 전체를 훑어 어디서도 호출/렌더되지 않는 죽은 코드를 찾아 사용자 확인 후 제거하는 작업으로 이어졌다.

---

## 1. 상담자 등록 폼 — 저장되지 않는 죽은 필드 정리

### 배경 / 문제

상담자 등록 화면에는 있는데 상담자 세부사항(상세 화면)에는 안 보이는 항목들(MBTI, 차량/운전 여부, 알바 중, 내일배움카드, 이메일)이 있다는 제보. 확인해보니 `api.ts`의 `createClient`가 이 필드들을 애초에 참조하지 않아 **입력해도 DB에 저장되지 않는 죽은 입력란**이었다 (그래서 상세 화면에 안 보이는 게 맞는 동작이었음).

### 조치

[ClientRegister.tsx](../../client/src/pages/counselor/ClientRegister.tsx)에서 아래를 제거:
- MBTI 선택 드롭다운
- 차량/운전 토글(자차 보유 / 운전 가능)
- "현재 알바 중" · "내일배움카드" 토글 (같은 셀에 있던 항목이라 함께 정리)
- 이메일 입력란

폼 상태(`form.MBTI` 등), 등록 payload의 해당 줄, 임시저장(localStorage draft) 조건문, 더 이상 안 쓰는 `Car`/`Mail` 아이콘 import까지 함께 정리.

### 검증

`npx tsc --noEmit` 클린, `pnpm test` 65개 통과(3 skip).

---

## 2. `sync-employment-success-case` 403/500 에러 추적 → service_role 권한 누락 확인

### 배경 / 문제

Supabase Edge Function 로그에서 `GET /rest/v1/clients ... 403` 경고를 발견하면서 시작. 처음엔 무관해 보이는 `summary-match-score`(죽은 Edge Function, 옛 `client` 단수 테이블을 조회하도록 방치돼 있었음)의 존재를 먼저 짚었지만, 실제 403의 정체는 **실제 사용 중인 `sync-employment-success-case`**였다.

추적 과정:
1. 로그의 `select=id,name,age,...,employment_date&id=eq.xxx` 쿼리 파라미터가 [sync-employment-success-case/index.ts](../../supabase/functions/sync-employment-success-case/index.ts)의 `CLIENT_SELECT_FIELDS`와 정확히 일치 → 이 함수가 범인임을 특정
2. Invoke 테스트로 재현 시도 → 처음엔 catch 블록의 뭉뚱그린 fallback 문구("성공사례 동기화 중 오류가 발생했습니다")만 보여서 원인 특정 실패
3. **Edge Function 자체 로그**(API 게이트웨이 로그가 아니라 `console.error`가 찍히는 Function Logs)를 확인하고서야 진짜 에러를 확보:
   ```
   code: "42501"
   message: "permission denied for table clients"
   hint: "Grant the required privileges to the current role with: GRANT SELECT ON public.clients TO service_role;"
   ```

### 원인

`service_role`은 RLS는 우회하지만 **테이블 단위 GRANT는 별개로 필요**하다. 이 프로젝트는 지금까지(어제까지 포함) 모든 SQL에서 GRANT를 `authenticated`에게만 줬고 `service_role`에는 한 번도 명시적으로 준 적이 없었다 — 레포의 SQL 파일 전체를 검색해도 `service_role` GRANT는 단 한 곳도 없었음. Edge Function(=service_role로 동작)이 `clients`를 읽으려 할 때마다 이 문제가 났던 것.

### 조치

[supabase/sql/service_role_grants.sql](../../supabase/sql/service_role_grants.sql) 신규 작성 및 실행 — `service_role`에 `public` 스키마 전체(테이블/시퀀스/함수) 권한 부여 + `ALTER DEFAULT PRIVILEGES`로 앞으로 생길 테이블에도 자동 적용되도록 처리 (service_role은 브라우저에 노출되지 않는 서버 전용 키라 넓게 권한을 줘도 안전 — 원래 신규 Supabase 프로젝트엔 기본으로 세팅돼 있어야 하는데 이 프로젝트는 빠져 있었음).

### 검증

실행 후 동일한 clientId로 재호출 → `{ clientId: "...", status: "deactivated" }` 정상 응답 확인 (해당 고객이 취업완료 조건을 충족하지 않아 비활성화 처리된, 에러 없는 정상 케이스).

---

## 3. Edge Function 에러 메시지가 뭉개지던 버그 수정 + 재배포

### 배경 / 문제

2번을 추적하는 과정에서, `sync-employment-success-case`/`search-employment-success-case`의 catch 블록이 `error instanceof Error ? error.message : fallback` 패턴을 쓰고 있는데, supabase-js가 던지는 PostgrestError 계열은 `instanceof Error`가 아닌 일반 객체(`{ message, details, hint, code }`)라 **항상 fallback 문구로 뭉개져서 실제 원인을 알 수 없었다**. 이번에 진짜 원인을 알아낸 것도 API 응답이 아니라 Function Logs의 `console.error` 원본을 직접 봐서였음.

### 조치

- [_shared/employment-success.ts](../../supabase/functions/_shared/employment-success.ts)에 `describeError()` 헬퍼 추가 — `instanceof Error` → `.message` 속성 존재 → 문자열 → 직렬화 순으로 최대한 실제 원인을 뽑아내도록
- `sync-employment-success-case`, `search-employment-success-case` 둘 다 catch 블록을 `describeError(error, fallback문구)`로 교체
- `supabase functions deploy`로 두 함수 재배포 완료

### 검증

`pnpm run check:edge`(Deno용 별도 tsconfig) 클린. 앞으로 이 두 함수에서 에러가 나면 Invoke 응답이나 프론트 토스트만으로 원인이 바로 보일 것으로 기대.

---

## 4. 다른 PC에서 `git pull` 후 상담자 목록이 안 뜨는 문제 — 원인 설명 (확인 대기 중)

### 배경 / 문제

다른 PC에서 최신 코드를 pull 받아 실행했더니 "client 테이블이 없다"며 상담자 목록이 안 뜬다는 제보.

### 조치 (진단만, 코드 수정 없음)

코드 자체는 문제 없음을 확인 — `fetchClients` 등은 전부 `clients`(복수형)를 조회하고, `client`(단수)를 조회하는 곳은 죽은 코드(`summary-match-score`) 하나뿐이라 상담자 목록과 무관. 실제 원인으로 추정되는 것은 **Supabase 연결 정보(URL/Anon Key)가 `.env`나 git이 아니라 브라우저 `localStorage`에만 저장**된다는 점 — 다른 PC는 이 정보가 아예 없거나 옛 프로젝트 정보가 남아있을 수 있음. 설정 화면에서 URL이 이 프로젝트(`hmrnlmewgufzpxlfnrht`)와 일치하는지 확인해달라고 안내함. **결과 미확인 — 다음에 이어서 확인 필요.**

---

## 5. 고객 챗봇 대화 이력(`client_chat_history`) — 옛 스키마 방치로 인한 버그 발견/수정

### 배경 / 문제

2~3번과는 무관하게, 고객 상세의 챗봇 탭에서 "유효한 client_id가 필요합니다" 에러가 발생한다는 제보. 추적해보니 이 기능은 스키마 마이그레이션(8/25) 이전에 별도로 추가된 기능이라 **한 번도 새 스키마에 맞춰진 적이 없었다.**

- [clientChatHistory.ts](../../client/src/lib/clientChatHistory.ts)의 `toNumericClientId()`가 `client.id`(실제로는 uuid 문자열)를 `Number()`로 강제 변환 → 항상 `NaN` → DB 요청까지 가지도 못하고 **클라이언트 단에서 바로 에러**를 던지고 있었음
- [supabase/sql/client_chat_history.sql](../../supabase/sql/client_chat_history.sql)도 `client_id integer references public.client(client_id)`로 남아있었음 (라이브 DB에 `public.client`가 존재한 적이 없어 이 테이블 자체가 생성조차 안 됐을 가능성). RLS도 `counselor_id = auth.uid()`로 되어 있어 3번 항목(counselor_id는 auth.uid()가 아니라 counselors.id) 발견 이전의 옛 설계 그대로였고, GRANT도 원본 파일에 아예 빠져 있었음

### 조치

- `clientChatHistory.ts`: `client_id`를 숫자 변환 없이 uuid 문자열 그대로 사용하도록 수정
- `client_chat_history.sql` 전면 재작성: `client_id uuid references public.clients(id)`, RLS를 다른 테이블과 동일한 `is_admin()`/`get_my_counselor_id()` 패턴으로 교체, `GRANT SELECT, INSERT, UPDATE ... TO authenticated` 추가. 이 기능이 한 번도 정상 동작한 적이 없다고 판단해 `DROP TABLE IF EXISTS ... CASCADE` 후 재생성하는 방식으로 작성

### 검증

`npx tsc --noEmit`, `pnpm test` 클린(65 passed, 3 skip). **DB 실행은 아직 — `client_chat_history.sql`을 Supabase SQL 에디터에서 실행해야 실제로 동작함.**

---

## 6. 프로젝트 전체 죽은 코드 정리

### 배경

"제거하기 전에 알려줘야 한다"는 기존 원칙(8/25 항목)에 따라, 전체 코드베이스를 grep 기반으로 훑어 **정의는 돼 있는데 어디서도 호출/렌더되지 않는 코드**를 찾아 카테고리별로 정리한 뒤, 사용자에게 각 항목이 무엇인지 설명하고 확인받고서 제거를 진행했다.

### 조사 방법

`api.ts`/`lib/*.ts`의 모든 `export` 심볼에 대해, 정의 파일 자신을 제외한 나머지 코드베이스(테스트 포함/제외 각각)에서 참조 횟수를 세는 방식으로 1차 후보를 추렸다. 이후 각 후보를 직접 열어 실제로 호출부가 없는지, 혹은 테스트 인프라·미래 대비용으로 의도적으로 남겨둔 것인지 재확인했다.

### 조치 — 1차(사용자 승인 항목)

- **api.ts 죽은 CRUD 함수**: `createCounselor`/`deleteCounselor`(상담사 계정 생성·삭제 UI 자체가 없음), `fetchMemoCards`/`createMemoCard`/`updateMemoCard`/`deleteMemoCard`(칸반보드형 "메모 카드" 기능, 화면 없음), `fetchCertificates`
- **취업 성공사례 "스펙 백분위 비교" 기능 전체**: `client/src/lib/summaryMatchScore.ts`, `supabase/functions/summary-match-score/`, `supabase/sql/summary_match_score_rls.sql` — 어제(2번 항목) 403을 조사하며 이미 죽은 코드로 확인했던 그 옛 `client`(단수) 테이블 참조 기능
- **라우팅 안 된 페이지/컴포넌트**: `pages/NotFound.tsx`(App.tsx의 404 fallback이 리다이렉트 방식이라 안 씀), `pages/ComponentShowcase.tsx`, `components/DashboardLayoutSkeleton.tsx`, `components/ManusDialog.tsx`
- **`ClientDetail.tsx`의 죽은 자격증 UI 잔재**: `CertificationList` 컴포넌트, `handleAddCert`/`handleDeleteCert` — 렌더/호출부 없음. 연쇄적으로 `api.ts`의 `addCertificate`/`deleteCertificate` 스텁도 호출부가 사라져 함께 제거
- **`ClientDetail.tsx` 기타 죽은 코드**: `handleUpdateSession`, `editingSessionId`/`editSessionContent` state, 인라인 `formatTime` 헬퍼 — 전부 옛 상담이력 수정 방식의 잔재로, `selectedSessionId`/`isEditingHistory`/`historyEditDraft` 기반의 현재 방식으로 대체된 뒤에도 안 지워져 있었음
- **안 쓰는 상수/유틸**: `shared/const.ts`의 `COOKIE_NAME`/`ONE_YEAR_MS`/`AXIOS_TIMEOUT_MS`/`UNAUTHED_ERR_MSG`/`NOT_ADMIN_ERR_MSG`(쿠키 세션 방식 자체를 안 씀 — Supabase Auth + localStorage 사용), `employmentSuccessCase.ts`의 `backfillEmploymentSuccessCases`
- **App.tsx**: `/clients/detail/:id` 라우트 중복 등록 정리 (기능상 문제는 없었으나 정리)

`axios` npm 의존성(어디서도 import 안 됨)은 후보로 제시했으나 이번엔 제외하기로 함(미제거).

### 조치 — 2차(작업 중 추가 발견)

1차 항목을 정리하던 중 연쇄적으로 드러난 죽은 코드를 추가로 찾아 알리고 승인받아 제거:

- **`pages/Home.tsx` + `_core/hooks/useAuth.ts`**: "All content in this page are only for example..." 주석이 그대로 남아있는 템플릿 예제 페이지. `App.tsx`가 `/` 경로를 `Home` 컴포넌트 없이 바로 리다이렉트하도록 이미 바뀌어 있어 완전히 라우팅 밖으로 벗어나 있었음. 연쇄적으로 `client/src/const.ts`의 `getLoginUrl()`(OAuth 포털 로그인 방식 잔재 — 이 앱은 Supabase Auth 직접 사용)도 함께 제거
- **`api.ts`의 `isMissingSchemaError`/`ClientInsert`·`SurveyInsert` 미사용 타입 import**: `decodeSessionPayload`를 지우려다 짝 함수인 **`encodeSessionPayload`도 똑같이 호출부 0곳**임을 추가로 발견해, 관련 `SESSION_META_MARKER` 상수까지 encode/decode 한 쌍을 통째로 제거

### 조치 — 검토 후 "죽은 코드 아님"으로 판단해 보류

- **`clearJobRecommendationCache`**: 실제로는 `jobRecommendations.test.ts`의 `beforeEach`에서 모듈 레벨 캐시를 초기화하는 용도로 쓰이고 있어, 지우면 테스트 간 캐시가 새어나갈 위험이 있었음. UI에서 직접 호출은 안 하지만 테스트 인프라 목적의 정당한 사용으로 판단해 유지
- **`resetTransientSessionOnLaunch`**: "Electron 앱 실행 시 세션 초기화"용으로 만들어졌는데 정작 `main.tsx`(앱 부팅 코드)에서 호출을 안 하고 있어, 죽은 코드라기보다 **연결이 빠진 버그**로 보임. 삭제할지 `main.tsx`에 연결해서 고칠지 사용자에게 물었고, "지우지마"로 결론 — 현재 상태 그대로 유지, 연결 작업도 하지 않음

### 검증

전체 작업 완료 후 `npx tsc --noEmit`, `pnpm run check:edge`, `pnpm test`(65 passed, 3 skip) 모두 클린 확인.

---

## 다음 단계 (TODO)

- [ ] `supabase/sql/client_chat_history.sql` 실행 필요 (아직 미실행)
- [ ] 4번 항목(다른 PC 상담자 목록 안 뜨는 문제) — Supabase 연결 설정 확인 결과 회신 대기
- [x] `summary-match-score` Edge Function 존폐 결정 — 6번 항목에서 삭제로 결론
- [ ] `resetTransientSessionOnLaunch` — `main.tsx` 미연결 상태 그대로 유지하기로 함(사용자 결정). 나중에 Electron 세션 초기화가 실제로 필요해지면 그때 연결 작업 필요
- [ ] 어제 이전부터 이어지는 미해결 항목은 [0826-results.md](./0826-results.md) / [0825-results.md](./0825-results.md) 하단 TODO 참고
