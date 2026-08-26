-- Hybrid application schema:
--   public."user".user_id         -> auth.users.id (profile and role)
--   public.counselors.auth_user_id -> auth.users.id
--   public.clients.counselor_id    -> public.counselors.id
--
-- Run supabase_user_rls.sql first, then run this file in the Supabase SQL Editor.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public."user"') IS NULL THEN
    RAISE EXCEPTION 'public.user does not exist';
  END IF;
  IF to_regclass('public.counselors') IS NULL THEN
    RAISE EXCEPTION 'public.counselors does not exist';
  END IF;
  IF to_regclass('public.clients') IS NULL THEN
    RAISE EXCEPTION 'public.clients does not exist';
  END IF;
  IF to_regprocedure('public.is_current_user_admin()') IS NULL THEN
    RAISE EXCEPTION 'Run supabase_user_rls.sql before this script';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.counselors
    WHERE auth_user_id IS NOT NULL
    GROUP BY auth_user_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate counselors.auth_user_id values exist; resolve them before applying this migration';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS counselors_auth_user_id_unique
  ON public.counselors (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

GRANT SELECT ON TABLE public.counselors TO authenticated;
REVOKE ALL ON TABLE public.counselors FROM anon;

ALTER TABLE public.counselors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS counselors_select_self_or_admin_by_auth ON public.counselors;
CREATE POLICY counselors_select_self_or_admin_by_auth
ON public.counselors
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (
  auth_user_id = auth.uid()
  OR public.is_current_user_admin()
);

-- Keep older broad SELECT policies from exposing other counselor mappings.
DROP POLICY IF EXISTS counselors_select_access_guard ON public.counselors;
CREATE POLICY counselors_select_access_guard
ON public.counselors
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  auth_user_id = auth.uid()
  OR public.is_current_user_admin()
);

CREATE OR REPLACE FUNCTION public.get_my_counselor_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id
  FROM public.counselors c
  WHERE c.auth_user_id = auth.uid()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_my_counselor_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_counselor_id() TO authenticated;

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clients_select_assigned_or_admin ON public.clients;
CREATE POLICY clients_select_assigned_or_admin
ON public.clients
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (
  counselor_id = public.get_my_counselor_id()
  OR public.is_current_user_admin()
);

-- Restrictive policies are ANDed with all permissive SELECT policies. This
-- guard prevents an older broad policy from widening client visibility.
DROP POLICY IF EXISTS clients_select_access_guard ON public.clients;
CREATE POLICY clients_select_access_guard
ON public.clients
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  counselor_id = public.get_my_counselor_id()
  OR public.is_current_user_admin()
);

COMMIT;
