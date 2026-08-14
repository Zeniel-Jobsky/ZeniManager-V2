-- public.user 조회 + 개인 memo 수정 정책
-- role: 4 = 관리자, 5 = 상담사

grant select on table public."user" to authenticated;
grant update (memo) on table public."user" to authenticated;
revoke all on table public."user" from anon;

create or replace function public.is_current_user_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public."user" u
    where u.user_id = auth.uid()
      and u.role = 4
  );
$$;

revoke all on function public.is_current_user_admin() from public;
grant execute on function public.is_current_user_admin() to authenticated;

alter table public."user" enable row level security;

drop policy if exists user_select_self_or_admin on public."user";
create policy user_select_self_or_admin
on public."user"
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_current_user_admin()
);

drop policy if exists user_update_own_memo_or_admin on public."user";
create policy user_update_own_memo_or_admin
on public."user"
for update
to authenticated
using (
  user_id = auth.uid()
  or public.is_current_user_admin()
)
with check (
  user_id = auth.uid()
  or public.is_current_user_admin()
);
