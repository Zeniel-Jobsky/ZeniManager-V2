import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {
  buildEmbeddingText,
  buildMatchReason,
  clampLimit,
  createEmbedding,
  majorMatchLevel,
  normalizeText,
  resolveOpenAIKey,
  toAgeDecade,
  type EmploymentSourceRow,
  type SearchCandidateRow,
  vectorLiteral,
} from '../_shared/employment-success.ts';

type RequestBody = {
  clientId?: number;
  limit?: number;
  openAIKey?: string;
};

type SearchResult = {
  id: string;
  sourceClientId: string;
  maskedClientName: string;
  ageDecade: string;
  educationLevel: string | null;
  major: string | null;
  employmentCompany: string;
  employmentType: string | null;
  employmentJobType: string | null;
  employmentDate: string | null;
  similarity: number;
  rerankScore: number;
  matchReason: string;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CLIENT_SELECT_FIELDS = [
  'client_id',
  'client_name',
  'age',
  'education_level',
  'school_name',
  'major',
  'desired_job_1',
  'desired_job_2',
  'desired_job_3',
  'participation_stage',
  'hire_place',
  'hire_type',
  'hire_job_type',
  'hire_date',
  'job_place_start',
].join(', ');

Deno.serve(async request => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const admin = createAdminClient();
    const body = await readBody(request);
    const clientId = Number(body.clientId);

    if (!Number.isFinite(clientId)) {
      return json({ error: 'clientId가 필요합니다.' }, 400);
    }

    const sourceClient = await fetchClientById(admin, clientId);
    if (!sourceClient) {
      return json({ error: '상담자 데이터를 찾을 수 없습니다.' }, 404);
    }

    const apiKey = resolveOpenAIKey(body.openAIKey);
    const limit = clampLimit(body.limit, 3, 10);
    const queryText = buildEmbeddingText(sourceClient, { includeEmployment: false });
    const queryEmbedding = await createEmbedding(apiKey, queryText);

    const { data, error } = await admin.rpc('match_employment_success_case', {
      query_embedding_text: vectorLiteral(queryEmbedding),
      match_count: Math.max(limit * 3, 10),
      exclude_client_id: clientId,
    });

    if (error) throw error;

    const reranked = ((data ?? []) as SearchCandidateRow[])
      .map(candidate => rerankCandidate(sourceClient, candidate))
      .sort((left, right) => right.rerankScore - left.rerankScore);

    const ranked = preferSameAgeDecadeResults(sourceClient, reranked, limit);

    return json({
      summary: buildSummary(ranked),
      results: ranked,
      evaluatedCount: Array.isArray(data) ? data.length : 0,
      reason: ranked.length > 0 ? null : 'NO_MATCH',
    });
  } catch (error) {
    console.error('[search-employment-success-case] failed', error);
    return json(
      {
        error: error instanceof Error ? error.message : '유사 취업사례 검색 중 오류가 발생했습니다.',
      },
      500,
    );
  }
});

function createAdminClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

async function readBody(request: Request): Promise<RequestBody> {
  if (request.headers.get('content-length') === '0') {
    return {};
  }

  try {
    return await request.json() as RequestBody;
  } catch {
    return {};
  }
}

async function fetchClientById(
  admin: ReturnType<typeof createClient>,
  clientId: number,
): Promise<EmploymentSourceRow | null> {
  const { data, error } = await admin
    .from('client')
    .select(CLIENT_SELECT_FIELDS)
    .eq('client_id', clientId)
    .maybeSingle();

  if (error) throw error;
  return (data as EmploymentSourceRow | null) ?? null;
}

function rerankCandidate(source: EmploymentSourceRow, candidate: SearchCandidateRow): SearchResult {
  const sourceAgeDecade = toAgeDecade(source.age);
  const sourceEducation = normalizeText(source.education_level);
  const candidateEducation = normalizeText(candidate.education_level);
  const sourceMajor = normalizeText(source.major);
  const candidateMajor = normalizeText(candidate.major);
  const similarity = clampSimilarity(candidate.similarity);

  const ageMatched = sourceAgeDecade === candidate.age_decade;
  const educationMatched = Boolean(sourceEducation && candidateEducation && sourceEducation === candidateEducation);
  const educationMismatched = Boolean(sourceEducation && candidateEducation && !educationMatched);
  const majorLevel = majorMatchLevel(sourceMajor, candidateMajor);
  const majorMatched = majorLevel === 'exact';
  const majorPartialMatched = majorLevel === 'partial';
  const majorMismatched = Boolean(sourceMajor && candidateMajor && majorLevel === 'none');

  const vectorScore = similarity * 45;
  const ageScore = ageMatched ? 18 : -12;
  const educationScore = educationMatched ? 18 : educationMismatched ? -8 : 0;
  const majorScore = majorMatched ? 22 : majorPartialMatched ? 10 : majorMismatched ? -10 : 0;

  const rerankScore =
    vectorScore +
    ageScore +
    educationScore +
    majorScore;

  return {
    id: String(candidate.id),
    sourceClientId: String(candidate.source_client_id),
    maskedClientName: candidate.masked_client_name,
    ageDecade: candidate.age_decade,
    educationLevel: candidate.education_level,
    major: candidate.major,
    employmentCompany: candidate.employment_company,
    employmentType: candidate.employment_type,
    employmentJobType: candidate.employment_job_type,
    employmentDate: candidate.employment_date,
    similarity,
    rerankScore: Math.round(rerankScore * 10) / 10,
    matchReason: buildMatchReason(similarity, {
      ageMatched,
      educationMatched,
      majorMatched,
      majorPartialMatched,
    }),
  };
}

function preferSameAgeDecadeResults(
  source: EmploymentSourceRow,
  results: SearchResult[],
  limit: number,
): SearchResult[] {
  if (results.length === 0) return results;

  const sourceAgeDecade = toAgeDecade(source.age);
  if (sourceAgeDecade === '연령 미상') {
    return results.slice(0, limit);
  }

  const matchedAgeResults = results.filter(result => result.ageDecade === sourceAgeDecade);
  if (matchedAgeResults.length > 0) {
    return matchedAgeResults.slice(0, limit);
  }

  return results.slice(0, limit);
}

function buildSummary(results: SearchResult[]): string {
  if (results.length === 0) {
    return '현재 조건과 유사한 취업 성공사례가 아직 충분하지 않습니다.';
  }

  const ageLabel = joinDistinctValues(results.map(result => result.ageDecade));
  const educationLabel = mostCommonLabel(results.map(result => result.educationLevel));
  const majorLabel = mostCommonLabel(results.map(result => result.major));
  const topCompanies = Array.from(new Set(results.map(result => result.employmentCompany))).slice(0, 3);
  const profileLabel = [ageLabel, educationLabel, majorLabel]
    .filter((value): value is string => Boolean(value))
    .join(' / ') || '유사 프로필';

  return `유사 사례 ${results.length}건 기준, ${profileLabel} 배경에서 ${topCompanies.join(', ')} 취업 사례가 확인되었습니다.`;
}

function joinDistinctValues(values: Array<string | null | undefined>): string | null {
  const uniqueValues = Array.from(
    new Set(values.map(value => normalizeText(value)).filter((value): value is string => Boolean(value))),
  );

  if (uniqueValues.length === 0) return null;
  if (uniqueValues.length === 1) return uniqueValues[0];
  return uniqueValues.join(', ');
}

function mostCommonLabel(values: Array<string | null | undefined>): string | null {
  const counts = new Map<string, number>();

  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }

  let winner: string | null = null;
  let winnerCount = 0;

  for (const [value, count] of counts.entries()) {
    if (count > winnerCount) {
      winner = value;
      winnerCount = count;
    }
  }

  return winner;
}

function clampSimilarity(value: number | null | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}
