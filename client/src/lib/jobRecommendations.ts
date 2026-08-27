import { getSupabaseClient, getSupabaseUrl, isSupabaseConfigured } from './supabase';

export const JOB_SOURCES = ['jobkorea', 'saramin', 'incruit'] as const;
export const JOB_EDUCATION_LEVELS = [
  'any',
  'high-school-or-less',
  'high-school',
  'associate',
  'bachelor',
  'master',
  'doctorate',
  'post-doctorate',
] as const;
export const JOB_EXPERIENCE_TYPES = ['any', 'entry', 'experienced'] as const;
export const MAX_JOB_RECOMMENDATION_REGIONS = 10;
export const JOB_RECOMMENDATION_FILTER_CONTRACT_VERSION = 1;

export type JobSource = (typeof JOB_SOURCES)[number];
export type JobDeadlineKind = 'date' | 'always' | 'until-hired';
export type JobEducationLevel = (typeof JOB_EDUCATION_LEVELS)[number];
export type JobExperienceType = (typeof JOB_EXPERIENCE_TYPES)[number];

export type JobExperienceRange = { kind: 'up-to-one-year' } | { kind: 'minimum-years'; years: number };

export interface JobRegionFilter {
  code: string;
  label: string;
}

export interface JobRecommendationFilters {
  education: JobEducationLevel[];
  experience: {
    types: JobExperienceType[];
    range: JobExperienceRange | null;
  };
  regions: JobRegionFilter[];
}

export interface JobSourceLink {
  source: JobSource;
  sourceLabel: string;
  url: string;
}

export interface JobPostingRecommendation {
  id: string;
  source: JobSource;
  sourceLabel: string;
  sourceId: string;
  url: string;
  title: string;
  company: string;
  location: string | null;
  employmentType: string | null;
  experience: string | null;
  education: string | null;
  postedAt: string | null;
  deadline: string | null;
  deadlineAt: string | null;
  deadlineLabel: string;
  deadlineKind: JobDeadlineKind;
  matchedDesiredJob: string;
  links: JobSourceLink[];
}

export interface JobSourceDiagnostic {
  source: JobSource;
  sourceLabel: string;
  status: 'success' | 'error';
  fetched: number;
  returned: number;
  excludedExpired: number;
  /** Absent when an older deployed Edge Function does not report this count. */
  excludedByFilter?: number;
  excludedDuplicate: number;
  message?: string;
}

export interface JobRecommendationResponse {
  filterContractVersion: number;
  appliedFilterKey: string;
  desiredJob: string;
  results: JobPostingRecommendation[];
  fetchedAt: string;
  partial: boolean;
  sources: JobSourceDiagnostic[];
}

type FetchJobRecommendationOptions = {
  expectedDesiredJob?: string | null;
  filters?: JobRecommendationFilters;
  force?: boolean;
};

type CachedResponse = {
  clientId: string;
  expiresAt: number;
  response: JobRecommendationResponse;
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const responseCache = new Map<string, CachedResponse>();

export const DEFAULT_JOB_RECOMMENDATION_FILTERS: JobRecommendationFilters = {
  education: ['any'],
  experience: {
    types: ['any'],
    range: null,
  },
  regions: [{ code: 'any', label: '지역 무관' }],
};

export async function fetchJobRecommendations(
  clientId: string,
  options: FetchJobRecommendationOptions = {},
): Promise<JobRecommendationResponse> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase가 설정되지 않아 채용공고를 조회할 수 없습니다.');
  }

  const expectedDesiredJob = normalizeComparisonText(options.expectedDesiredJob);
  const filters = normalizeJobRecommendationFilters(options.filters ?? DEFAULT_JOB_RECOMMENDATION_FILTERS);
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase client를 초기화할 수 없습니다.');
  }

  const { data: sessionData } = await client.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) throw new Error('로그인이 필요합니다.');

  pruneExpiredCache();
  const cacheKey = JSON.stringify([getSupabaseUrl(), userId, clientId, expectedDesiredJob, filters]);
  const cached = responseCache.get(cacheKey);
  if (
    !options.force &&
    cached &&
    cached.expiresAt > Date.now() &&
    (!expectedDesiredJob || normalizeComparisonText(cached.response.desiredJob) === expectedDesiredJob)
  ) {
    return filterExpiredRecommendations(cached.response);
  }

  const { data, error } = await client.functions.invoke('recommend-job-postings', {
    body: {
      clientId,
      filters,
      ...(options.force ? { refresh: true } : {}),
    },
  });

  if (error) {
    throw new Error(await readFunctionError(error));
  }

  if (data?.error) {
    throw new Error(String(data.error));
  }

  const response = filterExpiredRecommendations(parseJobRecommendationResponse(data));
  const expectedFilterKey = serializeJobRecommendationFiltersForContract(filters);
  if (
    response.filterContractVersion !== JOB_RECOMMENDATION_FILTER_CONTRACT_VERSION ||
    response.appliedFilterKey !== expectedFilterKey
  ) {
    throw new Error(
      '배포된 채용공고 검색 기능이 현재 검색 조건을 지원하지 않습니다. recommend-job-postings Edge Function을 다시 배포해주세요.',
    );
  }
  responseCache.set(cacheKey, {
    clientId,
    response,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  return response;
}

export function normalizeJobRecommendationFilters(value: JobRecommendationFilters): JobRecommendationFilters {
  const education = normalizeOrderedSelection(value.education, JOB_EDUCATION_LEVELS);
  const experienceTypes = normalizeOrderedSelection(value.experience.types, JOB_EXPERIENCE_TYPES);
  const regions = normalizeRegions(value.regions);
  const experienced = experienceTypes.includes('experienced');

  let range: JobExperienceRange | null = null;
  if (experienced && value.experience.range?.kind === 'up-to-one-year') {
    range = { kind: 'up-to-one-year' };
  } else if (
    experienced &&
    value.experience.range?.kind === 'minimum-years' &&
    Number.isFinite(value.experience.range.years)
  ) {
    range = {
      kind: 'minimum-years',
      years: Math.min(99, Math.max(1, Math.floor(value.experience.range.years))),
    };
  }

  return {
    education,
    experience: {
      types: experienceTypes,
      range,
    },
    regions,
  };
}

export function serializeJobRecommendationFiltersForContract(value: JobRecommendationFilters): string {
  const filters = normalizeJobRecommendationFilters(value);
  const education = filters.education.includes('any') ? [] : filters.education;
  const types = filters.experience.types.includes('any') ? [] : filters.experience.types;
  const provinceSelections = new Set(
    filters.regions.filter(region => region.code !== 'any' && !region.code.includes('/')).map(region => region.code),
  );
  const regions = filters.regions
    .filter(region => region.code !== 'any')
    .filter(region => !region.code.includes('/') || !provinceSelections.has(region.code.split('/')[0]));

  return JSON.stringify({
    education,
    experience: {
      types,
      range: types.includes('experienced') ? filters.experience.range : null,
    },
    regions,
  });
}

function normalizeOrderedSelection<T extends string>(selected: readonly string[], allowed: readonly T[]): T[] {
  const valid = new Set(selected.filter(value => allowed.includes(value as T)) as T[]);
  if (valid.has('any' as T) || valid.size === 0) return ['any' as T];
  return allowed.filter(value => value !== 'any' && valid.has(value));
}

function normalizeRegions(regions: readonly JobRegionFilter[]): JobRegionFilter[] {
  if (regions.some(region => region.code === 'any') || regions.length === 0) {
    return [{ code: 'any', label: '지역 무관' }];
  }

  const byCode = new Map<string, JobRegionFilter>();
  regions.forEach(region => {
    const code = region.code.trim().toLocaleLowerCase('en-US');
    const label = region.label.normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!code || !label || code === 'any') return;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?$/.test(code)) return;
    byCode.set(code, { code, label });
  });

  const normalized = Array.from(byCode.values())
    .sort((left, right) => left.code.localeCompare(right.code, 'en-US'))
    .slice(0, MAX_JOB_RECOMMENDATION_REGIONS);
  return normalized.length > 0 ? normalized : [{ code: 'any', label: '지역 무관' }];
}

export function clearJobRecommendationCache(clientId?: string): void {
  if (clientId) {
    responseCache.forEach((entry, key) => {
      if (entry.clientId === clientId) responseCache.delete(key);
    });
    return;
  }
  responseCache.clear();
}

function pruneExpiredCache(): void {
  const now = Date.now();
  responseCache.forEach((entry, key) => {
    if (entry.expiresAt <= now) responseCache.delete(key);
  });
}

async function readFunctionError(error: unknown): Promise<string> {
  const fallback = error instanceof Error && error.message ? error.message : '채용공고 추천 조회에 실패했습니다.';
  const context = error && typeof error === 'object' ? (error as { context?: unknown }).context : null;
  if (!(context instanceof Response)) return fallback;

  try {
    const payload = (await context.clone().json()) as { error?: unknown };
    return typeof payload.error === 'string' && payload.error.trim() ? payload.error : fallback;
  } catch {
    return fallback;
  }
}

export function isAllowedJobPostingUrl(source: JobSource, value: string): boolean {
  const allowedHosts: Record<JobSource, Set<string>> = {
    jobkorea: new Set(['www.jobkorea.co.kr', 'm.jobkorea.co.kr']),
    saramin: new Set(['www.saramin.co.kr', 'www2.saramin.co.kr']),
    incruit: new Set(['job.incruit.com', 'www.incruit.com']),
  };

  try {
    const url = new URL(value);
    return url.protocol === 'https:' && allowedHosts[source].has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function parseJobRecommendationResponse(value: unknown): JobRecommendationResponse {
  if (!value || typeof value !== 'object') {
    throw new Error('채용공고 추천 응답 형식이 올바르지 않습니다.');
  }

  const input = value as Record<string, unknown>;
  const filterContractVersion =
    typeof input.filterContractVersion === 'number' && Number.isInteger(input.filterContractVersion)
      ? input.filterContractVersion
      : 0;
  const appliedFilterKey = typeof input.appliedFilterKey === 'string' ? input.appliedFilterKey : '';
  const desiredJob = typeof input.desiredJob === 'string' ? input.desiredJob.trim() : '';
  const fetchedAt = typeof input.fetchedAt === 'string' ? input.fetchedAt : new Date().toISOString();
  const results = Array.isArray(input.results)
    ? input.results.map(parsePosting).filter((item): item is JobPostingRecommendation => Boolean(item))
    : [];
  const sources = Array.isArray(input.sources)
    ? input.sources.map(parseDiagnostic).filter((item): item is JobSourceDiagnostic => Boolean(item))
    : [];

  if (!desiredJob) {
    throw new Error('채용공고 추천 응답에 희망직종이 없습니다.');
  }

  return {
    filterContractVersion,
    appliedFilterKey,
    desiredJob,
    results,
    fetchedAt,
    partial: input.partial === true,
    sources,
  };
}

function parsePosting(value: unknown): JobPostingRecommendation | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const source = readSource(input.source);
  const url = typeof input.url === 'string' ? input.url : '';
  if (
    !source ||
    typeof input.id !== 'string' ||
    typeof input.sourceId !== 'string' ||
    typeof input.title !== 'string' ||
    typeof input.company !== 'string' ||
    !isAllowedJobPostingUrl(source, url)
  ) {
    return null;
  }

  const deadlineKind = input.deadlineKind;
  if (deadlineKind !== 'date' && deadlineKind !== 'always' && deadlineKind !== 'until-hired') {
    return null;
  }

  const links = Array.isArray(input.links)
    ? input.links.map(parseSourceLink).filter((item): item is JobSourceLink => Boolean(item))
    : [];
  if (!links.some(link => link.source === source && link.url === url)) {
    links.unshift({
      source,
      sourceLabel: typeof input.sourceLabel === 'string' ? input.sourceLabel : source,
      url,
    });
  }

  return {
    id: input.id,
    source,
    sourceLabel: typeof input.sourceLabel === 'string' ? input.sourceLabel : source,
    sourceId: input.sourceId,
    url,
    title: input.title.trim(),
    company: input.company.trim(),
    location: readNullableString(input.location),
    employmentType: readNullableString(input.employmentType),
    experience: readNullableString(input.experience),
    education: readNullableString(input.education),
    postedAt: readNullableString(input.postedAt),
    deadline: readNullableString(input.deadline),
    deadlineAt: readNullableString(input.deadlineAt),
    deadlineLabel: typeof input.deadlineLabel === 'string' ? input.deadlineLabel : '',
    deadlineKind,
    matchedDesiredJob: typeof input.matchedDesiredJob === 'string' ? input.matchedDesiredJob : '',
    links,
  };
}

function parseSourceLink(value: unknown): JobSourceLink | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const source = readSource(input.source);
  const url = typeof input.url === 'string' ? input.url : '';
  if (!source || !isAllowedJobPostingUrl(source, url)) return null;
  return {
    source,
    sourceLabel: typeof input.sourceLabel === 'string' ? input.sourceLabel : source,
    url,
  };
}

function parseDiagnostic(value: unknown): JobSourceDiagnostic | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const source = readSource(input.source);
  if (!source) return null;

  return {
    source,
    sourceLabel: typeof input.sourceLabel === 'string' ? input.sourceLabel : source,
    status: input.status === 'error' ? 'error' : 'success',
    fetched: readCount(input.fetched),
    returned: readCount(input.returned),
    excludedExpired: readCount(input.excludedExpired),
    ...(typeof input.excludedByFilter === 'number' ? { excludedByFilter: readCount(input.excludedByFilter) } : {}),
    excludedDuplicate: readCount(input.excludedDuplicate),
    ...(typeof input.message === 'string' ? { message: input.message } : {}),
  };
}

function readSource(value: unknown): JobSource | null {
  return typeof value === 'string' && JOB_SOURCES.includes(value as JobSource) ? (value as JobSource) : null;
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizeComparisonText(value: string | null | undefined): string {
  return typeof value === 'string'
    ? value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ko-KR')
    : '';
}

function filterExpiredRecommendations(response: JobRecommendationResponse): JobRecommendationResponse {
  const today = getKoreanDate();
  const now = Date.now();
  const results = response.results.filter(
    item =>
      item.deadlineKind !== 'date' ||
      (item.deadlineAt ? new Date(item.deadlineAt).valueOf() > now : Boolean(item.deadline && item.deadline >= today)),
  );

  if (results.length === response.results.length) return response;

  return {
    ...response,
    results,
    sources: response.sources.map(source => ({
      ...source,
      returned: results.filter(item => item.links.some(link => link.source === source.source)).length,
    })),
  };
}

function getKoreanDate(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : new Date().toISOString().slice(0, 10);
}
