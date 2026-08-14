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

type LiveClientRecord = {
  client_id: number;
  client_name: string;
  counselor_id: string | null;
  age: number | null;
  gender_code: string | null;
  phone_encrypted: string | null;
  education_level: string | null;
  school_name: string | null;
  major: string | null;
  business_type_code: number | null;
  participation_type: string | null;
  participation_stage: string | null;
  assignment_type: string | null;
  capa: string | null;
  desired_job_1: string | null;
  desired_job_2: string | null;
  desired_job_3: string | null;
  desired_area_1: string | null;
  desired_area_2: string | null;
  desired_area_3: string | null;
  desired_payment: number | null;
  hire_type: string | null;
  job_place_start: string | null;
  job_place_end: string | null;
  iap_to: string | null;
  retest_stat: number | null;
  retest_date: string | null;
  continue_serv_1_date: string | null;
  continue_serv_1_stat: number | null;
  continue_serv_6_date: string | null;
  continue_serv_6_stat: number | null;
  continue_serv_12_date: string | null;
  continue_serv_12_stat: number | null;
  continue_serv_18_date: string | null;
  continue_serv_18_stat: number | null;
  memo: string | null;
  hire_place: string | null;
  hire_job_type: string | null;
  hire_date: string | null;
  hire_payment: number | null;
  address_1: string | null;
  address_2: string | null;
  has_car: boolean | string | null;
  is_working_parttime: boolean | string | null;
  can_drive: boolean | string | null;
  future_card_stat: number | null;
  MBTI: string | null;
  email: string | null;
  birth_date: string | null;
  client_certificates?: { certificate_name: string; acquisition_date: string | null }[] | null;
  business_code?: { participate_type: string | null }[] | null;
  job_place_support_end: string | null;
  created_at: string | null;
  update_at: string | null;
};

type LiveCounselHistoryRecord = {
  counsel_id: number;
  client_id: number;
  user_id: string | null;
  counsel_date: string;
  start_time: string | null;
  end_time: string | null;
  session_number: number | null;
  counselor_opinion: string | null;
  counsel_type: string | null;
  create_at: string | null;
  document_link?: string | null;
  economic_situation?: number | null;
  social_situation_family?: number | null;
  social_situation_society?: number | null;
  self_esteem?: number | null;
  self_efficacy?: number | null;
  holland_code?: string | null;
  career_fluidity?: number | null;
  info_gathering?: number | null;
  personality_test_result?: string | null;
  life_history_result?: string | null;
  profiling_grade?: string | null;
  memo?: string | null;
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

const CLIENT_SELECT_FIELDS = `
  client_id,
  client_name,
  counselor_id,
  age,
  gender_code,
  phone_encrypted,
  education_level,
  school_name,
  major,
  business_type_code,
  participation_type,
  participation_stage,
  desired_job_1,
  desired_job_2,
  desired_job_3,
  capa,
  desired_area_1,
  desired_area_2,
  desired_area_3,
  desired_payment,
  hire_type,
  job_place_start,
  job_place_end,
  iap_to,
  retest_stat,
  retest_date,
  continue_serv_1_date,
  continue_serv_1_stat,
  continue_serv_6_date,
  continue_serv_6_stat,
  continue_serv_12_date,
  continue_serv_12_stat,
  continue_serv_18_date,
  continue_serv_18_stat,
  memo,
  hire_place,
  hire_job_type,
  hire_date,
  hire_payment,
  address_1,
  address_2,
  has_car,
  is_working_parttime,
  can_drive,
  future_card_stat,
  MBTI,
  email,
  birth_date,
  created_at,
  update_at,
  business_code (
    participate_type
  ),
  allowance_log (
    round,
    apply_date
  )
`;

export async function fetchClients(counselorId?: string): Promise<ClientRow[]> {
  if (!isSupabaseConfigured()) return [];

  let q = sb()
    .from('client')
    .select(CLIENT_SELECT_FIELDS)
    .order('iap_to', { ascending: true, nullsFirst: false });

  if (counselorId) q = q.eq('counselor_id', counselorId);

  const { data, error } = await runQuery<LiveClientRecord[]>('고객 목록 조회', q);
  if (error) throw error;
  if (!data) return [];
  return ((data as any) as unknown as LiveClientRecord[]).map(row => liveClientToRow(row));
}

export async function fetchClientById(id: string): Promise<ClientRow | null> {
  if (!isSupabaseConfigured()) return null;

  const numericId = Number(id);
  if (Number.isNaN(numericId)) return null;

  const { data, error } = await runQuery<LiveClientRecord>(
    '고객 상세 조회',
    sb()
      .from('client')
      .select(CLIENT_SELECT_FIELDS)
      .eq('client_id', numericId)
      .single(),
  );

  if (error) {
    if ((error as { code?: string }).code === 'PGRST116') return null; // not found
    throw error;
  }

  const clientRow = liveClientToRow((data as any) as unknown as LiveClientRecord);

  // Separately fetch certificates
  try {
    const certs = await fetchCertificates(id);
    clientRow.certificates = certs;
    clientRow.certifications = certs.map(c => `${c.certificate_name}${c.acquisition_date ? ` (${c.acquisition_date})` : ''}`).join(', ');
  } catch (e) {
    console.error('Failed to fetch certificates', e);
  }

  return clientRow;
}

export async function createClient(input: any): Promise<ClientRow> {
  if (!isSupabaseConfigured()) throw new Error('Supabase 설정이 필요합니다.');

  const payload = {
    client_name: input.name,
    counselor_id: input.counselor_id,
    age: input.age,
    gender_code: input.gender,
    phone_encrypted: input.phone,
    resident_id: input.resident_id,
    birth_date: input.birth_date,
    address_1: input.address_1,
    address_2: input.address_2,
    has_car: input.has_car,
    can_drive: input.can_drive,
    MBTI: input.MBTI,
    is_working_parttime: input.is_working_parttime,
    future_card_stat: input.future_card_stat ? 1 : 0,
    desired_job_1: input.desired_job_1,
    desired_job_2: input.desired_job_2,
    desired_job_3: input.desired_job_3,
    desired_area_1: input.desired_area_1,
    desired_area_2: input.desired_area_2,
    desired_area_3: input.desired_area_3,
    desired_payment: input.desired_payment,
    education_level: input.education_level,
    school_name: input.school,
    major: input.major,
    business_type_code: input.business_type ? Number(input.business_type) : null,
    participation_type: input.participation_type,
    participation_stage: input.participation_stage,
    memo: input.memo,
    email: input.email,
  };

  const { data, error } = await runQuery<LiveClientRecord>(
    '고객 등록',
    sb()
      .from('client')
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
    const { data, error } = await sb()
      .from('client')
      .update(updates)
      .eq('client_id', Number(id))
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
    sb().from('client').delete().eq('client_id', Number(id)),
  );
  if (error) throw error;
}

/**
 * 사업 유형 코드 목록 조회 (business_code)
 */
export async function fetchBusinessCodes(): Promise<{ value: string; label: string }[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await sb()
    .from('business_code')
    .select('business_type, participate_type')
    .order('business_type');

  if (error) throw error;
  return (data || []).map((b: any) => ({
    value: String(b.business_type),
    label: b.participate_type || `유형 ${b.business_type}`
  }));
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

const SESSION_SELECT_FIELDS =
  'counsel_id, client_id, user_id, counsel_date, start_time, end_time, session_number, counselor_opinion, counsel_type, document_link, economic_situation, social_situation_family, social_situation_society, self_esteem, self_efficacy, holland_code, career_fluidity, info_gathering, personality_test_result, life_history_result, profiling_grade, memo, create_at';

export async function fetchSessions(clientId: string): Promise<SessionRow[]> {
  if (!isSupabaseConfigured()) return [];

  const numericClientId = Number(clientId);
  if (Number.isNaN(numericClientId)) return [];

  const { data, error } = await runQuery<LiveCounselHistoryRecord[]>(
    '상담 이력 조회',
    sb()
      .from('counsel_history')
      .select(SESSION_SELECT_FIELDS)
      .eq('client_id', numericClientId)
      .order('counsel_date', { ascending: false })
      .order('start_time', { ascending: false }),
  );

  if (error) throw error;
  return ((data ?? []) as LiveCounselHistoryRecord[]).map(row => liveCounselHistoryToSessionRow(row));
}

export async function createSession(input: SessionInsert): Promise<SessionRow> {
  if (!isSupabaseConfigured()) throw new Error('Supabase 설정이 필요합니다.');

  const numericClientId = Number(input.client_id);
  if (Number.isNaN(numericClientId)) throw new Error('유효한 상담자 ID가 아닙니다.');
  if (!input.counselor_id) throw new Error('로그인한 상담사 정보가 없습니다.');

  const payload: any = {
    client_id: numericClientId,
    user_id: input.counselor_id,
    counsel_date: input.date,
    session_number: input.session_number ?? null,
    start_time: input.start_time || null,
    end_time: input.end_time || null,
    counselor_opinion: input.content || input.memo || '',
    counsel_type: input.type || '상담기록',
    memo: input.memo || null,
    economic_situation: input.economic_situation ?? null,
    social_situation_family: input.social_situation_family ?? null,
    social_situation_society: input.social_situation_society ?? null,
    document_link: input.document_link || null,
    self_esteem: input.self_esteem ?? null,
    self_efficacy: input.self_efficacy ?? null,
    holland_code: input.holland_code || null,
    career_fluidity: input.career_fluidity ?? null,
    info_gathering: input.info_gathering ?? null,
    personality_test_result: input.personality_test_result || null,
    life_history_result: input.life_history_result || null,
    profiling_grade: input.profiling_grade || null,
    create_at: input.date, // keep for compatibility
  };

  const { data, error } = await runQuery<LiveCounselHistoryRecord>(
    '상담 이력 등록',
    sb()
      .from('counsel_history')
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

  const nextStage = autoStages[payload.counsel_type];
  if (nextStage) {
    await sb()
      .from('client')
      .update({ participation_stage: nextStage })
      .eq('client_id', numericClientId);
  }

  return liveCounselHistoryToSessionRow(data as LiveCounselHistoryRecord);
}

/**
 * 참여수당 이력 (allowance_log)
 */
export async function fetchAllowanceLogs(clientId: string) {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await sb()
    .from('allowance_log')
    .select('*')
    .eq('client_id', Number(clientId))
    .order('round', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function updateAllowanceLog(id: number, input: any) {
  if (!isSupabaseConfigured()) throw new Error('Supabase 설정이 필요합니다.');
  const { data, error } = await sb()
    .from('allowance_log')
    .update(input)
    .eq('allowance_id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function createAllowanceLog(input: {
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
  if (!isSupabaseConfigured()) throw new Error('Supabase 설정이 필요합니다.');

  const payload = {
    client_id: Number(input.client_id),
    round: input.round,
    start_date: input.start_date,
    end_date: input.end_date,
    apply_date: input.apply_date,
    has_income: input.has_income,
    family_allowance_count: input.family_allowance_count,
    expected_payment_date: input.expected_payment_date,
    is_paid: input.is_paid,
    activity_content: input.activity_content || null,
  };

  const { data, error } = await runQuery<Record<string, unknown>>(
    '참여수당 이력 등록',
    sb()
      .from('allowance_log')
      .insert(payload)
      .select()
      .single(),
  );

  if (error) throw error;
  return data;
}

export async function addCertificate(clientId: string, name: string, date: string | null) {
  if (!isSupabaseConfigured()) throw new Error('Supabase 설정이 필요합니다.');
  const { data, error } = await sb()
    .from('client_certificates')
    .insert({
      client_id: Number(clientId),
      certificate_name: name,
      acquisition_date: date
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function fetchCertificates(clientId: string): Promise<{ certificate_name: string; acquisition_date: string | null }[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await sb()
    .from('client_certificates')
    .select('certificate_name, acquisition_date')
    .eq('client_id', Number(clientId));
  if (error) throw error;
  return data || [];
}

export async function deleteCertificate(clientId: string, name: string) {
  if (!isSupabaseConfigured()) throw new Error('Supabase 설정이 필요합니다.');
  const { error } = await sb()
    .from('client_certificates')
    .delete()
    .eq('client_id', Number(clientId))
    .eq('certificate_name', name);
  if (error) throw error;
}

export async function updateSession(id: string, input: Partial<any>): Promise<void> {
  if (!isSupabaseConfigured()) throw new Error('Supabase 설정이 필요합니다.');

  const payload: any = {};
  if (input.content !== undefined || input.counselor_opinion !== undefined) payload.counselor_opinion = input.content ?? input.counselor_opinion;
  if (input.type !== undefined || input.counsel_type !== undefined) payload.counsel_type = input.type ?? input.counsel_type;
  if (input.date !== undefined || input.counsel_date !== undefined) payload.counsel_date = input.date ?? input.counsel_date;
  if (input.session_number !== undefined) payload.session_number = input.session_number;
  if (input.memo !== undefined) payload.memo = input.memo;
  if (input.economic_situation !== undefined) payload.economic_situation = input.economic_situation;
  if (input.social_situation_family !== undefined) payload.social_situation_family = input.social_situation_family;
  if (input.social_situation_society !== undefined) payload.social_situation_society = input.social_situation_society;

  const { error } = await runQuery<null>(
    '상담 이력 수정',
    sb()
      .from('counsel_history')
      .update(payload)
      .eq('counsel_id', Number(id)),
  );

  if (error) throw error;
}

export async function deleteSession(id: string): Promise<void> {
  if (!isSupabaseConfigured()) throw new Error('Supabase 설정이 필요합니다.');
  const counselId = Number(id);
  if (Number.isNaN(counselId)) throw new Error('유효한 상담 이력 ID가 아닙니다.');
  const { error } = await runQuery<null>(
    '상담 이력 삭제',
    sb().from('counsel_history').delete().eq('counsel_id', counselId),
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
  return (data ?? []).map((row: any) => {
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
  const { data, error } = await runQuery<MemoCardRow[]>(
    '메모 카드 조회',
    sb()
      .from('memo_cards')
      .select('*')
      .eq('counselor_id', counselorId)
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
  const updatedAt = row.update_at ? parseSafeDate(row.update_at) : createdAt;

  return {
    id: String(row.client_id),
    seq_no: row.client_id ?? null,
    year: createdAt ? new Date(createdAt).getFullYear() : null,
    assignment_type: null,
    name: row.client_name,
    resident_id_masked: null,
    phone: row.phone_encrypted ?? null,
    last_counsel_date: null,
    age: row.age ?? null,
    gender: row.gender_code === 'M' ? '남' : row.gender_code === 'F' ? '여' : null,
    birth_date: row.birth_date ?? null,
    email: row.email ?? null,
    MBTI: row.MBTI ?? null,
    certifications: row.client_certificates ? row.client_certificates.map(c => `${c.certificate_name}${c.acquisition_date ? ` (${c.acquisition_date})` : ''}`).join(', ') : null,
    certificates: row.client_certificates || [],
    future_card_stat: row.future_card_stat ?? null,
    business_type: row.business_type_code != null ? String(row.business_type_code) : null,
    participation_type: row.participation_type ?? null,
    participation_stage: row.participation_stage ?? null,
    capa: row.capa ?? null,
    recognition_date: null,
    desired_job: row.desired_job_1 ?? null,
    desired_job_1: row.desired_job_1 ?? null,
    desired_job_2: row.desired_job_2 ?? null,
    desired_job_3: row.desired_job_3 ?? null,
    desired_area_1: row.desired_area_1 ?? null,
    desired_area_2: row.desired_area_2 ?? null,
    desired_area_3: row.desired_area_3 ?? null,
    desired_payment: row.desired_payment ?? null,
    counsel_notes: null,
    address: null,
    address_1: row.address_1 ?? null,
    address_2: row.address_2 ?? null,
    has_car: (row.has_car === true || row.has_car === 'Y') ? true : (row.has_car === false || row.has_car === 'N' ? false : null),
    is_working_parttime: (row.is_working_parttime === true || row.is_working_parttime === 'Y') ? true : (row.is_working_parttime === false || row.is_working_parttime === 'N' ? false : null),
    can_drive: (row.can_drive === true || row.can_drive === 'Y') ? true : (row.can_drive === false || row.can_drive === 'N' ? false : null),
    school_name: row.school_name ?? null,
    major: row.major ?? null,
    education_level: row.education_level ?? null,
    initial_counsel_date: createdAt ? createdAt.split('T')[0] : null,
    iap_date: null,
    iap_duration: null,
    allowance_apply_date: null,
    rediagnosis_date: row.retest_date ?? null,
    rediagnosis_yn: row.retest_stat != null ? String(row.retest_stat) : null,
    work_exp_type: null,
    work_exp_intent: null,
    work_exp_company: null,
    work_exp_period: null,
    work_exp_completed: null,
    hire_place: row.hire_place ?? null,
    hire_job_type: row.hire_job_type ?? null,
    hire_date: row.hire_date ?? null,
    hire_payment: row.hire_payment ?? null,
    employment_type: row.hire_type ?? null,
    employment_duration: null,
    training_name: null,
    training_start: null,
    training_end: row.job_place_end ?? null,
    training_allowance: null,
    intensive_start: null,
    intensive_end: null,
    support_end_date: null,
    continue_serv_1_date: row.continue_serv_1_date ?? null,
    continue_serv_1_stat: row.continue_serv_1_stat ?? null,
    continue_serv_6_date: row.continue_serv_6_date ?? null,
    continue_serv_6_stat: row.continue_serv_6_stat ?? null,
    continue_serv_12_date: row.continue_serv_12_date ?? null,
    continue_serv_12_stat: row.continue_serv_12_stat ?? null,
    continue_serv_18_date: row.continue_serv_18_date ?? null,
    continue_serv_18_stat: row.continue_serv_18_stat ?? null,
    counselor_name: null,
    counselor_id: row.counselor_id ?? null,
    branch: null,
    follow_up: false,
    score: null,
    iap_to: row.iap_to ?? null,
    retest_stat: row.retest_stat ?? null,
    memo: row.memo ?? null,
    participate_type: Array.isArray(row.business_code)
      ? row.business_code[0]?.participate_type ?? null
      : null,
    created_at: createdAt,
    update_at: updatedAt,
  };
}

function liveCounselHistoryToSessionRow(row: LiveCounselHistoryRecord): SessionRow {
  const decoded = decodeSessionPayload(row.counselor_opinion, '일반상담');

  const parseSafeDate = (dateStr: string | null | undefined): string => {
    if (!dateStr) return new Date().toISOString();
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  };

  return {
    id: String(row.counsel_id),
    client_id: String(row.client_id),
    date: row.counsel_date,
    type: row.counsel_type || decoded.type,
    content: row.counsel_type ? row.counselor_opinion : decoded.content,
    counselor_name: null,
    counselor_id: row.user_id ?? null,
    next_action: decoded.nextAction,
    session_number: row.session_number ?? null,
    start_time: row.start_time ?? null,
    end_time: row.end_time ?? null,
    document_link: row.document_link ?? null,
    economic_situation: row.economic_situation ?? null,
    social_situation_family: row.social_situation_family ?? null,
    social_situation_society: row.social_situation_society ?? null,
    self_esteem: row.self_esteem ?? null,
    self_efficacy: row.self_efficacy ?? null,
    holland_code: row.holland_code ?? null,
    career_fluidity: row.career_fluidity ?? null,
    info_gathering: row.info_gathering ?? null,
    personality_test_result: row.personality_test_result ?? null,
    life_history_result: row.life_history_result ?? null,
    profiling_grade: row.profiling_grade ?? null,
    memo: row.memo ?? null,
    created_at: parseSafeDate(row.create_at ?? row.counsel_date),
  };
}

// encodeSessionPayload 외부 노출 (ClientDetail 등에서 사용 가능)
export { encodeSessionPayload };
