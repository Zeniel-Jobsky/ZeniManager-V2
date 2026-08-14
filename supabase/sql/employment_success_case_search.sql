create or replace function public.match_employment_success_case(
  query_embedding_text text,
  match_count integer default 10,
  exclude_client_id integer default null
)
returns table (
  id bigint,
  source_client_id integer,
  masked_client_name text,
  age_decade text,
  education_level character varying,
  major character varying,
  employment_company character varying,
  employment_type character varying,
  employment_job_type character varying,
  employment_date date,
  similarity double precision
)
language sql
stable
as $$
  select
    esc.id,
    esc.source_client_id,
    esc.masked_client_name,
    esc.age_decade,
    esc.education_level,
    esc.major,
    esc.employment_company,
    esc.employment_type,
    esc.employment_job_type,
    esc.employment_date,
    1 - (esc.embedding <=> query_embedding_text::vector) as similarity
  from public.employment_success_case esc
  where esc.is_active = true
    and (exclude_client_id is null or esc.source_client_id <> exclude_client_id)
  order by esc.embedding <=> query_embedding_text::vector
  limit least(greatest(coalesce(match_count, 10), 1), 20);
$$;
