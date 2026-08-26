-- Hybrid search PoC.
-- This file intentionally creates a new RPC instead of replacing match_manual_chunks.
-- Apply this in Supabase SQL Editor only when you want to test hybrid search.

create or replace function public.match_manual_chunks_hybrid(
  query_embedding_text text,
  keyword_terms text[] default '{}'::text[],
  match_count integer default 8,
  filter_document_id bigint default null,
  min_similarity double precision default 0,
  vector_weight double precision default 0.6,
  keyword_weight double precision default 0.4
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
  similarity double precision,
  keyword_score double precision,
  keyword_hits integer,
  matched_keywords text[],
  final_score double precision
)
language sql
stable
as $$
  with normalized_input as (
    select
      query_embedding_text::vector as query_embedding,
      coalesce(keyword_terms, '{}'::text[]) as terms,
      least(greatest(coalesce(match_count, 8), 1), 20) as safe_match_count,
      greatest(coalesce(vector_weight, 0.6), 0) as safe_vector_weight,
      greatest(coalesce(keyword_weight, 0.4), 0) as safe_keyword_weight
  ),
  candidates as (
    select
      mc.id,
      mc.document_id,
      md.title as document_title,
      md.version as document_version,
      mc.page_start,
      mc.page_end,
      mc.section_title,
      mc.chunk_text,
      1 - (mc.embedding <=> ni.query_embedding) as similarity,
      ni.terms,
      ni.safe_match_count,
      ni.safe_vector_weight,
      ni.safe_keyword_weight
    from public.manual_chunks mc
    join public.manual_documents md
      on md.id = mc.document_id
    cross join normalized_input ni
    where md.is_active = true
      and (filter_document_id is null or mc.document_id = filter_document_id)
      and (1 - (mc.embedding <=> ni.query_embedding)) >= coalesce(min_similarity, 0)
    order by mc.embedding <=> ni.query_embedding
    limit 80
  ),
  scored as (
    select
      c.*,
      coalesce(k.keyword_hits, 0) as keyword_hits,
      coalesce(k.matched_keywords, '{}'::text[]) as matched_keywords,
      case
        when cardinality(c.terms) = 0 then 0::double precision
        else coalesce(k.keyword_hits, 0)::double precision / cardinality(c.terms)::double precision
      end as keyword_score
    from candidates c
    left join lateral (
      select
        count(*)::integer as keyword_hits,
        array_agg(term order by term) as matched_keywords
      from unnest(c.terms) as term
      where length(btrim(term)) > 0
        and (
          c.chunk_text ilike '%' || term || '%'
          or coalesce(c.section_title, '') ilike '%' || term || '%'
        )
    ) k on true
  ),
  adjusted as (
    select
      s.*,
      case
        when (
          '구직촉진수당' = any(s.terms)
          and ('요건' = any(s.terms) or '조건' = any(s.terms) or '기준' = any(s.terms))
          and (
            coalesce(s.section_title, '') ilike '%지급대상%'
            or coalesce(s.section_title, '') ilike '%수급자격%'
            or coalesce(s.section_title, '') ilike '%Ⅰ유형 요건%'
            or s.chunk_text ilike '%구직촉진수당 수급요건%'
            or s.chunk_text ilike '%법 제7조에 따른 구직촉진수당 수급자격%'
          )
        ) then 0.16
        when (
          '구직촉진수당' = any(s.terms)
          and (
            coalesce(s.section_title, '') ilike '%지급기간%'
            or coalesce(s.section_title, '') ilike '%지급기준%'
            or coalesce(s.section_title, '') ilike '%신청 및 지급%'
          )
        ) then 0.08
        else 0
      end as context_boost,
      case
        when (
          coalesce(s.section_title, '') ilike '%부정수급%'
          or coalesce(s.section_title, '') ilike '%부정행위%'
          or coalesce(s.section_title, '') ilike '%반환명령%'
          or coalesce(s.section_title, '') ilike '%종료%'
          or coalesce(s.chunk_text, '') ilike '%부정행위 주요 유형%'
          or coalesce(s.chunk_text, '') ilike '%거짓신고%'
          or coalesce(s.chunk_text, '') ilike '%부정수급%'
          or coalesce(s.chunk_text, '') ilike '%취업성공수당%'
          or coalesce(s.chunk_text, '') ilike '%가족수당 지급 시 유의사항%'
          or coalesce(s.chunk_text, '') ilike '%가족수당 중복지급%'
        )
        and not (
          '부정수급' = any(s.terms)
          or '부정행위' = any(s.terms)
          or '반환명령' = any(s.terms)
          or '종료' = any(s.terms)
          or '취업성공수당' = any(s.terms)
          or '가족수당' = any(s.terms)
          or '부양가족' = any(s.terms)
        ) then 0.2
        else 0
      end as context_penalty
    from scored s
  )
  select
    a.id,
    a.document_id,
    a.document_title,
    a.document_version,
    a.page_start,
    a.page_end,
    a.section_title,
    a.chunk_text,
    a.similarity,
    a.keyword_score,
    a.keyword_hits,
    a.matched_keywords,
    greatest(0, least(1, case
      when (a.safe_vector_weight + a.safe_keyword_weight) = 0 then a.similarity
      else
        (
          a.similarity * a.safe_vector_weight
          + a.keyword_score * a.safe_keyword_weight
        ) / (a.safe_vector_weight + a.safe_keyword_weight)
    end + a.context_boost - a.context_penalty)) as final_score
  from adjusted a
  order by final_score desc, similarity desc, keyword_hits desc
  limit (select safe_match_count from normalized_input);
$$;

grant execute on function public.match_manual_chunks_hybrid(
  text,
  text[],
  integer,
  bigint,
  double precision,
  double precision,
  double precision
) to authenticated;

grant execute on function public.match_manual_chunks_hybrid(
  text,
  text[],
  integer,
  bigint,
  double precision,
  double precision,
  double precision
) to service_role;
