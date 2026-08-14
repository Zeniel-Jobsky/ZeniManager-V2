import {
  getSupabaseAnonKey,
  getSupabaseClient,
  getOpenAIKey,
  getSupabaseUrl,
  isSupabaseConfigured,
  getOpenAIKey,
} from './supabase';

const CLIENT_EMPLOYMENT_SELECT_FIELDS = `
  client_id,
  participation_stage,
  desired_job_1,
  desired_job_2,
  desired_job_3,
  hire_type,
  hire_place,
  hire_job_type,
  hire_payment,
  hire_date,
  job_place_start
`;

type LiveEmploymentSnapshotRecord = {
  client_id: number;
  participation_stage: string | null;
  desired_job_1: string | null;
  desired_job_2: string | null;
  desired_job_3: string | null;
  hire_type: string | null;
  hire_place: string | null;
  hire_job_type: string | null;
  hire_payment: string | null;
  hire_date: string | null;
  job_place_start: string | null;
};

export interface ClientEmploymentSnapshotFields {
  clientId: string;
  participationStage: string | null;
  desiredJob1: string | null;
  desiredJob2: string | null;
  desiredJob3: string | null;
  employmentType: string | null;
  employmentCompany: string | null;
  employmentJobType: string | null;
  employmentSalary: string | null;
  employmentDate: string | null;
  hireDate: string | null;
}

export interface ClientEmploymentSnapshotUpdateInput {
  participationStage?: string | null;
  desiredJob1?: string | null;
  desiredJob2?: string | null;
  desiredJob3?: string | null;
  employmentType?: string | null;
  employmentCompany?: string | null;
  employmentJobType?: string | null;
  employmentSalary?: string | null;
  employmentDate?: string | null;
  hireDate?: string | null;
}

export interface EmploymentSuccessMetadataPatchInput {
  clientId: string | number;
  participationStage?: string | null;
  hirePlace?: string | null;
  hireType?: string | null;
  hireJobType?: string | null;
  hirePayment?: string | null;
  jobPlaceStart?: string | null;
  hireDate?: string | null;
}

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

export async function fetchClientEmploymentFields(
  clientId: string | number,
): Promise<ClientEmploymentSnapshotFields | null> {
  const client = requireConfiguredSupabaseClient('내담자 취업 정보 조회');

  const { data, error } = await client
    .from('client')
    .select(CLIENT_EMPLOYMENT_SELECT_FIELDS)
    .eq('client_id', toNumericClientId(clientId))
    .maybeSingle();

  if (error) {
    throw new Error(error.message || '내담자 취업 정보를 조회하지 못했습니다.');
  }

  return data ? normalizeClientEmploymentSnapshot(data as LiveEmploymentSnapshotRecord) : null;
}

export async function updateClientEmploymentSnapshotFields(
  clientId: string | number,
  payload: ClientEmploymentSnapshotUpdateInput,
): Promise<ClientEmploymentSnapshotFields> {
  const client = requireConfiguredSupabaseClient('내담자 취업 정보 저장');
  const updateRecord = buildClientEmploymentUpdateRecord(payload);

  if (Object.keys(updateRecord).length === 0) {
    const existing = await fetchClientEmploymentFields(clientId);
    if (!existing) {
      throw new Error('내담자 취업 정보를 찾을 수 없습니다.');
    }
    return existing;
  }

  const { data, error } = await client
    .from('client')
    .update({
      ...updateRecord,
      update_at: new Date().toISOString(),
    })
    .eq('client_id', toNumericClientId(clientId))
    .select(CLIENT_EMPLOYMENT_SELECT_FIELDS)
    .single();

  if (error) {
    throw new Error(error.message || '내담자 취업 정보를 저장하지 못했습니다.');
  }

  return normalizeClientEmploymentSnapshot(data as LiveEmploymentSnapshotRecord);
}

export async function syncEmploymentSuccessCase(clientId: string | number): Promise<void> {
  await invokeEmploymentEdgeFunction('sync-employment-success-case', {
    clientId: toNumericClientId(clientId),
    openAIKey: getOpenAIKey(),
  });
}

export async function updateClientEmploymentSnapshotAndSync(
  clientId: string | number,
  payload: ClientEmploymentSnapshotUpdateInput,
): Promise<ClientEmploymentSnapshotFields> {
  const snapshot = await updateClientEmploymentSnapshotFields(clientId, payload);
  await syncEmploymentSuccessCase(clientId);
  return snapshot;
}

export async function patchEmploymentSuccessMetadata(
  input: EmploymentSuccessMetadataPatchInput,
): Promise<ClientEmploymentSnapshotFields> {
  return updateClientEmploymentSnapshotAndSync(input.clientId, {
    participationStage: input.participationStage,
    employmentCompany: input.hirePlace,
    employmentType: input.hireType,
    employmentJobType: input.hireJobType,
    employmentSalary: input.hirePayment,
    employmentDate: input.jobPlaceStart,
    hireDate: input.hireDate,
  });
}

export async function searchEmploymentSuccessCases(
  clientId: string | number,
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
      clientId: toNumericClientId(clientId),
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

export function buildClientEmploymentUpdateRecord(
  payload: ClientEmploymentSnapshotUpdateInput,
): Record<string, string | null> {
  const updateRecord: Record<string, string | null> = {};

  assignNormalizedString(updateRecord, 'participation_stage', payload.participationStage);
  assignNormalizedString(updateRecord, 'desired_job_1', payload.desiredJob1);
  assignNormalizedString(updateRecord, 'desired_job_2', payload.desiredJob2);
  assignNormalizedString(updateRecord, 'desired_job_3', payload.desiredJob3);
  assignNormalizedString(updateRecord, 'hire_type', payload.employmentType);
  assignNormalizedString(updateRecord, 'hire_place', payload.employmentCompany);
  assignNormalizedString(updateRecord, 'hire_job_type', payload.employmentJobType);
  assignNormalizedString(updateRecord, 'hire_payment', payload.employmentSalary);
  assignNormalizedDate(updateRecord, 'job_place_start', payload.employmentDate);
  assignNormalizedDate(updateRecord, 'hire_date', payload.hireDate);

  return updateRecord;
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

function normalizeClientEmploymentSnapshot(
  row: LiveEmploymentSnapshotRecord,
): ClientEmploymentSnapshotFields {
  return {
    clientId: String(row.client_id),
    participationStage: normalizeText(row.participation_stage),
    desiredJob1: normalizeText(row.desired_job_1),
    desiredJob2: normalizeText(row.desired_job_2),
    desiredJob3: normalizeText(row.desired_job_3),
    employmentType: normalizeText(row.hire_type),
    employmentCompany: normalizeText(row.hire_place),
    employmentJobType: normalizeText(row.hire_job_type),
    employmentSalary: normalizeText(row.hire_payment),
    employmentDate: normalizeDateOnly(row.job_place_start),
    hireDate: normalizeDateOnly(row.hire_date),
  };
}

function requireConfiguredSupabaseClient(scopeLabel: string) {
  if (!isSupabaseConfigured()) {
    throw new Error(`Supabase가 설정되지 않아 ${scopeLabel}를 진행할 수 없습니다.`);
  }

  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase client를 초기화할 수 없습니다.');
  }

  return client;
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

function toNumericClientId(value: string | number): number {
  const clientId = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    throw new Error('유효한 상담자 ID가 필요합니다.');
  }
  return clientId;
}

function assignNormalizedString(
  target: Record<string, string | null>,
  key: string,
  value: string | null | undefined,
): void {
  if (value === undefined) return;
  target[key] = normalizeText(value);
}

function assignNormalizedDate(
  target: Record<string, string | null>,
  key: string,
  value: string | null | undefined,
): void {
  if (value === undefined) return;
  target[key] = normalizeDateOnly(value);
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
