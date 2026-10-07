create table if not exists public.client_counseling_analysis (
  client_id uuid primary key references public.clients(id) on delete cascade,
  source_hash text not null,
  result jsonb not null,
  sources jsonb not null default '{}'::jsonb,
  model text not null,
  generated_at timestamptz not null default now()
);

alter table public.client_counseling_analysis enable row level security;

drop policy if exists counseling_analysis_assigned
on public.client_counseling_analysis;

create policy counseling_analysis_assigned
on public.client_counseling_analysis
for select
using (
  exists (
    select 1
    from public.clients c
    where c.id = client_counseling_analysis.client_id
      and (
        (select public.is_current_user_admin())
        or exists (
          select 1
          from public.counselors co
          where co.id = c.counselor_id
            and co.auth_user_id = (select auth.uid())
        )
      )
  )
);

drop policy if exists counseling_analysis_insert_assigned
on public.client_counseling_analysis;

create policy counseling_analysis_insert_assigned
on public.client_counseling_analysis
for insert
with check (
  exists (
    select 1
    from public.clients c
    where c.id = client_counseling_analysis.client_id
      and (
        (select public.is_current_user_admin())
        or exists (
          select 1
          from public.counselors co
          where co.id = c.counselor_id
            and co.auth_user_id = (select auth.uid())
        )
      )
  )
);

drop policy if exists counseling_analysis_update_assigned
on public.client_counseling_analysis;

create policy counseling_analysis_update_assigned
on public.client_counseling_analysis
for update
using (
  exists (
    select 1
    from public.clients c
    where c.id = client_counseling_analysis.client_id
      and (
        (select public.is_current_user_admin())
        or exists (
          select 1
          from public.counselors co
          where co.id = c.counselor_id
            and co.auth_user_id = (select auth.uid())
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.clients c
    where c.id = client_counseling_analysis.client_id
      and (
        (select public.is_current_user_admin())
        or exists (
          select 1
          from public.counselors co
          where co.id = c.counselor_id
            and co.auth_user_id = (select auth.uid())
        )
      )
  )
);
