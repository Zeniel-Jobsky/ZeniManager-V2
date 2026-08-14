-- Summary match score feature: table verification + RLS baseline
-- Run this in the Supabase SQL editor for the live project that uses
-- client / client_certificates / work_tranning.

-- 1) Verify actual table names exist in the dashboard project.
select table_schema, table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('client', 'client_certificates', 'work_tranning', 'counsel_history');

-- 2) Check whether RLS is currently enabled.
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('client', 'client_certificates', 'work_tranning', 'counsel_history')
order by c.relname;

-- 3) Enable RLS if needed.
alter table public.client enable row level security;
alter table public.client_certificates enable row level security;
alter table public.work_tranning enable row level security;
alter table public.counsel_history enable row level security;

-- 4) Example policies.
-- Adjust admin role condition to match your real public.user.role mapping.

drop policy if exists client_select_self_or_admin on public.client;
create policy client_select_self_or_admin
on public.client
for select
using (
  counselor_id = auth.uid()
  or exists (
    select 1
    from public."user" u
    where u.user_id = auth.uid()
      and u.role = 4
  )
);

drop policy if exists client_certificates_select_self_or_admin on public.client_certificates;
create policy client_certificates_select_self_or_admin
on public.client_certificates
for select
using (
  exists (
    select 1
    from public.client c
    where c.client_id = client_certificates.client_id
      and (
        c.counselor_id = auth.uid()
        or exists (
          select 1
          from public."user" u
          where u.user_id = auth.uid()
            and u.role = 4
        )
      )
  )
);

drop policy if exists work_tranning_select_self_or_admin on public.work_tranning;
create policy work_tranning_select_self_or_admin
on public.work_tranning
for select
using (
  exists (
    select 1
    from public.client c
    where c.client_id = work_tranning.client_id
      and (
        c.counselor_id = auth.uid()
        or exists (
          select 1
          from public."user" u
          where u.user_id = auth.uid()
            and u.role = 4
        )
      )
  )
);

drop policy if exists counsel_history_select_self_or_admin on public.counsel_history;
create policy counsel_history_select_self_or_admin
on public.counsel_history
for select
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public."user" u
    where u.user_id = auth.uid()
      and u.role = 4
  )
);

-- 5) Check applied policies.
select schemaname, tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('client', 'client_certificates', 'work_tranning', 'counsel_history')
order by tablename, policyname;
