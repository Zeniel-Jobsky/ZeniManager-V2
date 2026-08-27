-- ─────────────────────────────────────────────────────────────────────────────
-- service_role 기본 권한 복구
--
-- 배경: service_role은 RLS는 우회하지만, 테이블 단위 GRANT는 별개로 필요하다.
-- 이 프로젝트는 지금까지 모든 GRANT를 authenticated에게만 줬고 service_role에는
-- 한 번도 명시적으로 준 적이 없어서, Edge Function(service_role로 동작)이
-- public.clients 등을 읽으려 할 때 "permission denied for table clients"(42501)가 발생했다.
-- (2026-08-27 sync-employment-success-case 호출 시 실제 발생 확인)
--
-- service_role은 클라이언트(브라우저)에 노출되지 않는 서버 전용 키이므로
-- public 스키마 전체에 넓게 권한을 줘도 안전하다. 신규 Supabase 프로젝트에는
-- 원래 기본으로 세팅돼 있어야 하는 값인데, 이 프로젝트는 빠져 있었다.
-- ─────────────────────────────────────────────────────────────────────────────

GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- 지금 이후 새로 만드는 테이블/시퀀스/함수에도 자동으로 적용되도록.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;

NOTIFY pgrst, 'reload schema';
