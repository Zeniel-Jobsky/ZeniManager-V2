-- Prevent a counselor from changing their own row to the administrator role.
-- Run once in the Supabase SQL Editor for an existing deployment.
BEGIN;

DROP POLICY IF EXISTS "counselors_update" ON public.counselors;

CREATE POLICY "counselors_update"
ON public.counselors
FOR UPDATE
USING (
  public.is_admin()
  OR (auth_user_id = auth.uid() AND role = 5)
)
WITH CHECK (
  public.is_admin()
  OR (auth_user_id = auth.uid() AND role = 5)
);

DROP POLICY IF EXISTS "counselors_update_guard" ON public.counselors;
CREATE POLICY "counselors_update_guard"
ON public.counselors
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (
  public.is_admin()
  OR (auth_user_id = auth.uid() AND role = 5)
)
WITH CHECK (
  public.is_admin()
  OR (auth_user_id = auth.uid() AND role = 5)
);

CREATE UNIQUE INDEX IF NOT EXISTS counselors_auth_user_id_unique
  ON public.counselors (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

COMMIT;
