# 채용공고 추천 Edge Function

내담자의 `public.clients.desired_job`을 로그인 사용자의 RLS 권한으로 읽은 뒤,
잡코리아·사람인·인크루트의 공개 검색 결과를 조회합니다.

## 배포

현재 앱은 `public."user".user_id = auth.users.id`,
`public.counselors.auth_user_id = auth.users.id`,
`public.clients.counselor_id = public.counselors.id` 관계를 사용합니다.
루트의 `supabase_user_rls.sql`을 실행한 뒤
`supabase/sql/job_recommendations_clients_rls.sql`을 실행합니다.

함수도 RLS 결과만 신뢰하지 않고 `auth.users.id`로 `public.counselors` 행을
찾아 실제 `clients.counselor_id`와 담당자 관계를 한 번 더 확인합니다.

```bash
supabase functions deploy recommend-job-postings
```

JWT 검증을 끄는 `--no-verify-jwt` 옵션은 사용하지 않습니다. 함수는
`SUPABASE_URL`, `SUPABASE_ANON_KEY` 기본 환경변수를 사용하며 service-role 키를
사용하지 않습니다.

## DB 희망직종으로 스모크 테스트

아래 읽기 전용 쿼리로 `clients.desired_job`이 입력되어 있고 담당 상담사 계정과
연결된 내담자를 찾습니다.

```sql
select
  c.id as client_id,
  c.name as client_name,
  c.desired_job,
  c.counselor_id,
  co.auth_user_id,
  u.user_name as counselor_name
from public.clients c
left join public.counselors co on co.id = c.counselor_id
left join public."user" u on u.user_id = co.auth_user_id
where nullif(btrim(c.desired_job), '') is not null
order by c.updated_at desc nulls last
limit 20;
```

조회된 `auth_user_id`의 상담사로 로그인한 뒤 해당 내담자 상세 화면의
`채용공고 추천` 탭을 엽니다. 검색 조건을 선택하고 `검색` 버튼을 누르면 브라우저는
`clientId`와 필터를 Edge Function으로 보내며, 검색어는 함수가 DB의 최신
`clients.desired_job`을 직접 조회해 사용합니다.

## 검색 필터 요청

`filters`는 선택 사항이므로 기존의 `{ "clientId": "..." }` 요청도 계속 동작합니다.
누락된 필터, 빈 배열, `any`는 모두 무관 조건으로 정규화됩니다.

```json
{
  "clientId": "00000000-0000-4000-8000-000000000000",
  "filters": {
    "education": ["bachelor", "master"],
    "experience": {
      "types": ["entry", "experienced"],
      "range": { "kind": "minimum-years", "years": 3 }
    },
    "regions": [
      { "code": "seoul/gangnam-gu", "label": "서울특별시 강남구" },
      { "code": "gyeonggi/suwon-si", "label": "경기도 수원시" }
    ]
  }
}
```

- 학력: `high-school-or-less`, `high-school`, `associate`, `bachelor`,
  `master`, `doctorate`, `post-doctorate` 중복 선택을 지원합니다.
- 경력 유형: `entry`, `experienced`를 중복 선택할 수 있습니다. 경력 연수는
  `experienced`를 선택했을 때만 `up-to-one-year` 또는 1~99의
  `minimum-years`를 사용할 수 있습니다.
- 지역: 시·도 또는 시·군·구를 최대 10개까지 선택합니다. 여러 지역은 OR,
  학력·경력·지역 그룹 사이는 AND로 적용됩니다. 시·도 선택은 그 하위 지역 전체를
  포함합니다.
- 구체적인 조건을 하나라도 선택한 범주에서는 공고의 `학력 무관`, `경력 무관`,
  `전국`/`지역 무관` 표기도 선택 조건과 정확히 일치하지 않는 것으로 보고 제외합니다.
  공고의 해당 정보를 판별할 수 없는 경우도 제외합니다. 사용자가 각 범주의 `무관`을
  선택해 canonical 필터가 비었을 때만 그 범주는 제한 없이 통과합니다.
- 필터는 사이트 HTML 파싱과 마감 공고 제거가 끝난 뒤 서버에서 다시 적용됩니다.
  응답의 사이트별 진단에는 `excludedExpired`, `excludedByFilter`,
  `excludedDuplicate`가 각각 별도 집계됩니다.
- 결과는 희망직종과 공고 제목의 완전 구문·토큰 일치도를 우선으로 정렬합니다. 동일한
  관련도에서는 선택 필터의 구체적 일치도, 등록일, 사이트와 공고 ID를 차례로 사용해
  언제나 같은 순서를 만듭니다. 사이트별 최대 12개를 자르기 전과 사이트 간 중복 제거
  후에 각각 정렬하므로 관련도가 높은 공고가 중간 제한에서 누락되지 않습니다.
- 성공 응답은 `filterContractVersion: 1`과 서버가 실제 적용한 canonical 필터의
  `appliedFilterKey`를 반환합니다. 클라이언트는 두 값을 요청값과 비교하여 필터 계약을
  지원하지 않는 오래된 함수 배포의 결과를 표시하지 않아야 합니다.

## 운영 주의사항

- 쉼표로 저장된 희망직종은 최대 3개로 분리합니다. 세 사이트는 병렬 조회하되 같은
  사이트의 직종별 요청은 순차 수행하며, 각 요청에 9초 timeout과 4 MiB 응답 제한을 적용합니다.
- 웜 Edge isolate에서는 성공 결과를 최대 10분, 전체 실패를 1분 캐시하고 동일 요청을
  병합합니다. 사용자가 명시적으로 새로고침하면 캐시를 우회하되 사용자·내담자별 30초
  cooldown을 적용합니다. 정규화된 학력·경력·지역 필터도 캐시와 cooldown 키에 포함되므로
  서로 다른 검색 조건의 결과가 섞이지 않습니다. 운영 환경에서도 Supabase 게이트웨이
  또는 앞단 WAF에 사용자별 rate limit을 설정합니다.
- 원문 HTML은 저장하거나 클라이언트에 반환하지 않습니다.
- 403, 429, CAPTCHA는 우회하지 않고 해당 사이트를 부분 실패로 표시합니다.
- 배포 운영자는 각 사이트의 최신 이용약관·robots.txt와 허용 호출 빈도를 주기적으로
  확인해야 합니다. HTML 선택자가 바뀌면 `_shared/job-postings`의 fixture 테스트와
  파서를 함께 갱신합니다.
