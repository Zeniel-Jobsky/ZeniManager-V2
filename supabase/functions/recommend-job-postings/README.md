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
`채용공고 추천` 탭을 엽니다. 브라우저는 `clientId`만 Edge Function으로 보내며,
검색어는 함수가 DB의 최신 `clients.desired_job`을 직접 조회해 사용합니다.

## 운영 주의사항

- 쉼표로 저장된 희망직종은 최대 3개로 분리합니다. 세 사이트는 병렬 조회하되 같은
  사이트의 직종별 요청은 순차 수행하며, 각 요청에 9초 timeout과 4 MiB 응답 제한을 적용합니다.
- 웜 Edge isolate에서는 성공 결과를 최대 10분, 전체 실패를 1분 캐시하고 동일 요청을
  병합합니다. 사용자가 명시적으로 새로고침하면 캐시를 우회하되 사용자·내담자별 30초
  cooldown을 적용합니다. 운영 환경에서도 Supabase 게이트웨이 또는 앞단 WAF에 사용자별 rate limit을 설정합니다.
- 원문 HTML은 저장하거나 클라이언트에 반환하지 않습니다.
- 403, 429, CAPTCHA는 우회하지 않고 해당 사이트를 부분 실패로 표시합니다.
- 배포 운영자는 각 사이트의 최신 이용약관·robots.txt와 허용 호출 빈도를 주기적으로
  확인해야 합니다. HTML 선택자가 바뀌면 `_shared/job-postings`의 fixture 테스트와
  파서를 함께 갱신합니다.
