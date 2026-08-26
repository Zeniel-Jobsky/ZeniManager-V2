import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { fetchSourceHtml } from '../_shared/job-postings/fetch-source.ts';
import { buildIncruitSearchUrl, parseIncruitSearch } from '../_shared/job-postings/incruit.ts';
import { buildJobKoreaSearchUrl, parseJobKoreaSearch } from '../_shared/job-postings/jobkorea.ts';
import {
  deduplicateJobPostings,
  normalizeRawPosting,
  splitDesiredJobs,
} from '../_shared/job-postings/normalize.ts';
import { buildSaraminSearchUrl, parseSaraminSearch } from '../_shared/job-postings/saramin.ts';
import {
  JOB_SOURCES,
  JOB_SOURCE_LABELS,
  type JobPostingRecommendation,
  type JobRecommendationResponse,
  type JobSource,
  type JobSourceDiagnostic,
  type RawJobPosting,
} from '../_shared/job-postings/types.ts';

type RequestBody = { clientId?: string; refresh?: boolean };

type SourceAdapter = {
  source: JobSource;
  buildUrl: (desiredJob: string) => string;
  parse: (html: string) => RawJobPosting[];
};

type SourceQuery = { adapter: SourceAdapter; desiredJob: string };
type SourceQueryResult = SourceQuery & { raw: RawJobPosting[] };
type CachedRecommendation = { expiresAt: number; response: JobRecommendationResponse };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Cache-Control': 'private, max-age=0, no-store',
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 4_096;
const MAX_DESIRED_JOBS = 3;
const MAX_RESULTS_PER_SOURCE = 12;
const MAX_TOTAL_RESULTS = 30;
const CACHE_TTL_MS = 10 * 60 * 1000;
const PARTIAL_CACHE_TTL_MS = 60 * 1000;
const REFRESH_COOLDOWN_MS = 30 * 1000;
const MAX_CACHE_ENTRIES = 200;

const adapters: SourceAdapter[] = [
  { source: 'jobkorea', buildUrl: buildJobKoreaSearchUrl, parse: parseJobKoreaSearch },
  { source: 'saramin', buildUrl: buildSaraminSearchUrl, parse: parseSaraminSearch },
  { source: 'incruit', buildUrl: buildIncruitSearchUrl, parse: parseIncruitSearch },
];

// Warm-isolate caching and coalescing reduce repeated external requests. A
// platform-level rate limit should still be configured for production traffic.
const responseCache = new Map<string, CachedRecommendation>();
const failureCache = new Map<string, { expiresAt: number; diagnostics: JobSourceDiagnostic[] }>();
const refreshCooldowns = new Map<string, number>();
const inFlightRequests = new Map<string, Promise<JobRecommendationResponse>>();

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') {
    return json({ error: 'POST 요청만 지원합니다.', code: 'METHOD_NOT_ALLOWED' }, 405);
  }

  try {
    const authorization = request.headers.get('authorization');
    if (!authorization?.toLowerCase().startsWith('bearer ')) {
      return json({ error: '로그인이 필요합니다.', code: 'UNAUTHORIZED' }, 401);
    }

    // Authenticate before consuming an untrusted body.
    const authenticatedClient = createAuthenticatedClient(authorization);
    const accessToken = authorization.replace(/^Bearer\s+/i, '');
    const { data: authData, error: authError } = await authenticatedClient.auth.getUser(accessToken);
    if (authError || !authData.user) {
      return json({ error: '로그인 세션이 만료되었습니다.', code: 'UNAUTHORIZED' }, 401);
    }

    const body = await readBody(request);
    const clientId = typeof body.clientId === 'string' ? body.clientId.trim().toLowerCase() : '';
    if (!UUID_PATTERN.test(clientId)) {
      return json({ error: '올바른 내담자 ID가 필요합니다.', code: 'INVALID_CLIENT_ID' }, 400);
    }

    // Use the caller JWT rather than a service role so the existing clients RLS
    // policy decides whether this counselor can access this client.
    const clientRecord = await fetchDesiredJob(authenticatedClient, clientId);
    if (!clientRecord.found) {
      return json({ error: '내담자 정보를 찾을 수 없습니다.', code: 'CLIENT_NOT_FOUND' }, 404);
    }
    const canAccessClient = await callerCanAccessClient(
      authenticatedClient,
      authData.user.id,
      clientRecord.counselorId,
    );
    if (!canAccessClient) {
      return json({ error: '내담자 정보를 찾을 수 없습니다.', code: 'CLIENT_NOT_FOUND' }, 404);
    }

    const desiredJobs = splitDesiredJobs(clientRecord.desiredJob, MAX_DESIRED_JOBS);
    if (desiredJobs.length === 0) {
      const hasRawValue = Boolean(clientRecord.desiredJob?.trim());
      const isTooLong = (clientRecord.desiredJob?.length ?? 0) > 512;
      return json({
        error: isTooLong
          ? '희망직종 입력이 너무 깁니다. 직종별 80자 이내로 입력해주세요.'
          : hasRawValue
          ? '희망직종에 검색어로 전송할 수 없는 개인정보 형식이 포함되어 있습니다.'
          : '희망직종이 입력되지 않았습니다. 내담자 대시보드에서 희망직종을 먼저 입력해주세요.',
        code: hasRawValue ? 'INVALID_DESIRED_JOB' : 'DESIRED_JOB_MISSING',
      }, 422);
    }

    const cacheKey = `${clientId}:${desiredJobs.join('\u0000')}`;
    const refresh = body.refresh === true;
    if (!refresh) {
      const cached = getCachedResponse(cacheKey);
      if (cached) return json(cached);
      const cachedFailure = getCachedFailure(cacheKey);
      if (cachedFailure) throw new AllSourcesFailedError(cachedFailure);
    }

    let scrapePromise = inFlightRequests.get(cacheKey);
    if (!scrapePromise) {
      if (refresh) enforceRefreshCooldown(`${authData.user.id}:${cacheKey}`);
      scrapePromise = scrapeRecommendations(desiredJobs);
      inFlightRequests.set(cacheKey, scrapePromise);
    }

    try {
      const response = await scrapePromise;
      setCachedResponse(cacheKey, response);
      return json(response);
    } catch (error) {
      if (error instanceof AllSourcesFailedError) {
        while (failureCache.size >= MAX_CACHE_ENTRIES) {
          const oldestKey = failureCache.keys().next().value as string | undefined;
          if (!oldestKey) break;
          failureCache.delete(oldestKey);
        }
        failureCache.set(cacheKey, {
          expiresAt: Date.now() + PARTIAL_CACHE_TTL_MS,
          diagnostics: error.diagnostics,
        });
      }
      throw error;
    } finally {
      if (inFlightRequests.get(cacheKey) === scrapePromise) inFlightRequests.delete(cacheKey);
    }
  } catch (error) {
    if (error instanceof RequestError) {
      return json({ error: error.message, code: error.code }, error.status);
    }
    if (error instanceof AllSourcesFailedError) {
      return json({
        error: '세 채용사이트에서 공고를 가져오지 못했습니다. 잠시 후 다시 시도해주세요.',
        code: 'ALL_SOURCES_FAILED',
        sources: error.diagnostics,
      }, 502);
    }

    console.error('[recommend-job-postings] request failed', safeErrorForLog(error));
    return json({
      error: '채용공고 추천을 불러오는 중 오류가 발생했습니다.',
      code: 'RECOMMENDATION_FAILED',
    }, 500);
  }
});

async function scrapeRecommendations(desiredJobs: string[]): Promise<JobRecommendationResponse> {
  const now = new Date();
  const queries: SourceQuery[] = adapters.flatMap(adapter => (
    desiredJobs.map(desiredJob => ({ adapter, desiredJob }))
  ));
  // Run at most one request per site at a time (three sites in parallel).
  const settledBySource = await Promise.all(adapters.map(async adapter => {
    const sourceResults: PromiseSettledResult<SourceQueryResult>[] = [];
    for (const desiredJob of desiredJobs) {
      const query = { adapter, desiredJob };
      try {
        const html = await fetchSourceHtml(adapter.source, adapter.buildUrl(desiredJob));
        sourceResults.push({ status: 'fulfilled', value: { ...query, raw: adapter.parse(html) } });
      } catch (reason) {
        sourceResults.push({ status: 'rejected', reason });
      }
    }
    return sourceResults;
  }));
  const settledResults = settledBySource.flat();

  const rawBySource = new Map<JobSource, RawJobPosting[]>();
  const eligibleBySource = new Map<JobSource, JobPostingRecommendation[]>();
  const chunksBySource = new Map<JobSource, JobPostingRecommendation[][]>();
  const failuresBySource = new Map<JobSource, string[]>();
  const successesBySource = new Map<JobSource, number>();
  for (const source of JOB_SOURCES) {
    rawBySource.set(source, []);
    eligibleBySource.set(source, []);
    chunksBySource.set(source, []);
    failuresBySource.set(source, []);
    successesBySource.set(source, 0);
  }

  settledResults.forEach((result, index) => {
    const query = queries[index];
    const source = query.adapter.source;
    if (result.status === 'rejected') {
      failuresBySource.get(source)?.push(toPublicSourceError(result.reason));
      chunksBySource.get(source)?.push([]);
      return;
    }

    successesBySource.set(source, (successesBySource.get(source) ?? 0) + 1);
    rawBySource.get(source)?.push(...result.value.raw);
    const eligible = result.value.raw
      .map(posting => normalizeRawPosting(posting, query.desiredJob, now))
      .filter((posting): posting is JobPostingRecommendation => Boolean(posting));
    eligibleBySource.get(source)?.push(...eligible);
    chunksBySource.get(source)?.push(eligible);
  });

  const normalizedBySource = new Map<JobSource, JobPostingRecommendation[]>();
  const deduplicatedBySource = new Map<JobSource, JobPostingRecommendation[]>();
  for (const source of JOB_SOURCES) {
    const deduplicated = deduplicateJobPostings(interleaveLists(chunksBySource.get(source) ?? []));
    deduplicatedBySource.set(source, deduplicated);
    normalizedBySource.set(
      source,
      deduplicated.slice(0, MAX_RESULTS_PER_SOURCE),
    );
  }

  const failedQueryCount = settledResults.filter(result => result.status === 'rejected').length;
  const interleaved = interleaveBySource(normalizedBySource);
  const results = deduplicateJobPostings(interleaved).slice(0, MAX_TOTAL_RESULTS);
  const diagnostics = buildDiagnostics(
    rawBySource,
    eligibleBySource,
    deduplicatedBySource,
    results,
    failuresBySource,
    successesBySource,
  );
  if (failedQueryCount === queries.length) throw new AllSourcesFailedError(diagnostics);

  return {
    desiredJob: desiredJobs.join(', '),
    results,
    fetchedAt: now.toISOString(),
    partial: failedQueryCount > 0,
    sources: diagnostics,
  };
}

function createAuthenticatedClient(authorization: string) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) throw new Error('Supabase Edge Function 환경변수가 설정되지 않았습니다.');

  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function fetchDesiredJob(
  client: ReturnType<typeof createAuthenticatedClient>,
  clientId: string,
): Promise<{ found: boolean; desiredJob: string | null; counselorId: string | null }> {
  const { data, error } = await client
    .from('clients')
    .select('id, desired_job, counselor_id')
    .eq('id', clientId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return { found: false, desiredJob: null, counselorId: null };
  return {
    found: true,
    desiredJob: typeof data.desired_job === 'string' ? data.desired_job : null,
    counselorId: typeof data.counselor_id === 'string' ? data.counselor_id.toLowerCase() : null,
  };
}

async function callerCanAccessClient(
  client: ReturnType<typeof createAuthenticatedClient>,
  authUserId: string,
  assignedCounselorId: string | null,
): Promise<boolean> {
  // Administrators are identified by the application profile table.
  const { data: userProfile, error: userError } = await client
    .from('user')
    .select('user_id, role')
    .eq('user_id', authUserId)
    .maybeSingle();
  if (!userError && Number(userProfile?.role) === 4) return true;

  // clients.counselor_id points to public.counselors.id, while authentication
  // provides auth.users.id. Resolve the FK through counselors.auth_user_id.
  const { data: counselorProfile, error: counselorError } = await client
    .from('counselors')
    .select('id, role')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (counselorError || !counselorProfile) return false;
  return Number(counselorProfile.role) === 4
    || (typeof counselorProfile.id === 'string'
      && counselorProfile.id.toLowerCase() === assignedCounselorId?.toLowerCase());
}

async function readBody(request: Request): Promise<RequestBody> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new RequestError(415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON 요청만 지원합니다.');
  }

  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new RequestError(413, 'PAYLOAD_TOO_LARGE', '요청 본문이 너무 큽니다.');
  }

  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new RequestError(413, 'PAYLOAD_TOO_LARGE', '요청 본문이 너무 큽니다.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid body');
    return value as RequestBody;
  } catch {
    throw new RequestError(400, 'INVALID_JSON', '올바른 JSON 요청 본문이 필요합니다.');
  }
}

function interleaveLists<T>(lists: T[][]): T[] {
  const output: T[] = [];
  const maxLength = Math.max(0, ...lists.map(list => list.length));
  for (let rank = 0; rank < maxLength; rank += 1) {
    for (const list of lists) {
      const item = list[rank];
      if (item) output.push(item);
    }
  }
  return output;
}

function interleaveBySource(
  normalizedBySource: Map<JobSource, JobPostingRecommendation[]>,
): JobPostingRecommendation[] {
  return interleaveLists(JOB_SOURCES.map(source => normalizedBySource.get(source) ?? []));
}

function buildDiagnostics(
  rawBySource: Map<JobSource, RawJobPosting[]>,
  eligibleBySource: Map<JobSource, JobPostingRecommendation[]>,
  deduplicatedBySource: Map<JobSource, JobPostingRecommendation[]>,
  finalResults: JobPostingRecommendation[],
  failuresBySource: Map<JobSource, string[]>,
  successesBySource: Map<JobSource, number>,
): JobSourceDiagnostic[] {
  return JOB_SOURCES.map(source => {
    const raw = rawBySource.get(source) ?? [];
    const eligible = eligibleBySource.get(source) ?? [];
    const sourceDeduplicated = deduplicatedBySource.get(source) ?? [];
    const returned = finalResults.filter(posting => posting.links.some(link => link.source === source)).length;
    const failures = failuresBySource.get(source) ?? [];
    const completelyFailed = (successesBySource.get(source) ?? 0) === 0;
    return {
      source,
      sourceLabel: JOB_SOURCE_LABELS[source],
      status: completelyFailed ? 'error' : 'success',
      fetched: raw.length,
      returned,
      excludedExpired: Math.max(0, raw.length - eligible.length),
      excludedDuplicate: Math.max(0, eligible.length - sourceDeduplicated.length),
      ...(failures.length > 0 ? { message: [...new Set(failures)].join(' ') } : {}),
    };
  });
}

function getCachedResponse(key: string): JobRecommendationResponse | null {
  const now = Date.now();
  for (const [cacheKey, entry] of responseCache) {
    if (entry.expiresAt <= now) responseCache.delete(cacheKey);
  }
  const response = responseCache.get(key)?.response;
  if (!response) return null;
  const results = response.results.filter(posting => (
    !posting.deadlineAt || new Date(posting.deadlineAt).valueOf() > now
  ));
  if (results.length === response.results.length) return response;
  return {
    ...response,
    results,
    sources: response.sources.map(source => ({
      ...source,
      returned: results.filter(posting => posting.links.some(link => link.source === source.source)).length,
    })),
  };
}

function setCachedResponse(key: string, response: JobRecommendationResponse): void {
  failureCache.delete(key);
  while (responseCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = responseCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    responseCache.delete(oldestKey);
  }
  const baseExpiry = Date.now() + (response.partial ? PARTIAL_CACHE_TTL_MS : CACHE_TTL_MS);
  const earliestDeadline = response.results.reduce((earliest, posting) => {
    if (!posting.deadlineAt) return earliest;
    const deadline = new Date(posting.deadlineAt).valueOf();
    return Number.isFinite(deadline) ? Math.min(earliest, deadline) : earliest;
  }, baseExpiry);
  responseCache.set(key, {
    response,
    expiresAt: earliestDeadline,
  });
}

function getCachedFailure(key: string): JobSourceDiagnostic[] | null {
  const entry = failureCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    failureCache.delete(key);
    return null;
  }
  return entry.diagnostics;
}

function enforceRefreshCooldown(key: string): void {
  const now = Date.now();
  refreshCooldowns.forEach((expiresAt, cooldownKey) => {
    if (expiresAt <= now) refreshCooldowns.delete(cooldownKey);
  });
  const retryAt = refreshCooldowns.get(key) ?? 0;
  if (retryAt > now) {
    const seconds = Math.ceil((retryAt - now) / 1000);
    throw new RequestError(429, 'REFRESH_RATE_LIMITED', `${seconds}초 후에 다시 새로고침해주세요.`);
  }
  while (refreshCooldowns.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = refreshCooldowns.keys().next().value as string | undefined;
    if (!oldestKey) break;
    refreshCooldowns.delete(oldestKey);
  }
  refreshCooldowns.set(key, now + REFRESH_COOLDOWN_MS);
}

function toPublicSourceError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/시간이 초과/.test(message)) return '응답 시간이 초과되었습니다.';
  if (/일시적으로 제한|자동 조회 요청을 제한/.test(message)) return '사이트가 자동 조회를 일시적으로 제한했습니다.';
  if (/구조가 변경/.test(message)) return '검색 결과 형식이 변경되어 읽지 못했습니다.';
  return '채용공고를 가져오지 못했습니다.';
}

function safeErrorForLog(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: 'UnknownError', message: String(error) };
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

class RequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'RequestError';
  }
}

class AllSourcesFailedError extends Error {
  constructor(readonly diagnostics: JobSourceDiagnostic[]) {
    super('All job sources failed');
    this.name = 'AllSourcesFailedError';
  }
}
