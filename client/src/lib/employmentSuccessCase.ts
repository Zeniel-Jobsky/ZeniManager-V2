import {
  getSupabaseAnonKey,
  getOpenAIKey,
  getSupabaseUrl,
  isSupabaseConfigured,
} from './supabase';

// NOTE(2026-08-26): public.clients 스키마(uuid PK)로 이관. clients.id를 그대로 쓰면 되므로
// 예전처럼 client 테이블에 별도로 스냅샷 필드를 써주는 과정이 필요 없어졌다 —
// api.ts의 createClient/updateClient가 이미 employer/job_title/employment_type/salary/
// employment_date/desired_job을 clients 테이블에 직접 저장하기 때문에, 이 파일은 Edge
// Function 호출(동기화/검색)만 담당한다.

export interface EmploymentSuccessCaseMatch {
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
}

export interface EmploymentSuccessCaseSearchResponse {
  summary: string;
  results: EmploymentSuccessCaseMatch[];
  evaluatedCount: number;
  reason: string | null;
}

export async function syncEmploymentSuccessCase(clientId: string): Promise<void> {
  await invokeEmploymentEdgeFunction('sync-employment-success-case', {
    clientId,
    openAIKey: getOpenAIKey(),
  });
}

export async function searchEmploymentSuccessCases(
  clientId: string,
  limit = 3,
): Promise<EmploymentSuccessCaseSearchResponse> {
  if (!isSupabaseConfigured()) {
    return {
      summary: 'Supabase가 설정되지 않아 유사 취업사례를 검색할 수 없습니다.',
      results: [],
      evaluatedCount: 0,
      reason: 'SUPABASE_NOT_CONFIGURED',
    };
  }

  const data = await invokeEmploymentEdgeFunction<Record<string, unknown>>(
    'search-employment-success-case',
    {
      clientId,
      limit,
      openAIKey: getOpenAIKey(),
    },
  );

  return {
    summary: typeof data?.summary === 'string' ? data.summary : '유사 취업사례를 찾지 못했습니다.',
    results: Array.isArray(data?.results)
      ? data.results
          .map(normalizeEmploymentSuccessCaseMatch)
          .filter((item: EmploymentSuccessCaseMatch | null): item is EmploymentSuccessCaseMatch => item !== null)
      : [],
    evaluatedCount: typeof data?.evaluatedCount === 'number' ? data.evaluatedCount : 0,
    reason: typeof data?.reason === 'string' ? data.reason : null,
  };
}

export async function backfillEmploymentSuccessCases(limit = 200): Promise<{
  processed: number;
  activated: number;
  deactivated: number;
}> {
  const data = await invokeEmploymentEdgeFunction<Record<string, unknown>>(
    'sync-employment-success-case',
    {
      backfill: true,
      limit,
      openAIKey: getOpenAIKey(),
    },
  );

  return {
    processed: typeof data?.processed === 'number' ? data.processed : 0,
    activated: typeof data?.activated === 'number' ? data.activated : 0,
    deactivated: typeof data?.deactivated === 'number' ? data.deactivated : 0,
  };
}

export function maskKoreanName(name: string | null | undefined): string {
  const trimmed = normalizeText(name);
  if (!trimmed) return '익명';

  const [familyName] = Array.from(trimmed);
  return familyName ? `${familyName}OO` : '익명';
}

export function toAgeDecade(age: number | null | undefined): string {
  if (typeof age !== 'number' || !Number.isFinite(age) || age < 10) {
    return '연령 미상';
  }

  if (age >= 60) return '60대 이상';
  return `${Math.floor(age / 10) * 10}대`;
}

function normalizeEmploymentSuccessCaseMatch(value: unknown): EmploymentSuccessCaseMatch | null {
  if (!value || typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  const id = readString(record.id);
  const sourceClientId = readString(record.sourceClientId);
  const maskedClientName = readString(record.maskedClientName);
  const ageDecade = readString(record.ageDecade);
  const employmentCompany = readString(record.employmentCompany);

  if (!id || !sourceClientId || !maskedClientName || !ageDecade || !employmentCompany) {
    return null;
  }

  return {
    id,
    sourceClientId,
    maskedClientName,
    ageDecade,
    educationLevel: readString(record.educationLevel),
    major: readString(record.major),
    employmentCompany,
    employmentType: readString(record.employmentType),
    employmentJobType: readString(record.employmentJobType),
    employmentDate: normalizeDateOnly(readString(record.employmentDate)),
    similarity: readNumber(record.similarity) ?? 0,
    rerankScore: readNumber(record.rerankScore) ?? 0,
    matchReason: readString(record.matchReason) ?? '유사 배경 사례',
  };
}

async function invokeEmploymentEdgeFunction<T>(
  functionName: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabaseAnonKey();

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(`Supabase가 설정되지 않아 ${functionName} 함수를 호출할 수 없습니다.`);
  }

  const response = await fetch(buildFunctionUrl(supabaseUrl, functionName), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
    },
    body: JSON.stringify(payload),
  });

  const parsed = await readFunctionResponse(response);
  if (!response.ok) {
    const message = extractFunctionErrorMessage(parsed) ?? `Edge Function 호출에 실패했습니다. (${response.status})`;
    throw new Error(message);
  }

  return parsed as T;
}

function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeDateOnly(value: string | null | undefined): string | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  const normalizedSeparators = normalized.replace(/[./]/g, '-');
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedSeparators)) return normalizedSeparators;

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatLocalDate(parsed);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function buildFunctionUrl(supabaseUrl: string, functionName: string): string {
  const baseUrl = supabaseUrl.replace(/\/+$/, '');
  return `${baseUrl}/functions/v1/${functionName}`;
}

async function readFunctionResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text };
  }
}

function extractFunctionErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  return readString(record.error) ?? readString(record.message);
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
