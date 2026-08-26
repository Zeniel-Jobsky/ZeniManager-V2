import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

type SupabaseAdminClient = ReturnType<typeof createClient<any>>;

type RequestBody = {
  question?: string;
  documentId?: number | null;
  limit?: number;
  minSimilarity?: number;
};

type SearchMode = 'vector' | 'hybrid';

type ManualChunkMatch = {
  id: number;
  document_id: number;
  document_title: string;
  document_version: string;
  page_start: number | null;
  page_end: number | null;
  section_title: string | null;
  chunk_text: string;
  similarity: number | null;
  keyword_score?: number | null;
  keyword_hits?: number | null;
  matched_keywords?: string[] | null;
  final_score?: number | null;
};

type ManualAnswer = {
  answer: string;
  confidence: 'high' | 'medium' | 'low' | 'insufficient';
  citations: Array<{
    chunkId: number;
    documentTitle: string;
    documentVersion: string;
    pageStart: number | null;
    pageEnd: number | null;
    sectionTitle: string | null;
    similarity: number | null;
    keywordScore?: number | null;
    keywordHits?: number | null;
    matchedKeywords?: string[];
    finalScore?: number | null;
    excerpt: string;
  }>;
  reason: string | null;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EMBEDDING_MODEL = Deno.env.get('OPENAI_EMBEDDING_MODEL') || 'text-embedding-3-small';
const ANSWER_MODEL = Deno.env.get('OPENAI_ANSWER_MODEL') || 'gpt-4o-mini';
const SEARCH_MODE = normalizeSearchMode(Deno.env.get('MANUAL_CHAT_SEARCH_MODE'));
const MIN_TOP_SIMILARITY_FOR_ANSWER = clampNumber(
  Deno.env.get('MANUAL_CHAT_MIN_TOP_SIMILARITY'),
  0.6,
  0,
  0.95,
);
const MIN_FINAL_SCORE_FOR_ANSWER = clampNumber(
  Deno.env.get('MANUAL_CHAT_MIN_FINAL_SCORE'),
  0.45,
  0,
  0.95,
);
const VECTOR_WEIGHT = clampNumber(Deno.env.get('MANUAL_CHAT_VECTOR_WEIGHT'), 0.6, 0, 1);
const KEYWORD_WEIGHT = clampNumber(Deno.env.get('MANUAL_CHAT_KEYWORD_WEIGHT'), 0.4, 0, 1);

Deno.serve(async request => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({ error: 'POST 요청만 지원합니다.' }, 405);
  }

  try {
    const admin = createAdminClient();
    const userId = await resolveUserId(admin, request);
    const body = await readBody(request);
    const question = normalizeText(body.question);

    if (!question) {
      return json({ error: '질문을 입력해주세요.' }, 400);
    }

    const limit = clampNumber(body.limit, 5, 1, 12);
    const minSimilarity = clampNumber(body.minSimilarity, 0.15, 0, 0.95);
    const keywords = extractManualKeywords(question);
    const queryEmbedding = await createEmbedding(question);
    const matches = await searchManualChunks(admin, {
      question,
      keywords,
      queryEmbedding,
      documentId: normalizeOptionalNumber(body.documentId),
      limit,
      minSimilarity,
    });

    if (matches.length === 0) {
      const payload: ManualAnswer = {
        answer: '제공된 매뉴얼 근거만으로는 답변을 확인할 수 없습니다. 질문 표현을 바꾸거나 관련 키워드를 더 구체적으로 입력해주세요.',
        confidence: 'insufficient',
        citations: [],
        reason: 'NO_RELEVANT_MANUAL_CHUNKS',
      };
      await insertChatLog(admin, userId, question, payload);
      return json(payload);
    }

    const relevanceFailure = getRelevanceFailure(matches, keywords);
    if (relevanceFailure) {
      const payload: ManualAnswer = {
        answer: relevanceFailure.message,
        confidence: 'insufficient',
        citations: matches.slice(0, 3).map(matchToCitation),
        reason: relevanceFailure.reason,
      };
      await insertChatLog(admin, userId, question, payload);
      return json(payload);
    }

    const answer = await createGroundedAnswer(question, matches);
    await insertChatLog(admin, userId, question, answer);
    return json(answer);
  } catch (error) {
    console.error('[manual-chat] failed', error);
    return json(
      {
        error: error instanceof Error ? error.message : '매뉴얼 답변 생성 중 오류가 발생했습니다.',
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

async function resolveUserId(
  admin: SupabaseAdminClient,
  request: Request,
): Promise<string | null> {
  const authorization = request.headers.get('Authorization');
  const token = authorization?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  const { data, error } = await admin.auth.getUser(token);
  if (error) {
    console.warn('[manual-chat] failed to resolve user token', error.message);
    return null;
  }

  return data.user?.id ?? null;
}

async function readBody(request: Request): Promise<RequestBody> {
  try {
    return await request.json() as RequestBody;
  } catch {
    return {};
  }
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeSearchMode(value: unknown): SearchMode {
  return value === 'vector' ? 'vector' : 'hybrid';
}

function extractManualKeywords(question: string): string[] {
  const stopwords = new Set([
    '무엇인가요',
    '무엇',
    '어떤',
    '경우',
    '알려줘',
    '정리해줘',
    '그리고',
    '또는',
    '있나요',
    '해주세요',
  ]);
  const expansions: Record<string, string[]> = {
    '1유형': ['Ⅰ유형', 'I유형', '일유형', '구직촉진수당', '취업지원서비스'],
    '2유형': ['Ⅱ유형', 'II유형', '이유형', '취업활동비용', '취업지원서비스'],
    I유형: ['Ⅰ유형', '1유형', '일유형', '구직촉진수당', '취업지원서비스'],
    II유형: ['Ⅱ유형', '2유형', '이유형', '취업활동비용', '취업지원서비스'],
    'Ⅰ유형': ['1유형', 'I유형', '일유형', '구직촉진수당', '취업지원서비스'],
    'Ⅱ유형': ['2유형', 'II유형', '이유형', '취업활동비용', '취업지원서비스'],
    일유형: ['Ⅰ유형', '1유형', 'I유형', '구직촉진수당', '취업지원서비스'],
    이유형: ['Ⅱ유형', '2유형', 'II유형', '취업활동비용', '취업지원서비스'],
    요건: ['조건', '기준', '수급자격', '수급 자격'],
    조건: ['요건', '기준'],
    기준: ['요건', '조건'],
    차이: ['비교', '구분', '지원내용', '지원 내용'],
    비교: ['차이', '구분', '지원내용', '지원 내용'],
    지원: ['지원내용', '지원 내용', '취업지원서비스'],
    지원내용: ['지원 내용', '취업지원서비스', '구직촉진수당', '취업활동비용'],
    지급: ['지급 여부', '지급대상'],
    참여자: ['수급자', '지원대상'],
    사후관리: ['취업유지', '근속', '취업성공수당'],
    불참: ['미참여', '중단', '제재'],
  };

  const baseTerms = question
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map(normalizeKoreanSearchTerm)
    .filter(term => term.length >= 2 && !stopwords.has(term));

  const expanded = baseTerms.flatMap(term => [term, ...(expansions[term] ?? [])]);
  if (baseTerms.includes('구직촉진수당') && hasAny(baseTerms, ['요건', '조건', '기준'])) {
    expanded.push('수급자격', '수급 자격', '지원대상');
  }
  if (hasAny(baseTerms, ['1유형', 'I유형', 'Ⅰ유형', '일유형']) && hasAny(baseTerms, ['2유형', 'II유형', 'Ⅱ유형', '이유형'])) {
    expanded.push(
      'Ⅰ유형',
      'Ⅱ유형',
      '참여유형',
      '지원내용',
      '지원 내용',
      '취업지원서비스',
      '구직촉진수당',
      '취업활동비용',
    );
  }
  return [...new Set(expanded)].slice(0, 18);
}

function normalizeKoreanSearchTerm(value: string): string {
  return value
    .trim()
    .replace(/(은|는|이|가|을|를|의|에|에서|으로|로|와|과|도|만|란|인가요|인가|까요)$/u, '');
}

function hasAny(values: string[], targets: string[]): boolean {
  return targets.some(target => values.includes(target));
}

async function createEmbedding(input: string): Promise<number[]> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY가 설정되지 않았습니다.');
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input,
      encoding_format: 'float',
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`질문 임베딩 생성 실패: ${response.status} ${detail}`);
  }

  const payload = await response.json() as { data?: Array<{ embedding?: number[] }> };
  const embedding = payload.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('질문 임베딩 응답 형식이 올바르지 않습니다.');
  }
  return embedding;
}

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

async function searchManualChunks(
  admin: SupabaseAdminClient,
  input: {
    question: string;
    keywords: string[];
    queryEmbedding: number[];
    documentId: number | null;
    limit: number;
    minSimilarity: number;
  },
): Promise<ManualChunkMatch[]> {
  const rpcName = SEARCH_MODE === 'hybrid' ? 'match_manual_chunks_hybrid' : 'match_manual_chunks';
  const rpcArgs = SEARCH_MODE === 'hybrid'
    ? {
        query_embedding_text: vectorLiteral(input.queryEmbedding),
        keyword_terms: input.keywords,
        match_count: input.limit,
        filter_document_id: input.documentId,
        min_similarity: input.minSimilarity,
        vector_weight: VECTOR_WEIGHT,
        keyword_weight: KEYWORD_WEIGHT,
      }
    : {
        query_embedding_text: vectorLiteral(input.queryEmbedding),
        match_count: input.limit,
        filter_document_id: input.documentId,
        min_similarity: input.minSimilarity,
      };

  const { data, error } = await admin.rpc(rpcName, rpcArgs);

  if (error) throw error;
  return ((data ?? []) as ManualChunkMatch[])
    .filter(row => normalizeText(row.chunk_text))
    .filter(row => isAllowedContext(row, input.keywords))
    .sort((left, right) => getSortScore(right) - getSortScore(left));
}

function isAllowedContext(match: ManualChunkMatch, keywords: string[]): boolean {
  const haystack = `${match.section_title ?? ''} ${match.chunk_text ?? ''}`;
  const negativeContextPatterns = [
    '부정수급',
    '부정행위',
    '반환명령',
    '거짓신고',
    '취업성공수당',
    '가족수당 지급 시 유의사항',
    '가족수당 중복지급',
  ];
  const negativeQuestionTerms = [
    '부정수급',
    '부정행위',
    '반환명령',
    '거짓신고',
    '취업성공수당',
    '가족수당',
    '부양가족',
  ];

  const isNegativeContext = negativeContextPatterns.some(pattern => haystack.includes(pattern));
  const isNegativeQuestion = negativeQuestionTerms.some(term => keywords.includes(term));
  return !isNegativeContext || isNegativeQuestion;
}

function getSortScore(match: ManualChunkMatch): number {
  return match.final_score ?? match.similarity ?? 0;
}

function getRelevanceFailure(
  matches: ManualChunkMatch[],
  keywords: string[],
): { reason: ManualAnswer['reason']; message: string } | null {
  const top = matches[0];
  if (!top) {
    return {
      reason: 'NO_RELEVANT_MANUAL_CHUNKS',
      message: '제공된 매뉴얼 근거만으로는 답변을 확인할 수 없습니다. 질문 표현을 바꾸거나 관련 키워드를 더 구체적으로 입력해주세요.',
    };
  }

  if (SEARCH_MODE === 'hybrid') {
    const topFinalScore = top.final_score ?? top.similarity ?? 0;
    const topKeywordHits = top.keyword_hits ?? 0;

    if (keywords.length > 0 && topKeywordHits === 0) {
      return {
        reason: 'NO_KEYWORD_OVERLAP',
        message: '제공된 매뉴얼 근거만으로는 답변을 확인할 수 없습니다. 검색된 근거에 질문 핵심어가 충분히 포함되지 않았습니다.',
      };
    }

    if (topFinalScore < MIN_FINAL_SCORE_FOR_ANSWER) {
      return {
        reason: 'LOW_HYBRID_SCORE',
        message: '제공된 매뉴얼 근거만으로는 답변을 확인할 수 없습니다. 검색된 근거의 종합 관련도가 낮아 답변을 생성하지 않았습니다.',
      };
    }

    return null;
  }

  const topSimilarity = top.similarity ?? 0;
  if (topSimilarity < MIN_TOP_SIMILARITY_FOR_ANSWER) {
    return {
      reason: 'LOW_RELEVANCE_MANUAL_CHUNKS',
      message: '제공된 매뉴얼 근거만으로는 답변을 확인할 수 없습니다. 검색된 근거의 관련도가 낮아 답변을 생성하지 않았습니다.',
    };
  }

  return null;
}

function matchToCitation(match: ManualChunkMatch): ManualAnswer['citations'][number] {
  return {
    chunkId: match.id,
    documentTitle: match.document_title,
    documentVersion: match.document_version,
    pageStart: match.page_start,
    pageEnd: match.page_end,
    sectionTitle: match.section_title,
    similarity: roundSimilarity(match.similarity),
    keywordScore: roundSimilarity(match.keyword_score ?? null),
    keywordHits: match.keyword_hits ?? null,
    matchedKeywords: Array.isArray(match.matched_keywords) ? match.matched_keywords : [],
    finalScore: roundSimilarity(match.final_score ?? null),
    excerpt: truncate(match.chunk_text, 420),
  };
}

async function createGroundedAnswer(
  question: string,
  matches: ManualChunkMatch[],
): Promise<ManualAnswer> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY가 설정되지 않았습니다.');
  }

  const citations = matches.map(matchToCitation);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: ANSWER_MODEL,
      temperature: 0,
      top_p: 1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            '너는 국민취업지원제도 업무매뉴얼 질의응답 도우미다.',
            '반드시 제공된 manual_context 안의 내용만 근거로 답변한다.',
            'manual_context에 없는 내용은 추측하지 말고 "제공된 매뉴얼 근거만으로는 확인할 수 없습니다"라고 답한다.',
            '답변에는 행정 담당자가 확인하기 쉬운 조건, 절차, 주의사항을 구분해 작성하되 질문이 단순하면 불필요하게 늘리지 않는다.',
            '질문이 "요건", "기준", "대상"처럼 넓으면 수급자격, 지급대상, 신청/지급 절차를 혼동하지 말고 근거별로 구분한다.',
            '각 핵심 문장 끝에는 가능한 경우 [근거 1], [근거 2]처럼 manual_context의 citationNumber를 표시한다.',
            '서로 다른 제도나 수당의 내용이 섞여 있으면 질문 대상과 직접 관련된 근거만 사용한다.',
            '최종 행정 판단처럼 단정하지 말고 원문 확인이 필요한 부분은 명시한다.',
            '반드시 JSON만 반환한다.',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify({
            question,
            manual_context: citations.map((citation, index) => ({
              citationNumber: index + 1,
              chunkId: citation.chunkId,
              documentTitle: citation.documentTitle,
              documentVersion: citation.documentVersion,
              pageStart: citation.pageStart,
              pageEnd: citation.pageEnd,
              sectionTitle: citation.sectionTitle,
              excerpt: citation.excerpt,
            })),
            output_schema: {
              answer: 'string',
              confidence: 'high | medium | low | insufficient',
              reason: 'string | null',
            },
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`답변 생성 실패: ${response.status} ${detail}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('답변 생성 응답이 비어 있습니다.');
  }

  let parsed: { answer?: unknown; confidence?: unknown; reason?: unknown };
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = {};
  }

  const answer = normalizeText(parsed.answer) ??
    '제공된 매뉴얼 근거만으로는 답변을 확인할 수 없습니다.';
  const confidence = normalizeConfidence(parsed.confidence, matches);
  const reason = normalizeText(parsed.reason);

  return {
    answer,
    confidence,
    citations,
    reason,
  };
}

function normalizeConfidence(
  value: unknown,
  matches: ManualChunkMatch[] = [],
): ManualAnswer['confidence'] {
  const topScore = matches[0]?.final_score ?? matches[0]?.similarity ?? 0;
  const topKeywordHits = matches[0]?.keyword_hits ?? 0;
  if (SEARCH_MODE === 'hybrid' && value === 'high' && topScore < 0.72) {
    return 'medium';
  }

  if (SEARCH_MODE === 'hybrid' && (topScore < 0.65 || topKeywordHits < 2)) {
    if (value === 'insufficient') return 'insufficient';
    return topScore >= 0.55 && topKeywordHits >= 1 ? 'medium' : 'low';
  }

  if (value === 'high' || value === 'medium' || value === 'low' || value === 'insufficient') {
    return value;
  }
  return 'low';
}

function roundSimilarity(value: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value * 1000) / 1000;
}

function truncate(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

async function insertChatLog(
  admin: SupabaseAdminClient,
  userId: string | null,
  question: string,
  answer: ManualAnswer,
): Promise<void> {
  const citationSnapshots = answer.citations.map(citation => ({
    chunk_id: citation.chunkId,
    document_title: citation.documentTitle,
    document_version: citation.documentVersion,
    page_start: citation.pageStart,
    page_end: citation.pageEnd,
    section_title: citation.sectionTitle,
    similarity: citation.similarity,
    keyword_score: citation.keywordScore,
    keyword_hits: citation.keywordHits,
    matched_keywords: citation.matchedKeywords,
    final_score: citation.finalScore,
  }));

  const { error } = await admin
    .from('manual_chat_logs')
    .insert({
      user_id: userId,
      question,
      answer: answer.answer,
      cited_chunk_ids: answer.citations.map(citation => citation.chunkId),
      confidence: answer.confidence,
      reason: answer.reason,
      metadata: {
        search_mode: SEARCH_MODE,
        citation_count: answer.citations.length,
        citations: citationSnapshots,
      },
    });

  if (error) {
    console.warn('[manual-chat] failed to insert chat log', error.message);
  }
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
