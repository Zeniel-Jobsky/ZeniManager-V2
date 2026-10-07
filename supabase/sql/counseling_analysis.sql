-- Target: UUID-based public.clients schema. No legacy integer IDs are converted.
create table if not exists public.client_summary_analysis (
  client_id uuid primary key references public.clients(id) on delete cascade,
  structured_json jsonb not null default '{}'::jsonb,
  competency_scoring jsonb not null default '{}'::jsonb,
  recommendation jsonb not null default '{}'::jsonb,
  prompt_snapshot jsonb not null default '{}'::jsonb,
  file_refs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.client_counseling_analysis (
  client_id uuid primary key references public.clients(id) on delete cascade,
  source_hash text not null,
  result jsonb not null,
  sources jsonb not null,
  model text not null,
  generated_at timestamptz not null default now()
);
alter table public.client_summary_analysis enable row level security;
alter table public.client_counseling_analysis enable row level security;
revoke all on public.client_summary_analysis, public.client_counseling_analysis from public, anon, authenticated;
grant select, insert, update, delete on public.client_summary_analysis to authenticated;
grant select on public.client_counseling_analysis to authenticated;
grant all on public.client_summary_analysis, public.client_counseling_analysis to service_role;
create policy summary_assigned on public.client_summary_analysis for all to authenticated
using (exists (select 1 from public.clients c where c.id=client_summary_analysis.client_id and ((select public.is_current_user_admin()) or exists (select 1 from public.counselors co where co.id=c.counselor_id and co.auth_user_id=(select auth.uid())))))
with check (exists (select 1 from public.clients c where c.id=client_summary_analysis.client_id and ((select public.is_current_user_admin()) or exists (select 1 from public.counselors co where co.id=c.counselor_id and co.auth_user_id=(select auth.uid())))));
create policy counseling_analysis_assigned on public.client_counseling_analysis for select to authenticated
using (exists (select 1 from public.clients c where c.id=client_counseling_analysis.client_id and ((select public.is_current_user_admin()) or exists (select 1 from public.counselors co where co.id=c.counselor_id and co.auth_user_id=(select auth.uid())))));
notify pgrst, 'reload schema';
