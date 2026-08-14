create extension if not exists vector;

create table if not exists public.employment_success_case (
  id bigint generated always as identity primary key,
  source_client_id integer not null unique
    references public.client(client_id) on delete cascade,

  masked_client_name text not null,
  age integer,
  age_decade text not null,
  education_level character varying,
  school_name character varying,
  major character varying,

  desired_job_1 text,
  desired_job_2 text,
  desired_job_3 text,

  employment_company character varying not null,
  employment_type character varying,
  employment_job_type character varying,
  employment_date date,
  source_participation_stage character varying not null default '취업완료',

  raw_text_used_for_embedding text not null,
  embedding vector(1536) not null,
  embedding_model text not null default 'text-embedding-3-small',

  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint employment_success_case_age_decade_check
    check (age_decade in ('10대', '20대', '30대', '40대', '50대', '60대 이상', '연령 미상')),
  constraint employment_success_case_masked_name_check
    check (length(btrim(masked_client_name)) > 0),
  constraint employment_success_case_company_check
    check (length(btrim(employment_company)) > 0),
  constraint employment_success_case_raw_text_check
    check (length(btrim(raw_text_used_for_embedding)) > 0)
);

create index if not exists idx_employment_success_case_active
  on public.employment_success_case (is_active);

create index if not exists idx_employment_success_case_age_decade
  on public.employment_success_case (age_decade);

create index if not exists idx_employment_success_case_education_level
  on public.employment_success_case (education_level);

create index if not exists idx_employment_success_case_major
  on public.employment_success_case (major);

create index if not exists idx_employment_success_case_employment_company
  on public.employment_success_case (employment_company);

create index if not exists idx_employment_success_case_employment_date
  on public.employment_success_case (employment_date);

create index if not exists idx_employment_success_case_source_participation_stage
  on public.employment_success_case (source_participation_stage);

create index if not exists idx_employment_success_case_embedding_hnsw
  on public.employment_success_case
  using hnsw (embedding vector_cosine_ops);

create or replace function public.set_employment_success_case_updated_at()
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
    where tgname = 'trg_employment_success_case_updated_at'
  ) then
    create trigger trg_employment_success_case_updated_at
    before update on public.employment_success_case
    for each row
    execute function public.set_employment_success_case_updated_at();
  end if;
end
$$;
