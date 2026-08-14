create table if not exists public.client_summary_analysis (
  id bigint generated always as identity primary key,
  client_id integer not null unique references public.client(client_id) on delete cascade,
  structured_json jsonb not null default '{}'::jsonb,
  competency_scoring jsonb not null default '{}'::jsonb,
  recommendation jsonb not null default '{}'::jsonb,
  prompt_snapshot jsonb not null default '{}'::jsonb,
  file_refs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.client_summary_analysis
  add column if not exists file_refs jsonb not null default '[]'::jsonb;

create index if not exists idx_client_summary_analysis_client_id
  on public.client_summary_analysis(client_id);

alter table public.client_summary_analysis enable row level security;

drop policy if exists client_summary_analysis_select_self_or_admin on public.client_summary_analysis;
create policy client_summary_analysis_select_self_or_admin
on public.client_summary_analysis
for select
using (
  exists (
    select 1
    from public.client c
    where c.client_id = client_summary_analysis.client_id
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

drop policy if exists client_summary_analysis_upsert_self_or_admin on public.client_summary_analysis;
create policy client_summary_analysis_upsert_self_or_admin
on public.client_summary_analysis
for all
using (
  exists (
    select 1
    from public.client c
    where c.client_id = client_summary_analysis.client_id
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
)
with check (
  exists (
    select 1
    from public.client c
    where c.client_id = client_summary_analysis.client_id
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
