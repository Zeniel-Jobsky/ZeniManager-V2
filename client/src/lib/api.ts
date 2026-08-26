/**
 * api.ts — Supabase data access layer
 * All functions require Supabase to be configured.
 */
import { normalizeAppRole } from '@shared/const';
import {
  executeSupabaseRequest,
  getSupabaseClient,
  isSupabaseConfigured,
} from './supabase';
import type {
  ClientRow, ClientInsert,
  SessionRow, SessionInsert,
  CounselorRow, CounselorInsert,
  SurveyRow, SurveyInsert,
  MemoCardRow, MemoCardInsert,
} from './supabase';

// ─── Helper ───────────────────────────────────────────────────────────────────

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase가 설정되지 않았습니다. 설정 메뉴에서 Supabase URL과 API 키를 입력하세요.');
  return client;
}

function runQuery<T>(
  operationLabel: string,
  request: PromiseLike<{
    data: T | null;
    error: unknown;
    status?: number | null;
    count?: number | null;
  }>,
) {
  return executeSupabaseRequest(operationLabel, request, {
    requireStoredSession: true,
  });
}

/**
 * PostgREST는 .range()를 지정하지 않으면 프로젝트의 기본 max-rows(보통 1000)까지만 반환한다.
 * 데이터 개수와 무관하게 전체를 가져오기 위해 페이지 단위로 끝까지 반복 조회한다.
 */
const FETCH_ALL_PAGE_SIZE = 1000;

async function fetchAllPages<T>(
  operationLabel: string,
  buildQuery: (fromIndex: number, toIndex: number) => PromiseLike<{
    data: T[] | null;
    error: unknown;
    status?: number | null;
    count?: number | null;
  }>,
  pageSize = FETCH_ALL_PAGE_SIZE,
): Promise<T[]> {
  const allRows: T[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await runQuery<T[]>(operationLabel, buildQuery(from, from + pageSize - 1));
    if (error) throw error;

    const page = data ?? [];
    allRows.push(...page);

    if (page.length < pageSize) break;
    from += pageSize;
  }

  return allRows;
}

/**
 * ID contract:
 * - user.id: auth.users.id / public.user.user_id
 * - user.counselorId: public.counselors.id
 * - clients/sessions/memo_cards.counselor_id: public.counselors.id
 *
 * auth UUID -> counselors PK 변환은 로그인 프로필을 해석할 때 한 번만 수행한다.
 * 이 데이터 계층이 받는 counselorId/counselor_id는 이미 내부 counselors PK다.
 */
function normalizeCounselorRowId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

/**
 * clients.gender에는 '남'/'여'만 허용하는 CHECK 제약이 있다. 폼 등 일부 호출부가
 * 여전히 옛 코드값('M'/'F')을 보내는 경우가 있어 여기서 정규화한다.
 */
function normalizeGender(value: unknown): '남' | '여' | null {
  if (value === '남' || value === '여') return value;
  if (value === 'M' || value === 'male') return '남';
  if (value === 'F' || value === 'female') return '여';
  return null;
}

/**
 * 엑셀 등에서 마이그레이션된 텍스트 값에 눈에 안 보이는 앞뒤 공백이 섞여 있는 경우가 있다.
 * `participation_stage === '취업완료'` 같은 정확 비교(드롭다운 선택, KPI 필터 등)가 공백 때문에
 * 조용히 어긋나는 걸 막기 위해 읽어올 때 항상 trim한다.
 */
function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return value ?? null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isMissingSchemaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const maybeError = error as {
    code?: string;
    message?: string;
  };

  if (maybeError.code === 'PGRST202' || maybeError.code === 'PGRST205') {
    return true;
  }

  const message = maybeError.message?.toLowerCase() ?? '';
  return message.includes('schema cache') || message.includes('could not find');
}

const SESSION_META_MARKER = '\n\n[__CALENDAR_FLOW_META__]\n';

// public.clients 테이블 실제 컬럼 (2026-08-26 확정, information_schema 기준)
type LiveClientRecord = {
  id: string;
  seq_no: number | null;
  year: number | null;
  assignment_type: string | null;
  name: string;
  resident_id_masked: string | null;
  phone: string | null;
  last_counsel_date: string | null;
  age: number | null;
  gender: '남' | '여' | null;
  business_type: string | null;
  participation_type: string | null;
  participation_stage: string | null;
  competency_grade: string | null;
  recognition_date: string | null;
  desired_job: string | null;
  counsel_notes: string | null;
  address: string | null;
  school: string | null;
  major: string | null;
  education_level: string | null;
  initial_counsel_date: string | null;
  iap_date: string | null;
  iap_duration: string | null;
  allowance_apply_date: string | null;
  rediagnosis_date: string | null;
  rediagnosis_yn: string | null;
  work_exp_type: string | null;
  work_exp_intent: string | null;
  work_exp_company: string | null;
  work_exp_period: string | null;
  work_exp_completed: string | null;
  training_name: string | null;
  training_start: string | null;
  training_end: string | null;
  training_allowance: string | null;
  intensive_start: string | null;
  intensive_end: string | null;
  support_end_date: string | null;
  employment_type: string | null;
  employment_date: string | null;
  employer: string | null;
  job_title: string | null;
  salary: string | null;
  employment_duration: string | null;
  resignation_date: string | null;
  retention_1m_date: string | null;
  retention_1m_yn: string | null;
  retention_6m_date: string | null;
  retention_6m_yn: string | null;
  retention_12m_date: string | null;
  retention_12m_yn: string | null;
  retention_18m_date: string | null;
  retention_18m_yn: string | null;
  counselor_name: string | null;
  counselor_id: string | null;
  branch: string | null;
  follow_up: boolean | null;
  score: number | null;
  created_at: string | null;
  updated_at: string | null;
};

// public.sessions 테이블 실제 컬럼 (2026-08-26 확정)
type LiveCounselHistoryRecord = {
  id: string;
  client_id: string;
  date: string;
  type: string | null;
  content: string | null;
  counselor_name: string | null;
  counselor_id: string | null;
  next_action: string | null;
  created_at: string | null;
};

function encodeSessionPayload(type: string, content: string, nextAction?: string | null): string {
  const meta = JSON.stringify({ type, nextAction: nextAction || null });
  return `${content}${SESSION_META_MARKER}${meta}`;
}

function decodeSessionPayload(
  rawContent: string | null | undefined,
  fallbackType?: string | null,
): { content: string | null; type: string; nextAction: string | null } {
  if (!rawContent) {
    return { content: null, type: fallbackType || '상담기록', nextAction: null };
  }

  const markerIndex = rawContent.indexOf(SESSION_META_MARKER);
  if (markerIndex < 0) {
    return { content: rawContent, type: fallbackType || '상담기록', nextAction: null };
  }

  const content = rawContent.slice(0, markerIndex);
  const metaRaw = rawContent.slice(markerIndex + SESSION_META_MARKER.length);

  try {
    const meta = JSON.parse(metaRaw) as { type?: string; nextAction?: string | null };
    return {
      content,
      type: meta.type || fallbackType || '상담기록',
      nextAction: meta.nextAction || null,
    };
  } catch {
    return { content: rawContent, type: fallbackType || '상담기록', nextAction: null };
  }
}

// ─── Clients ─────────────────────────────────────────────────────────────────

// public.clients 테이블 컬럼 (2026-08-26 확정 — 실데이터 보유 테이블, 코드를 여기에 맞춤)
const CLIENT_SELECT_FIELDS = `
  id,
  seq_no,
  year,
  assignment_type,
  name,
  resident_id_masked,
  phone,
  last_counsel_date,
  age,
  gender,
  business_type,
  participation_type,
  participation_stage,
  competency_grade,
  recognition_date,
  desired_job,
  counsel_notes,
  address,
  school,
  major,
  education_level,
  initial_counsel_date,
  iap_date,
  iap_duration,
  allowance_apply_date,
  rediagnosis_date,
  rediagnosis_yn,
  work_exp_type,
  work_exp_intent,
  work_exp_company,
  work_exp_period,
  work_exp_completed,
  training_name,
  training_start,
  training_end,
  training_allowance,
  intensive_start,
  intensive_end,
  support_end_date,
  employment_type,
  employment_date,
  employer,
  job_title,
  salary,
  employment_duration,
  resignation_date,
  retention_1m_date,
  retention_1m_yn,
  retention_6m_date,
  retention_6m_yn,
  retention_12m_date,
  retention_12m_yn,
  retention_18m_date,
  retention_18m_yn,
  counselor_name,
  counselor_id,
  branch,
  follow_up,
  score,
  created_at,
  updated_at
`;

export async function fetchClients(counselorId?: string): Promise<ClientRow[]> {
  if (!isSupabaseConfigured()) return [];
  const scopedCounselorId = normalizeCounselorRowId(counselorId);

  const rows = await fetchAllPages<LiveClientRecord>('고객 목록 조회', (from, to) => {
    let q = sb()
      .from('clients')
      .select(CLIENT_SELECT_FIELDS)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (scopedCounselorId) q = q.eq('counselor_id', scopedCounselorId);
    return q;
  });

  return rows.map(row => liveClientToRow(row));
}

export async function fetchClientById(id: string): Promise<ClientRow | null> {
  if (!isSupabaseConfigured()) return null;

  const { data, error } = await runQuery<LiveClientRecord>(
    '고객 상세 조회',
    sb()
      .from('clients')
      .select(CLIENT_SELECT_FIELDS)
      .eq('id', id)
      .single(),
  );

  if (error) {
    if ((error as { code?: string }).code === 'PGRST116') return null; // not found
    throw error;
  }

  return liveClientToRow((data as any) as unknown as LiveClientRecord);
}

/**
 * seq_no는 DB 전체 기준 최댓값 + 1로 채운다. 동시에 두 명이 등록하면 같은 값이 나올 수 있는
 * 경합 가능성이 이론상 있지만(별도 시퀀스/락 없음), 상담사 소수가 쓰는 내부 도구라 감수한다.
 */
async function getNextSeqNo(): Promise<number> {
  const { data, error } = await runQuery<Array<{ seq_no: number | null }>>(
    '다음 순번 조회',
    sb().from('clients').select('seq_no').order('seq_no', { ascending: false, nullsFirst: false }).limit(1),
  );
  if (error) throw error;
  const maxSeqNo = data?.[0]?.seq_no ?? 0;
  return maxSeqNo + 1;
}

export async function createClient(input: any): Promise<ClientRow> {
  if (!isSupabaseConfigured()) throw new Error('Supabase 설정이 필요합니다.');

  // input.counselor_id는 로그인 계정의 auth uid로 넘어오므로, FK가 요구하는
  // counselors.id로 변환해야 한다 (안 그러면 FK 위반으로 INSERT가 실패한다).
  const [resolvedCounselorRowId, nextSeqNo] = await Promise.all([
    input.counselor_id ? resolveCounselorRowId(input.counselor_id) : Promise.resolve(null),
    getNextSeqNo(),
  ]);
  if (input.counselor_id && !resolvedCounselorRowId) {
    throw new Error('로그인한 상담사 계정이 counselors 테이블과 연결되어 있지 않습니다. 관리자에게 문의하세요.');
  }

  const payload = {
    name: input.name,
    counselor_id: resolvedCounselorRowId,
    seq_no: nextSeqNo,
    year: new Date().getFullYear(),
    age: input.age,
    gender: normalizeGender(input.gender),
    phone: input.phone,
    address: input.address,
    desired_job: input.desired_job,
    education_level: input.education_level,
    school: input.school,
    major: input.major,
    business_type: input.business_type,
    participation_type: input.participation_type,
    participation_stage: input.participation_stage,
    competency_grade: input.competency_grade,
    counsel_notes: input.counsel_notes,
    branch: input.branch,
    resident_id_masked: input.resident_id_masked,
    work_exp_type: input.work_exp_type,
    work_exp_intent: input.work_exp_intent,
    work_exp_company: input.work_exp_company,
    work_exp_period: input.work_exp_period,
    work_exp_completed: input.work_exp_completed,
    employer: input.employer,
    job_title: input.job_title,
    employment_type: input.employment_type,
    salary: input.salary,
    employment_date: input.employment_date,
  };

  const { data, error } = await runQuery<LiveClientRecord>(
    '고객 등록',
    sb()
      .from('clients')
      .insert(payload)
      .select(CLIENT_SELECT_FIELDS)
      .single(),
  );

  if (error) throw error;
  return liveClientToRow((data as any) as unknown as LiveClientRecord);
}

export async function updateClient(id: string, updates: Partial<LiveClientRecord>): Promise<ClientRow> {
  try {
    if (!isSupabaseConfigured()) throw new Error('Supabase 설정이 필요합니다.');
    const normalizedUpdates = 'gender' in updates
      ? { ...updates, gender: normalizeGender((updates as any).gender) }
      : updates;
    const { data, error } = await sb()
      .from('clients')
      .update(normalizedUpdates)
      .eq('id', id)
      .select(CLIENT_SELECT_FIELDS)
      .single();

    if (error) throw error;
    return liveClientToRow((data as any) as unknown as LiveClientRecord);
  } catch (error) {
    console.error('Error in updateClient:', error);
    throw error;
  }
}

export async function deleteClient(id: string): Promise<void> {
  if (!isSupabaseConfigured()) throw new Error('Supabase 설정이 필요합니다.');
  const { error } = await runQuery<null>(
    '고객 삭제',
    sb().from('clients').delete().eq('id', id),
  );
  if (error) throw error;
}

/**
 * 사업 유형 코드 목록 조회 (business_code)
 * NOTE(2026-08-26): public.clients 스키마에는 business_code 테이블이 없다. 빈 배열로 폴백.
 */
export async function fetchBusinessCodes(): Promise<{ value: string; label: string }[]> {
  return [];
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

// public.sessions 테이블 컬럼 (2026-08-26 확정 — 실데이터 보유 테이블, 코드를 여기에 맞춤)
const SESSION_SELECT_FIELDS = 'id, client_id, date, type, content, counselor_name, counselor_id, next_action, created_at';

export async function fetchSessions(clientId: string): Promise<SessionRow[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await runQuery<LiveCounselHistoryRecord[]>(
    '상담 이력 조회',
    sb()
      .from('sessions')
      .select(SESSION_SELECT_FIELDS)
      .eq('client_id', clientId)
      .order('date', { ascending: false }),
  );

  if (error) throw error;
  return ((data ?? []) as LiveCounselHistoryRecord[]).map(row => liveCounselHistoryToSessionRow(row));
}

export async function createSession(input: SessionInsert): Promise<SessionRow> {
  if (!isSupabaseConfigured()) throw new Error('Supabase 설정이 필요합니다.');
  if (!input.client_id) throw new Error('유효한 상담자 ID가 아닙니다.');
  if (!input.counselor_id) throw new Error('로그인한 상담사 정보가 없습니다.');
  const counselorRowId = normalizeCounselorRowId(input.counselor_id);
  if (!counselorRowId) throw new Error('로그인한 상담사 정보가 없습니다.');

  const payload: any = {
    client_id: input.client_id,
    counselor_id: counselorRowId,
    date: input.date,
    content: input.content || null,
    type: input.type || '상담기록',
    next_action: input.next_action || null,
  };

  const { data, error } = await runQuery<LiveCounselHistoryRecord>(
    '상담 이력 등록',
    sb()
      .from('sessions')
      .insert(payload)
      .select(SESSION_SELECT_FIELDS)
      .single(),
  );

  if (error) throw error;

  // 2. 상담 유형에 따른 내담자 참여 단계 자동 업데이트
  const autoStages: Record<string, string> = {
    '초기상담': '초기상담',
    '심층상담': '심층상담',
    '취업지원': '취업지원',
    '취업완료': '취업완료',
    '사후관리': '사후관리',
  };

  const nextStage = autoStages[payload.type];
  if (nextStage) {
    await sb()
      .from('clients')
      .update({ participation_stage: nextStage })
      .eq('id', input.client_id);
  }

  return liveCounselHistoryToSessionRow(data as LiveCounselHistoryRecord);
}

/**
 * ── 참여수당 이력 / 자격증 (allowance_log, client_certificates) ──────────────
 * NOTE(2026-08-26): public.clients 스키마(실데이터 보유, 코드를 이 스키마에 맞추기로 결정)에는
 * allowance_log / client_certificates 테이블이 존재하지 않는다. 조회는 빈 배열로 안전하게
 * 폴백하고, 쓰기 작업은 저장된 것처럼 보이는 걸 막기 위해 명시적으로 에러를 던진다.
 * 이 기능을 다시 쓰려면 해당 테이블을 새로 만들어야 한다.
 */
export async function fetchAllowanceLogs(_clientId: string) {
  return [];
}

export async function updateAllowanceLog(_id: number, _input: any) {
  throw new Error('참여수당 이력 기능은 현재 DB 스키마에서 지원되지 않습니다.');
}

export async function createAllowanceLog(_input: {
  client_id: string;
  round: number;
  start_date: string;
  end_date: string;
  apply_date: string;
  has_income: boolean;
  family_allowance_count: number;
  expected_payment_date: string;
  is_paid: boolean;
  activity_content?: string;
}) {
  throw new Error('참여수당 이력 기능은 현재 DB 스키마에서 지원되지 않습니다.');
}

export async function addCertificate(_clientId: string, _name: string, _date: string | null) {
  throw new Error('자격증 기능은 현재 DB 스키마에서 지원되지 않습니다.');
}

export async function fetchCertificates(_clientId: string): Promise<{ certificate_name: string; acquisition_date: string | null }[]> {
  return [];
}

export async function deleteCertificate(_clientId: string, _name: string) {
  throw new Error('자격증 기능은 현재 DB 스키마에서 지원되지 않습니다.');
}

export async function updateSession(id: string, input: Partial<any>): Promise<void> {
  if (!isSupabaseConfigured()) throw new Error('Supabase 설정이 필요합니다.');

  const payload: any = {};
  if (input.content !== undefined) payload.content = input.content;
  if (input.type !== undefined) payload.type = input.type;
  if (input.date !== undefined) payload.date = input.date;
  if (input.next_action !== undefined) payload.next_action = input.next_action;

  const { error } = await runQuery<null>(
    '상담 이력 수정',
    sb()
      .from('sessions')
      .update(payload)
      .eq('id', id),
  );

  if (error) throw error;
}

export async function deleteSession(id: string): Promise<void> {
  if (!isSupabaseConfigured()) throw new Error('Supabase 설정이 필요합니다.');
  const { error } = await runQuery<null>(
    '상담 이력 삭제',
    sb().from('sessions').delete().eq('id', id),
  );
  if (error) throw error;
}

// ─── Counselors ───────────────────────────────────────────────────────────────

export async function fetchCounselors(): Promise<CounselorRow[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await runQuery<any[]>(
    '상담사 목록 조회',
    sb()
      .from('user')
      .select(`
        user_id, 
        user_name, 
        department, 
        memo, 
        role,
        manager_memo!counselor_id(memo)
      `)
      .eq('role', 5)
      .order('user_name'),
  );

  if (error) throw error;
  const userRows = data ?? [];
  const authUserIds = userRows
    .map((row: any) => row.user_id)
    .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);

  const counselorIdByAuthUserId = new Map<string, string>();
  if (authUserIds.length > 0) {
    const { data: counselorRows, error: counselorError } = await runQuery<any[]>(
      '상담사 내부 식별자 조회',
      sb()
        .from('counselors')
        .select('id, auth_user_id')
        .in('auth_user_id', authUserIds),
    );

    if (counselorError) {
      // 상담사 기본 목록(public.user)은 계속 표시하되, 내부 ID가 필요한 집계/상세만
      // 연결되지 않은 상태로 둔다. DB migration/RLS 미적용이 목록 전체를 숨기지 않게 한다.
      console.warn('상담사 내부 식별자 매핑을 조회하지 못했습니다.', counselorError);
    } else {
      (counselorRows ?? []).forEach((row: any) => {
        if (typeof row.auth_user_id === 'string' && typeof row.id === 'string') {
          counselorIdByAuthUserId.set(row.auth_user_id, row.id);
        }
      });
    }
  }

  return userRows.map((row: any) => {
    // 1:1 관계라도 배열 혹은 객체로 올 수 있어 유연하게 처리
    let memoValue = null;
    const rawMemo = row.manager_memo;
    if (rawMemo) {
      if (Array.isArray(rawMemo) && rawMemo.length > 0) {
        memoValue = rawMemo[0].memo;
      } else if (typeof rawMemo === 'object' && 'memo' in rawMemo) {
        memoValue = (rawMemo as any).memo;
      }
    }

    return {
      user_id: row.user_id,
      counselor_id: counselorIdByAuthUserId.get(row.user_id) ?? null,
      user_name: row.user_name ?? '이름 미상',
      department: row.department ?? '',
      memo: row.memo ?? null,
      memo_bymanager: memoValue,
      role: row.role != null ? normalizeAppRole(row.role) : null,
      client_count: 0,
      completed_count: 0,
    };
  });
}

export async function createCounselor(input: CounselorInsert): Promise<CounselorRow> {
  if (!isSupabaseConfigured()) throw new Error('Supabase 설정이 필요합니다.');
  
  // 1. user 테이블 등록
  const payload = {
    user_name: input.user_name,
    department: input.department ?? '',
    memo: input.memo ?? null,
    role: input.role ?? null,
  };
  
  const { data, error } = await runQuery<any>(
    '상담사 등록',
    sb()
      .from('user')
      .insert(payload)
      .select('user_id, user_name, department, memo, role')
      .single(),
  );
  if (error) throw error;
  
  const newUserId = (data as any).user_id;

  // 2. manager_memo 테이블 등록 (데이터가 있을 때만)
  if (input.memo_bymanager) {
    const { data: authData } = await sb().auth.getUser();
    const managerId = authData.user?.id;
    
    const { error: memoError } = await sb()
      .from('manager_memo')
      .insert({ 
        manager_id: managerId || newUserId, // 매니저 권한이면 로그인한 ID, 아니면 본인 
        counselor_id: newUserId, 
        memo: input.memo_bymanager 
      });
    if (memoError) throw memoError;
  }

  return {
    user_id: newUserId,
    counselor_id: null,
    user_name: (data as any).user_name ?? '이름 미상',
    department: (data as any).department ?? '',
    memo: (data as any).memo ?? null,
    memo_bymanager: input.memo_bymanager ?? null,
    role: (data as any).role != null ? normalizeAppRole((data as any).role) : null,
    client_count: 0,
    completed_count: 0,
  };
}

export async function updateCounselor(userId: string, input: Partial<CounselorInsert>): Promise<CounselorRow> {
  if (!isSupabaseConfigured()) throw new Error('Supabase 설정이 필요합니다.');

  // 1. user 테이블 필드 업데이트
  const userPayload: Record<string, any> = {};
  if (input.user_name !== undefined) userPayload.user_name = input.user_name;
  if (input.department !== undefined) userPayload.department = input.department;
  if (input.memo !== undefined) userPayload.memo = input.memo;
  if (input.role !== undefined) userPayload.role = input.role;

  if (Object.keys(userPayload).length > 0) {
    const { error: userError } = await sb().from('user').update(userPayload).eq('user_id', userId);
    if (userError) throw userError;
  }

  // 2. manager_memo 테이블 필드 업데이트 (Upsert)
  if (input.memo_bymanager !== undefined) {
    const { data: authData } = await sb().auth.getUser();
    const managerId = authData.user?.id;

    const { error: memoError } = await sb()
      .from('manager_memo')
      .upsert({ 
        manager_id: managerId,
        counselor_id: userId, 
        memo: input.memo_bymanager 
      }, { onConflict: 'counselor_id' });
    if (memoError) throw memoError;
  }

  // 3. 최신 데이터 조회 후 반환
  const counselors = await fetchCounselors();
  const updated = counselors.find(c => c.user_id === userId);
  if (!updated) throw new Error('상담사를 찾을 수 없습니다.');
  return updated;
}

export async function deleteCounselor(userId: string): Promise<void> {
  if (!isSupabaseConfigured()) throw new Error('Supabase 설정이 필요합니다.');
  const { error } = await runQuery<null>(
    '상담사 삭제',
    sb().from('user').delete().eq('user_id', userId),
  );
  if (error) throw error;
}

// ─── Surveys ─────────────────────────────────────────────────────────────────

export async function fetchSurveys(clientId: string): Promise<SurveyRow[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await sb()
    .from('job_search_survey')
    .select('*')
    .eq('client_id', clientId)
    .order('survey_date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createSurvey(input: any): Promise<SurveyRow> {
  if (!isSupabaseConfigured()) throw new Error('Supabase 설정이 필요합니다.');
  const { data, error } = await sb().from('job_search_survey').insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateSurvey(id: string, input: any): Promise<SurveyRow> {
  if (!isSupabaseConfigured()) throw new Error('Supabase 설정이 필요합니다.');
  const { data, error } = await sb()
    .from('job_search_survey')
    .update(input)
    .eq('survey_id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Memo Cards ───────────────────────────────────────────────────────────────

export async function fetchMemoCards(counselorId: string): Promise<MemoCardRow[]> {
  if (!isSupabaseConfigured()) return [];
  const scopedCounselorId = normalizeCounselorRowId(counselorId);
  if (!scopedCounselorId) return [];

  const { data, error } = await runQuery<MemoCardRow[]>(
    '메모 카드 조회',
    sb()
      .from('memo_cards')
      .select('*')
      .eq('counselor_id', scopedCounselorId)
      .order('sort_order', { ascending: true }),
  );
  if (error) throw error;
  return data ?? [];
}

export async function createMemoCard(input: MemoCardInsert): Promise<MemoCardRow> {
  if (!isSupabaseConfigured()) throw new Error('Supabase 설정이 필요합니다.');
  const { data, error } = await runQuery<MemoCardRow>(
    '메모 카드 등록',
    sb().from('memo_cards').insert(input).select().single(),
  );
  if (error) throw error;
  if (!data) throw new Error('메모 카드 등록 결과가 비어 있습니다.');
  return data;
}

export async function updateMemoCard(id: string, input: Partial<MemoCardInsert>): Promise<MemoCardRow> {
  if (!isSupabaseConfigured()) throw new Error('Supabase 설정이 필요합니다.');
  const { data, error } = await runQuery<MemoCardRow>(
    '메모 카드 수정',
    sb()
      .from('memo_cards')
      .update(input)
      .eq('id', id)
      .select()
      .single(),
  );
  if (error) throw error;
  if (!data) throw new Error('메모 카드 수정 결과가 비어 있습니다.');
  return data;
}

export async function deleteMemoCard(id: string): Promise<void> {
  if (!isSupabaseConfigured()) throw new Error('Supabase 설정이 필요합니다.');
  const { error } = await runQuery<null>(
    '메모 카드 삭제',
    sb().from('memo_cards').delete().eq('id', id),
  );
  if (error) throw error;
}

export type {
  DashboardCalendarEntry,
  DashboardMonthlyStat,
  DashboardStats,
} from './api.dashboard';

export {
  fetchDashboardCalendarEntries,
  fetchDashboardCalendarMonthCounts,
  fetchDashboardMonthlyStats,
  fetchDashboardStats,
  fetchMyMemo,
  searchDashboardClients,
  updateMyMemo,
} from './api.dashboard';

// ─── Mappers ──────────────────────────────────────────────────────────────────

function liveClientToRow(row: LiveClientRecord): ClientRow {
  const parseSafeDate = (dateStr: string | null | undefined): string => {
    if (!dateStr) return new Date().toISOString();
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  };

  const createdAt = parseSafeDate(row.created_at);
  const updatedAt = row.updated_at ? parseSafeDate(row.updated_at) : createdAt;

  return {
    id: row.id,
    seq_no: row.seq_no ?? null,
    year: row.year ?? null,
    assignment_type: row.assignment_type ?? null,
    name: row.name,
    resident_id_masked: row.resident_id_masked ?? null,
    phone: row.phone ?? null,
    last_counsel_date: row.last_counsel_date ?? null,
    age: row.age ?? null,
    gender: row.gender ?? null,
    business_type: row.business_type ?? null,
    participation_type: row.participation_type ?? null,
    participation_stage: trimOrNull(row.participation_stage),
    competency_grade: row.competency_grade ?? null,
    recognition_date: row.recognition_date ?? null,
    desired_job: row.desired_job ?? null,
    counsel_notes: row.counsel_notes ?? null,
    address: row.address ?? null,
    school: row.school ?? null,
    major: row.major ?? null,
    education_level: row.education_level ?? null,
    initial_counsel_date: row.initial_counsel_date ?? null,
    iap_date: row.iap_date ?? null,
    iap_duration: row.iap_duration ?? null,
    allowance_apply_date: row.allowance_apply_date ?? null,
    rediagnosis_date: row.rediagnosis_date ?? null,
    rediagnosis_yn: row.rediagnosis_yn ?? null,
    work_exp_type: row.work_exp_type ?? null,
    work_exp_intent: row.work_exp_intent ?? null,
    work_exp_company: row.work_exp_company ?? null,
    work_exp_period: row.work_exp_period ?? null,
    work_exp_completed: row.work_exp_completed ?? null,
    training_name: row.training_name ?? null,
    training_start: row.training_start ?? null,
    training_end: row.training_end ?? null,
    training_allowance: row.training_allowance ?? null,
    intensive_start: row.intensive_start ?? null,
    intensive_end: row.intensive_end ?? null,
    support_end_date: row.support_end_date ?? null,
    employment_type: row.employment_type ?? null,
    employment_date: row.employment_date ?? null,
    employer: row.employer ?? null,
    job_title: row.job_title ?? null,
    salary: row.salary ?? null,
    employment_duration: row.employment_duration ?? null,
    resignation_date: row.resignation_date ?? null,
    retention_1m_date: row.retention_1m_date ?? null,
    retention_1m_yn: row.retention_1m_yn ?? null,
    retention_6m_date: row.retention_6m_date ?? null,
    retention_6m_yn: row.retention_6m_yn ?? null,
    retention_12m_date: row.retention_12m_date ?? null,
    retention_12m_yn: row.retention_12m_yn ?? null,
    retention_18m_date: row.retention_18m_date ?? null,
    retention_18m_yn: row.retention_18m_yn ?? null,
    counselor_name: row.counselor_name ?? null,
    counselor_id: row.counselor_id ?? null,
    branch: row.branch ?? null,
    follow_up: row.follow_up ?? null,
    score: row.score ?? null,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function liveCounselHistoryToSessionRow(row: LiveCounselHistoryRecord): SessionRow {
  const parseSafeDate = (dateStr: string | null | undefined): string => {
    if (!dateStr) return new Date().toISOString();
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  };

  return {
    id: row.id,
    client_id: row.client_id,
    date: row.date,
    type: row.type || '일반상담',
    content: row.content,
    counselor_name: row.counselor_name ?? null,
    counselor_id: row.counselor_id ?? null,
    next_action: row.next_action,
    created_at: parseSafeDate(row.created_at ?? row.date),
  };
}

// encodeSessionPayload 외부 노출 (ClientDetail 등에서 사용 가능)
export { encodeSessionPayload };
