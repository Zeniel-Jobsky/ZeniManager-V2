create extension if not exists vector;

create table if not exists public.manual_documents (
  id bigint generated always as identity primary key,
  title text not null,
  version text not null,
  source_type text not null default 'pdf'
    check (source_type in ('pdf', 'url', 'text')),
  source_url text,
  storage_bucket text,
  storage_path text,
  published_at date,
  uploaded_by uuid references auth.users(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint manual_documents_title_check
    check (length(btrim(title)) > 0),
  constraint manual_documents_version_check
    check (length(btrim(version)) > 0)
);

create table if not exists public.manual_chunks (
  id bigint generated always as identity primary key,
  document_id bigint not null
    references public.manual_documents(id) on delete cascade,
  chunk_index integer not null,
  page_start integer,
  page_end integer,
  section_title text,
  chunk_text text not null,
  token_count integer,
  embedding vector(1536) not null,
  embedding_model text not null default 'text-embedding-3-small',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint manual_chunks_chunk_index_check
    check (chunk_index >= 0),
  constraint manual_chunks_page_start_check
    check (page_start is null or page_start > 0),
  constraint manual_chunks_page_end_check
    check (page_end is null or page_end > 0),
  constraint manual_chunks_page_range_check
    check (page_start is null or page_end is null or page_start <= page_end),
  constraint manual_chunks_text_check
    check (length(btrim(chunk_text)) > 0),
  constraint manual_chunks_token_count_check
    check (token_count is null or token_count > 0),
  constraint manual_chunks_document_index_unique
    unique (document_id, chunk_index)
);

create table if not exists public.manual_chat_logs (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  question text not null,
  answer text,
  cited_chunk_ids bigint[] not null default '{}'::bigint[],
  confidence text,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint manual_chat_logs_question_check
    check (length(btrim(question)) > 0),
  constraint manual_chat_logs_confidence_check
    check (confidence is null or confidence in ('high', 'medium', 'low', 'insufficient'))
);

create index if not exists idx_manual_documents_active
  on public.manual_documents (is_active);

create index if not exists idx_manual_documents_version
  on public.manual_documents (version);

create index if not exists idx_manual_chunks_document_id
  on public.manual_chunks (document_id);

create index if not exists idx_manual_chunks_page_start
  on public.manual_chunks (page_start);

create index if not exists idx_manual_chunks_embedding_hnsw
  on public.manual_chunks
  using hnsw (embedding vector_cosine_ops);

create index if not exists idx_manual_chat_logs_user_created_at
  on public.manual_chat_logs (user_id, created_at desc);

create or replace function public.set_manual_documents_updated_at()
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
    where tgname = 'trg_manual_documents_updated_at'
  ) then
    create trigger trg_manual_documents_updated_at
    before update on public.manual_documents
    for each row
    execute function public.set_manual_documents_updated_at();
  end if;
end
$$;

create or replace function public.match_manual_chunks(
  query_embedding_text text,
  match_count integer default 8,
  filter_document_id bigint default null,
  min_similarity double precision default 0
)
returns table (
  id bigint,
  document_id bigint,
  document_title text,
  document_version text,
  page_start integer,
  page_end integer,
  section_title text,
  chunk_text text,
  similarity double precision
)
language sql
stable
as $$
  select
    mc.id,
    mc.document_id,
    md.title as document_title,
    md.version as document_version,
    mc.page_start,
    mc.page_end,
    mc.section_title,
    mc.chunk_text,
    1 - (mc.embedding <=> query_embedding_text::vector) as similarity
  from public.manual_chunks mc
  join public.manual_documents md
    on md.id = mc.document_id
  where md.is_active = true
    and (filter_document_id is null or mc.document_id = filter_document_id)
    and (1 - (mc.embedding <=> query_embedding_text::vector)) >= coalesce(min_similarity, 0)
  order by mc.embedding <=> query_embedding_text::vector
  limit least(greatest(coalesce(match_count, 8), 1), 20);
$$;

alter table public.manual_documents enable row level security;
alter table public.manual_chunks enable row level security;
alter table public.manual_chat_logs enable row level security;

drop policy if exists manual_documents_select_authenticated on public.manual_documents;
create policy manual_documents_select_authenticated
on public.manual_documents
for select
to authenticated
using (true);

drop policy if exists manual_chunks_select_authenticated on public.manual_chunks;
create policy manual_chunks_select_authenticated
on public.manual_chunks
for select
to authenticated
using (
  exists (
    select 1
    from public.manual_documents md
    where md.id = manual_chunks.document_id
      and md.is_active = true
  )
);

drop policy if exists manual_chat_logs_select_own_or_admin on public.manual_chat_logs;
create policy manual_chat_logs_select_own_or_admin
on public.manual_chat_logs
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public."user" u
    where u.user_id = auth.uid()
      and u.role = 4
  )
);

drop policy if exists manual_chat_logs_insert_own on public.manual_chat_logs;
create policy manual_chat_logs_insert_own
on public.manual_chat_logs
for insert
to authenticated
with check (user_id = auth.uid());

-- 관리자용 문서/청크 적재 정책입니다.
-- 초기 PoC에서는 SQL Editor 또는 service role Edge Function으로 적재해도 됩니다.
drop policy if exists manual_documents_admin_all on public.manual_documents;
create policy manual_documents_admin_all
on public.manual_documents
for all
to authenticated
using (
  exists (
    select 1
    from public."user" u
    where u.user_id = auth.uid()
      and u.role = 4
  )
)
with check (
  exists (
    select 1
    from public."user" u
    where u.user_id = auth.uid()
      and u.role = 4
  )
);

drop policy if exists manual_chunks_admin_all on public.manual_chunks;
create policy manual_chunks_admin_all
on public.manual_chunks
for all
to authenticated
using (
  exists (
    select 1
    from public."user" u
    where u.user_id = auth.uid()
      and u.role = 4
  )
)
with check (
  exists (
    select 1
    from public."user" u
    where u.user_id = auth.uid()
      and u.role = 4
  )
);

grant select on public.manual_documents to authenticated;
grant select on public.manual_chunks to authenticated;
grant select, insert on public.manual_chat_logs to authenticated;
grant execute on function public.match_manual_chunks(text, integer, bigint, double precision)
  to authenticated;

grant select, insert, update, delete on public.manual_documents to service_role;
grant select, insert, update, delete on public.manual_chunks to service_role;
grant select, insert, update, delete on public.manual_chat_logs to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on function public.match_manual_chunks(text, integer, bigint, double precision)
  to service_role;
