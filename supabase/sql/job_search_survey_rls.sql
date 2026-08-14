-- job_search_survey RLS
-- Run this against the live Supabase project that contains public.job_search_survey.
-- Grants public."user" role-based access only to surveys tied to their own clients.
-- role: 4 = admin, 5 = counselor

create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public."user" u
    where u.user_id = auth.uid()
      and u.role = 4
  );
$$;

alter table public.job_search_survey enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_class
    where relkind = 'S'
      and relname = 'job_search_survey_survey_id_seq'
  ) then
    create sequence public.job_search_survey_survey_id_seq;
  end if;
end
$$;

alter sequence public.job_search_survey_survey_id_seq
owned by public.job_search_survey.survey_id;

select setval(
  'public.job_search_survey_survey_id_seq',
  coalesce((select max(survey_id) from public.job_search_survey), 0) + 1,
  false
);

alter table public.job_search_survey
alter column survey_id set default nextval('public.job_search_survey_survey_id_seq'::regclass);

drop policy if exists job_search_survey_select on public.job_search_survey;
create policy job_search_survey_select
on public.job_search_survey
for select
using (
  public.is_current_user_admin()
  or exists (
    select 1
    from public.client c
    where c.client_id = job_search_survey.client_id
      and c.counselor_id = auth.uid()
  )
);

drop policy if exists job_search_survey_insert on public.job_search_survey;
create policy job_search_survey_insert
on public.job_search_survey
for insert
with check (
  public.is_current_user_admin()
  or exists (
    select 1
    from public.client c
    where c.client_id = job_search_survey.client_id
      and c.counselor_id = auth.uid()
  )
);

drop policy if exists job_search_survey_update on public.job_search_survey;
create policy job_search_survey_update
on public.job_search_survey
for update
using (
  public.is_current_user_admin()
  or exists (
    select 1
    from public.client c
    where c.client_id = job_search_survey.client_id
      and c.counselor_id = auth.uid()
  )
)
with check (
  public.is_current_user_admin()
  or exists (
    select 1
    from public.client c
    where c.client_id = job_search_survey.client_id
      and c.counselor_id = auth.uid()
  )
);

drop policy if exists job_search_survey_delete on public.job_search_survey;
create policy job_search_survey_delete
on public.job_search_survey
for delete
using (
  public.is_current_user_admin()
  or exists (
    select 1
    from public.client c
    where c.client_id = job_search_survey.client_id
      and c.counselor_id = auth.uid()
  )
);
