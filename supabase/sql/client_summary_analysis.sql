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

alter table public.client_summary_analysis
  add column if not exists file_refs jsonb not null default '[]'::jsonb;

alter table public.client_summary_analysis enable row level security;

drop policy if exists summary_assigned
on public.client_summary_analysis;

create policy summary_assigned
on public.client_summary_analysis
for all
using (
  exists (
    select 1
    from public.clients c
    where c.id = client_summary_analysis.client_id
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
    where c.id = client_summary_analysis.client_id
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
