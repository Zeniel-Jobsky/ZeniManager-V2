# 작업 결과 — 2026-08-25

> 작성자: BE-wookhyun (Claude Code와 함께 진행)
> 관련 문서: [0824-results.md](./0824-results.md)

오늘은 크게 다섯 갈래로 작업했다: (1) 로그인/Supabase 연결이 안 되던 문제를 추적하다가 **코드가 기대하는 스키마와 실제 라이브 DB 스키마가 다르다**는 근본 원인을 발견해 대규모로 코드를 맞춘 작업, (2) 그 과정에서 추가로 드러난 세부 버그(권한, 페이지네이션, 화면 필드 누락, 등록/인라인 수정 실패) 수정, (3) 고객 목록 스와이프 삭제 기능 신규 추가, (4) 실사용 중 발견된 취업 성공사례 AI 매칭 기능을 새 스키마로 이관 (DB/배포는 진행 중), (5) 참여단계 값이 앱 가정보다 훨씬 다양함을 발견해 고정 드롭다운을 자유 텍스트로 전환하고 관련 KPI 집계 로직 수정.

---

## 1. Supabase 연결 문제 추적 → 스키마 불일치 발견

### 배경 / 문제

로그인 시 "상담 관리 서버에 접근할 수 없어 로그인할 수 없습니다" 에러가 발생했다. 원인을 추적하니 다음이 순차적으로 드러났다:

- 로그인 프로필 조회가 쓰는 `public.user` 테이블이 라이브 프로젝트에 아예 없었음 (404)
- 만들고 나니 대시보드가 조회하는 `counsel_history` 테이블도 없음 — 대신 `sessions`라는 이름으로 존재
- Table Editor로 실제 테이블 목록을 확인한 결과: `clients`(복수형)/`counselors`/`sessions`/`survey_responses`/`memo_cards` — 레포의 `supabase_setup.sql`(레거시로 추정했던 스크립트)과 **정확히 일치**함을 확인
- 반면 `client/src/lib/api.ts`는 `client`(단수, 정수 PK)/`counsel_history` 등 완전히 다른 스키마를 대상으로 짜여 있었음

즉 레포의 `api.ts`가 가정하는 스키마와, 실제 라이브 DB(실데이터 보유)가 다른 상태였다.

### 조치 — 코드를 실제 DB 스키마에 맞춤

실데이터가 `clients`/`sessions` 스키마에 있었으므로, **코드를 실제 DB에 맞추는 방향**으로 결정하고 아래를 재작성했다:

- [client/src/lib/supabase.ts](../../client/src/lib/supabase.ts): `ClientRow`/`ClientInsert`, `SessionRow`/`SessionInsert` 타입을 `clients`/`sessions` 실제 컬럼 기준으로 전면 재작성
- [client/src/lib/api.ts](../../client/src/lib/api.ts): 고객/세션 CRUD 전부 재작성 (`client`→`clients`, `counsel_history`→`sessions`, 정수 `client_id`→uuid `id`)
- [client/src/lib/api.dashboard.ts](../../client/src/lib/api.dashboard.ts): 대시보드 통계/캘린더 조회 함수 동일하게 재작성
- 영향받은 화면 9개 수정: `ClientDetail.tsx`, `AdminClientList.tsx`, `CounselChatTab.tsx`, `ClientList.tsx`, `AdminDashboard.tsx`, `CounselorList.tsx`, `summaryAnalysisPipeline.ts` 등 — 컴파일 에러 191개 → 0개
- `api.dashboardRuntime.test.ts` 목(mock) 데이터를 새 스키마로 갱신

### 스키마에 없어 제거된 기능

자격증, 참여수당 이력, 희망직무/희망지역 2·3순위, 희망급여, MBTI, 이메일, 자차/알바/운전 여부, 전화번호 암호화, 세션의 회차·시작/종료시간·심층상담 프로파일링 필드(경제상황/사회적상황/자아존중감 등 10여 개). 관련 함수는 삭제하지 않고 "지원 안 됨" 에러를 명시적으로 던지도록 스텁 처리해뒀다 (조용히 데이터가 사라지는 것 방지).

### 검증

`pnpm check`(tsc --noEmit) 클린, `pnpm test` 37개 전부 통과.

### 남은 참고 사항

- [ ] `client/src/lib/employmentSuccessCase.ts`와 `supabase/functions/`의 Edge Function 3개(취업 성공사례 AI 매칭 기능)는 아직 옛 `client`(단수) 스키마를 참조 중 — 미해결. "취업 성공사례" 탭 사용 시 별도 조치 필요.

---

## 2. RLS/권한 디버깅

### 배경 / 문제

스키마를 맞춘 뒤에도 `/rest/v1/clients` 조회가 403, `/rest/v1/user` 조회가 400/404를 반복했다.

### 조치

- `public.user` 테이블·권한(GRANT)·RLS 정책 신설 (테이블 자체가 없었음)
- `public.counsel_history`(옛 이름) 대신 실제 사용하는 `public.sessions`용 RLS 신설
- `manager_memo` 테이블이 없어 상담사 목록 조회(`user` ↔ `manager_memo` 관계 임베딩)가 400 → 테이블·FK·RLS 신설
- PostgREST 스키마 캐시가 DDL 변경을 못 따라가 404/관계 인식 실패가 반복 → `NOTIFY pgrst, 'reload schema';` 로 해결
- 테이블 자체엔 있어도 GRANT가 없어 403 나는 경우 확인 → `grant ... to authenticated` 보완
- `clients.counselor_id`가 `auth.uid()`가 아니라 **`public.counselors(id)`를 참조**하는 FK임을 뒤늦게 발견 — 한 번 `counselor_id = auth.uid()`로 RLS를 잘못 고쳤다가, FK 위반 에러를 계기로 원래 설계(`is_admin()`/`get_my_counselor_id()`가 `counselors` 테이블을 거치는 방식)로 되돌림
- 테스트 계정을 `counselors.auth_user_id`에 연결하고, 테스트용 고객 배정 SQL 제공
- `counselors` 테이블도 GRANT 누락으로 `permission denied for table counselors` 발생 → `grant ... to authenticated` 보완

### 검증

로그인 후 상담자 수/고객 수가 화면에 표시되는 것 확인.

---

## 3. 핵심 버그: `counselor_id`에 로그인 UUID를 직접 쓰던 문제

### 배경 / 문제

권한을 다 맞췄는데도 대시보드 통계가 계속 0으로 나왔다. 원인은 앱 코드 쪽에 있었다 — `clients`/`sessions`/`memo_cards.counselor_id`는 `counselors.id`(별도 UUID)를 참조하는데, `fetchClients`/`createClient`/`createSession`/`fetchMemoCards`와 대시보드 조회 함수들이 **로그인 계정의 auth uid를 그대로 `counselor_id`로 필터/저장**하고 있었다. RLS가 아무리 정확해도 이 앱단 필터 자체가 항상 매칭 실패를 냈다.

### 조치

- [api.ts](../../client/src/lib/api.ts)에 `resolveCounselorRowId(authUserId)` 헬퍼 추가 — auth uid → 실제 `counselors.id` 변환. `fetchClients`/`createClient`/`createSession`/`fetchMemoCards`에 적용
- [api.dashboard.ts](../../client/src/lib/api.dashboard.ts)의 대시보드 통계/월간 통계/캘린더 함수들은 전부 "내 것만 보기" 용도라, 앱단 `counselor_id` 필터를 아예 제거하고 RLS(`clients_select`/`sessions_select`)에 위임하도록 단순화

### 검증

tsc 클린, 테스트 37개 통과(관련 테스트 2개는 새 동작에 맞춰 갱신). 실제 화면에서 상담자 수 표시 확인.

### 후속 조치 완료

`counselors.auth_user_id` 연결을 테스트 계정 1명이 아니라 **실제 상담사 전원**에 대해 완료함. 각 상담사가 본인 계정으로 로그인하면 자신이 담당한 고객만 조회되는 것까지 확인함.

---

## 4. PostgREST 기본 max-rows(1000) 제한 대응

### 배경 / 문제

고객이 1000명을 넘으면 목록/통계에서 잘려 보였다. 프론트 하드코딩이 아니라 PostgREST의 기본 `db-max-rows`(기본값 1000) 제한 때문이었다.

### 조치

`fetchAllPages` 페이지네이션 헬퍼를 `api.ts`/`api.dashboard.ts` 각각에 추가하고, `.range()`로 1000개씩 끝까지 반복 조회하도록 `fetchClients`, `fetchDashboardStats`, `fetchDashboardMonthlyStats`, `fetchDashboardCalendarMonthCounts`, `fetchDashboardCalendarEntries`에 적용. 데이터 개수와 무관하게 항상 전체를 가져온다.

---

## 5. 상담사 계정 일괄 연결 (`public.user` 백필)

### 배경 / 문제

`counselors.auth_user_id`는 상담사 전원에 대해 연결했지만, 로그인 프로필 조회가 실제로 보는 `public.user`에는 일부 상담사가 빠져 있었다. 이 상태에서는 로그인 자체는 되지만(폴백 처리) 프론트의 `user.counselorId`가 비어버리고, 그 상태로 신규 고객을 등록하면 `counselor_id: null`이 전송되어 `new row violates row-level security policy for table "clients"` 에러가 났다. (반면 고객 "목록" 조회는 DB의 RLS가 자동으로 걸러주기 때문에 `public.user`가 없어도 우연히 정상 동작했다.)

### 조치

`counselors`에서 `auth_user_id`가 연결된 상담사를 전부 조회해 `public.user`에 한 번에 채워 넣는 SQL 제공 (이미 있는 계정은 `on conflict (user_id) do nothing`으로 건너뜀).

```sql
insert into public."user" (user_id, user_name, department, role)
select c.auth_user_id, c.name, c.branch, coalesce(c.role, 5)
from public.counselors c
where c.auth_user_id is not null
on conflict (user_id) do nothing;
```

### 검증

특정 상담사 계정으로 신규 고객 등록 재시도 → 아래 6번 항목(gender 제약)까지 같이 고친 뒤 등록 성공 확인.

---

## 6. 고객 등록 실패 / 인라인 수정 기능 전체가 옛 스키마를 참조하던 문제

### 배경 / 문제

5번을 해결한 뒤에도 고객 등록이 `new row for relation "clients" violates check constraint "clients_gender_check"`로 실패했다. `ClientRegister.tsx`가 성별을 옛 코드값(`'M'`/`'F'`)으로 보내는데, `clients.gender` 컬럼은 `CHECK (gender IN ('남', '여'))` 제약이 걸려 있었다.

이 문제를 조사하던 중 더 큰 문제를 같이 발견했다: `ClientDetail.tsx`의 **인라인 수정 기능(필드 클릭해서 바로 고치는 기능) 전체**가 여전히 옛 `client`(단수) 스키마 컬럼명(`client_name`, `phone_encrypted`, `gender_code`, `business_type_code`, `retest_stat` 등)으로 `updateClient`를 호출하고 있었다. 존재하지 않는 컬럼이라 저장 시도마다 에러가 났을 것으로 보인다.

### 조치

- [api.ts](../../client/src/lib/api.ts)에 `normalizeGender()` 추가 — `'M'/'F'`든 `'남'/'여'`든 정규화해서 저장. `createClient`/`updateClient` 양쪽에 적용
- [ClientDetail.tsx](../../client/src/pages/counselor/ClientDetail.tsx)의 `processField` 함수를 현재 실제 사용 중인 필드(20개) 기준으로 전면 재작성 — 옛 컬럼명 매핑(수십 줄) 제거, DB 컬럼명이 `ClientRow` 필드명과 대부분 동일해진 새 스키마에 맞게 단순화
- `SUCCESS_CASE_SYNC_FIELDS`(취업 성공사례 AI 동기화 트리거 필드 목록)도 새 필드명(`employment_date`/`employer`/`job_title`/`salary`)으로 갱신

### 검증

tsc 클린, 테스트 37개 통과. 사용자가 직접 신규 고객 등록 재시도 → **성공 확인**. 인라인 수정 기능도 실사용으로 **확인 완료**.

---

## 7. 고객 목록 스와이프 삭제 기능 추가 (신규 기능)

### 배경

고객 목록에서 항목을 왼쪽으로 스와이프하면 삭제 버튼이 나타나는 모바일 스타일 UX 요청.

### 조치

[ClientList.tsx](../../client/src/pages/counselor/ClientList.tsx)에 framer-motion(`drag="x"`)으로 구현:

- 행을 왼쪽으로 88px 이상 드래그하면 열림 상태로 스냅, 아니면 원위치로 스냅
- 삭제 버튼은 평소엔 행 콘텐츠 뒤에 완전히 가려져 있다가 스와이프해야만 드러남 (처음엔 `position: absolute`인 삭제 레이어가 CSS 쌓임 순서상 위로 떠서 평소에도 보이는 버그가 있었음 → 콘텐츠 레이어에 `z-10`, 삭제 레이어에 `z-0`을 명시해서 해결)
- 삭제 클릭 시 확인창 → `deleteClient()` 호출 → 성공 시 목록에서 즉시 제거 + 토스트, 실패 시 에러 토스트
- 삭제 중엔 버튼이 로딩 스피너로 전환되고 비활성화

### 검증

tsc 클린, 테스트 37개 통과. RLS의 `clients_delete` 정책(담당 상담사 본인 또는 관리자만 삭제 가능)은 `supabase_setup.sql`에 이미 있어 별도 DB 작업 불필요. 실사용으로 스와이프·삭제 동작 **확인 완료**.

---

## 8. 화면 세부 버그 수정

- **로고 클릭 시 대시보드 이동**: [DashboardLayout.tsx](../../client/src/components/DashboardLayout.tsx) 좌측 상단 로고를 `Link`로 감싸 클릭 시 이동하도록 추가. 관리자/상담사 역할에 따라 `/admin/dashboard` · `/dashboard`로 분기(상담사 전용 라우트라 역할 구분 필요).
- **ClientList.tsx 컬럼 필드명 불일치**: `IAP 수립일`(`iap_to`→`iap_date`), `사업유형`(`participate_type`→`business_type`) 컬럼이 스키마 마이그레이션 후에도 옛 필드명을 참조해 항상 빈 값으로 표시되던 문제 수정.
- **localStorage 컬럼 설정 자동 복구**: 위 필드명 변경과 별개로, 브라우저에 저장된 옛 컬럼 순서/너비 설정이 새 필드명 수정을 무시하는 문제가 있어, 유효하지 않은 저장 키는 걸러내고 새로 생긴 키는 자동으로 채워 넣는 로직 추가 — 앞으로 필드명이 또 바뀌어도 사용자가 수동으로 캐시를 지우지 않아도 됨.
- **AdminClientList.tsx 정렬 버그**: 이름 정렬 버튼이 옛 필드명(`client_name`)을 참조해 정렬이 동작하지 않던 문제 수정(`name`으로 교체).
- **AdminClientList.tsx 컬럼 추가**: 역량등급·점수·IAP수립일 컬럼 신설.

---

## 9. 취업 성공사례 AI 매칭 기능 이관 (`employmentSuccessCase.ts` + Edge Function)

### 배경 / 문제

참여단계를 "취업완료"로 바꿀 때마다 "취업성사자 기록(유사도) 저장에 실패했습니다" 경고가 뜨는 걸 실사용 중 발견. 1번 항목에서 미해결로 남겨뒀던 바로 그 기능이다 — `client/src/lib/employmentSuccessCase.ts`와 Edge Function 3개(`sync-employment-success-case`, `search-employment-success-case`, `summary-match-score`)가 전부 옛 `client`(단수, 정수 PK) 스키마를 참조하고 있었다.

`summary-match-score`(자격증/스펙 백분위 비교 기능)는 확인해보니 **어느 화면에서도 호출되지 않는 죽은 코드**였고, `client_certificates`/`work_tranning` 같은 새 스키마에 아예 없는 테이블에 의존하고 있어 고칠 수도 없는 상태라 이번 작업 범위에서 제외했다. 실제로 쓰이는 동기화(sync) + 유사사례 검색(search) 두 개만 이관했다.

### 조치

**클라이언트**
- [client/src/lib/employmentSuccessCase.ts](../../client/src/lib/employmentSuccessCase.ts): `client_id`(정수) 기반 스냅샷 저장 로직(`fetchClientEmploymentFields`, `updateClientEmploymentSnapshotFields`, `updateClientEmploymentSnapshotAndSync`, `patchEmploymentSuccessMetadata`) 전부 제거. `createClient`/`updateClient`가 이미 `clients` 테이블에 직접 취업 정보를 저장하므로 별도 스냅샷 단계가 불필요해짐 — Edge Function 호출(`syncEmploymentSuccessCase`, `searchEmploymentSuccessCases`, `backfillEmploymentSuccessCases`)만 남기고 `clientId`를 uuid 문자열로 전달하도록 단순화
- [api.ts](../../client/src/lib/api.ts) `createClient`에 `employer`/`job_title`/`employment_type`/`salary`/`employment_date` 필드 추가 (기존엔 저장 안 되고 있었음)
- [ClientRegister.tsx](../../client/src/pages/counselor/ClientRegister.tsx): 별도 스냅샷 업데이트 호출 제거, 취업완료로 등록 시 `syncEmploymentSuccessCase()`만 직접 호출
- `employmentSuccessCase.test.ts`: 제거된 함수 테스트 삭제, 나머지는 uuid 기준으로 갱신

**Edge Functions** (`supabase/functions/`)
- `_shared/employment-success.ts`: `EmploymentSourceRow` 타입을 `clients` 컬럼 기준으로 재작성 (`client_id`→`id`(uuid), `client_name`→`name`, `school_name`→`school`, `desired_job_1/2/3`→`desired_job`(단일), `hire_*`→`employer`/`job_title`/`employment_type`)
- `sync-employment-success-case/index.ts`, `search-employment-success-case/index.ts`: `.from('client')`→`.from('clients')`, `client_id`(number)→`id`(uuid string)로 전면 수정

**DB**
- `employment_success_case` 테이블 재생성 — `source_client_id`를 `integer references public.client(client_id)`에서 `uuid references public.clients(id)`로 변경 (기존 데이터 없음 확인 후 진행)
- `match_employment_success_case()` RPC 함수의 `exclude_client_id`/`source_client_id` 파라미터·반환 타입도 uuid로 변경
- GRANT + RLS 추가 (마스킹된 데이터라 조회는 인증된 상담사 전원 허용, 쓰기는 Edge Function의 service_role만)

### 검증

tsc 클린, 테스트 35개 통과(제거된 함수 테스트 2개 삭제로 37→35).

### 배포 매뉴얼 (Edge Function)

Edge Function은 클라이언트 빌드와 별개로 **Supabase CLI로 직접 배포**해야 코드가 반영된다. 이 프로젝트는 처음 연결하는 것이라 아래 순서로 진행:

1. **CLI 설치** (최초 1회)
   ```bash
   brew install supabase/tap/supabase
   ```
2. **로그인** (브라우저 인증)
   ```bash
   supabase login
   ```
3. **프로젝트 연결** (project ref는 `https://hmrnlmewgufzpxlfnrht.supabase.co`의 앞부분)
   ```bash
   cd /Users/wookhyun/Desktop/project/ZeniManager
   supabase link --project-ref hmrnlmewgufzpxlfnrht
   ```
   - DB 비밀번호를 물어보면 대시보드 Settings → Database에서 확인/재설정
4. **배포**
   ```bash
   supabase functions deploy sync-employment-success-case
   supabase functions deploy search-employment-success-case
   ```
   - `_shared/employment-success.ts`는 두 함수가 import하는 공용 코드라 별도 배포 명령 없이 자동으로 같이 번들링됨
5. 이후 함수 코드를 또 고치면 3번(link)은 다시 할 필요 없고 4번만 반복하면 됨

---

## 10. `participation_stage`(참여단계) 값이 앱이 가정한 5개보다 훨씬 다양함을 발견 → 자유 텍스트로 전환

### 배경 / 문제

실사용 중 "목록에는 초기상담인데 상세에는 취업완료로 다르게 보인다"는 제보로 조사를 시작했다. 처음엔 마이그레이션된 텍스트에 공백이 섞여 `<select>`가 정확 일치를 못 해 첫 옵션(초기상담)을 보여주는 것으로 의심하고 방어적으로 trim 처리를 넣었으나(아래 참고), 실제 원인은 더 근본적이었다:

```sql
select participation_stage, count(*) from public.clients group by participation_stage order by count(*) desc;
```

를 돌려보니 **`초기상담`/`심층상담`/`취업지원`/`취업완료`/`사후관리`라는 앱이 가정한 5개 값 중 정확히 일치하는 건 `취업지원`(120건)·`초기상담`(21건)뿐**이고, 나머지 1,600건 이상이 `취업`(563)/`구직활동`(555)/`만종`(105)/`중단`(67)/`만료`(42)/`사후만료`(34) 등 31개의 서로 다른 실제 상태값이었다. **"취업완료"라는 문자열은 단 한 건도 없었다.** 즉 이 필드는 국민취업지원제도 실무에서 쓰는 훨씬 세분화된 상태 체계이고, 앱의 5단계 드롭다운이 처음부터 현실을 반영하지 못하고 있었다.

이로 인해 드롭다운/토글 버튼은 값이 안 맞으면 그냥 첫 옵션을 보여주고, `participation_stage === '취업완료'` 같은 정확 비교를 쓰는 모든 KPI·필터(관리자 대시보드, 상담사별 취업완료 카운트 등)가 사실상 거의 항상 0에 가깝게 집계되고 있었다.

### 조치

**(1) 공백 방어 처리** (근본 원인은 아니었지만 안전장치로 유지)
- [api.ts](../../client/src/lib/api.ts), [api.dashboard.ts](../../client/src/lib/api.dashboard.ts)에 `trimOrNull()` 추가, `participation_stage`를 읽는 모든 지점에 적용

**(2) 입력 UI: 고정 드롭다운/버튼 → 자유 텍스트**
- [ClientList.tsx](../../client/src/pages/counselor/ClientList.tsx): 목록의 참여단계 `<select>` → 텍스트 입력(blur/Enter 시 저장)
- [ClientDetail.tsx](../../client/src/pages/counselor/ClientDetail.tsx): "관리 현황"의 참여단계 `type="select"` → 텍스트, 5단계 고정 진행바(Progress Tracker) 제거(실데이터 대부분에서 전부 비활성으로 보이는 오해 소지가 있었음)
- [ClientRegister.tsx](../../client/src/pages/counselor/ClientRegister.tsx): 등록 시 5개 고정 버튼 → 텍스트 입력 + `<datalist>` 자동완성(자주 쓰는 값 추천, 자유 입력도 가능)

**(3) KPI/집계 로직: 정확 일치 → 완화된 판정**
- [shared/const.ts](../../shared/const.ts)에 `isEmploymentCompletedStage()` 공용 헬퍼 추가 — `"취업"`을 포함하되 `"취업지원"`(아직 취업 전 지원 단계)만 제외하는 방식으로 판정
- 아래 5곳의 정확 일치(`=== '취업완료'`) 비교를 전부 이 헬퍼로 교체: `ClientList.tsx`(필터/뱃지), `api.dashboard.ts`(상담사 대시보드 통계 3개 지표), `AdminDashboard.tsx`(KPI 3곳), `CounselorList.tsx`(상담사별 취업완료 카운트 2곳), `ClientRegister.tsx`(취업정보 섹션 노출 조건)

### 검증

tsc 클린, 테스트 35개 통과.

### 아직 미해결 — 사용자 판단 대기 중

- **`AdminDashboard.tsx`의 "프로세스 단계별 인원" 차트**: 여전히 5개 고정 버킷만 카운트해서 실제 값 대부분이 차트에서 빠진다. 이건 단순 매칭 완화로 안 되고 "31개 실제 값을 몇 개 버킷으로 묶을지" 설계 결정이 필요함. 사용자가 나중에 방향(A: 5단계로 뭉치기 / B: 실제 값 그대로 보여주기) 알려주기로 함 — 그때 같이 처리.

---

## 다음 단계 (TODO)

- [x] `employmentSuccessCase.ts` + Edge Function(sync/search)을 `clients` 스키마 기준으로 이관 — 코드는 완료, **DB 마이그레이션 SQL 실행 + Edge Function 배포 + 실사용 검증은 아직**
- [ ] `summary-match-score` Edge Function — 어느 화면도 안 쓰는 죽은 코드로 확인됨. 다시 쓸지, 아예 삭제할지 결정 필요 (쓰려면 `client_certificates`/`work_tranning` 테이블 신설 필요)
- [ ] 스키마에서 빠진 필드(`score`, `iap_date`, `competency_grade` 등)가 실제로 값이 채워져 있는지 데이터 레벨에서 재확인 — 일부는 마이그레이션 시 빈 채로 넘어왔을 가능성
- [ ] 참여수당/자격증 등 스텁 처리된 기능을 다시 쓸지 여부 결정 (다시 쓰려면 해당 테이블 신설 필요)
- [ ] `AdminDashboard.tsx` "프로세스 단계별 인원" 차트 — 참여단계 실제 값(31종) 버킷팅 방향 결정 대기 (사용자가 추후 안내 예정)
- [x] `ClientDetail.tsx` 인라인 수정 기능 실사용 검증 — 확인 완료
- [x] 스와이프 삭제 기능 실사용 검증 — 확인 완료
