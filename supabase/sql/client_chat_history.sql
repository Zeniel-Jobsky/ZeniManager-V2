create table if not exists public.client_chat_history (
  client_id integer primary key
    references public.client(client_id) on delete cascade,
  messages jsonb not null default '[]'::jsonb,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_chat_history_messages_array_check
    check (jsonb_typeof(messages) = 'array')
);

create index if not exists idx_client_chat_history_updated_at
  on public.client_chat_history(updated_at desc);

create or replace function public.set_client_chat_history_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_client_chat_history_updated_at'
  ) then
    create trigger trg_client_chat_history_updated_at
    before update on public.client_chat_history
    for each row
    execute function public.set_client_chat_history_updated_at();
  end if;
end
$$;

alter table public.client_chat_history enable row level security;

drop policy if exists client_chat_history_select_self_or_admin on public.client_chat_history;
create policy client_chat_history_select_self_or_admin
on public.client_chat_history
for select
using (
  exists (
    select 1
    from public.client c
    where c.client_id = client_chat_history.client_id
      and (
        c.counselor_id = auth.uid()
        or exists (
          select 1
          from public."user" u
          where u.user_id = auth.uid()
            and u.role = 1
        )
      )
  )
);

drop policy if exists client_chat_history_insert_self_or_admin on public.client_chat_history;
create policy client_chat_history_insert_self_or_admin
on public.client_chat_history
for insert
with check (
  exists (
    select 1
    from public.client c
    where c.client_id = client_chat_history.client_id
      and (
        c.counselor_id = auth.uid()
        or exists (
          select 1
          from public."user" u
          where u.user_id = auth.uid()
            and u.role = 1
        )
      )
  )
);

drop policy if exists client_chat_history_update_self_or_admin on public.client_chat_history;
create policy client_chat_history_update_self_or_admin
on public.client_chat_history
for update
using (
  exists (
    select 1
    from public.client c
    where c.client_id = client_chat_history.client_id
      and (
        c.counselor_id = auth.uid()
        or exists (
          select 1
          from public."user" u
          where u.user_id = auth.uid()
            and u.role = 1
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.client c
    where c.client_id = client_chat_history.client_id
      and (
        c.counselor_id = auth.uid()
        or exists (
          select 1
          from public."user" u
          where u.user_id = auth.uid()
            and u.role = 1
        )
      )
  )
);
