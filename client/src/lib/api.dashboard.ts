import {
  executeSupabaseRequest,
  getSupabaseClient,
  isSupabaseConfigured,
} from './supabase';
import type { ClientRow } from './supabase';

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

const ISO_DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
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
  hire_type,
  hire_place,
  hire_job_type,
  hire_payment,
  hire_date,
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
  future_card_stat,
  memo,
  business_code (
    participate_type
  ),
  created_at,
  update_at
`;

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
  desired_job_1: string | null;
  desired_job_2: string | null;
  desired_job_3: string | null;
  hire_type: string | null;
  hire_place: string | null;
  hire_job_type: string | null;
  hire_payment: number | null;
  hire_date: string | null;
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
  future_card_stat: number | null;
  memo: string | null;
  business_code?: { participate_type: string | null }[] | null;
  created_at: string | null;
  update_at: string | null;
};

type LiveUserMemoRecord = {
  memo: string | null;
};

function normalizeMemoValue(memo: string | null | undefined): string | null {
  if (memo == null) return null;
  return memo.trim().length > 0 ? memo : null;
}

function isMissingSchemaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const code = 'code' in error ? error.code : undefined;
  return code === 'PGRST202' || code === 'PGRST205';
}

function assertDashboardSupabaseConfigured(scopeLabel: string): void {
  if (!isSupabaseConfigured()) {
    throw new Error(`${scopeLabel} 기능을 사용하려면 Supabase 설정이 필요합니다.`);
  }
}

function assertDashboardRuntimeContract(scopeLabel: string, authUserId: string | null | undefined): string {
  assertDashboardSupabaseConfigured(scopeLabel);

  const normalizedAuthUserId = authUserId?.trim();
  if (!normalizedAuthUserId) {
    throw new Error(`${scopeLabel} 기능을 호출하려면 로그인한 상담사 user_id가 필요합니다.`);
  }

  return normalizedAuthUserId;
}

function assertDashboardDateRange(scopeLabel: string, rangeStart: string, rangeEnd: string): void {
  if (!ISO_DATE_KEY_PATTERN.test(rangeStart) || !ISO_DATE_KEY_PATTERN.test(rangeEnd)) {
    throw new Error(`${scopeLabel} 기능을 호출하려면 YYYY-MM-DD 형식의 조회 기간이 필요합니다.`);
  }

  if (rangeStart > rangeEnd) {
    throw new Error(`${scopeLabel} 기능을 호출하려면 시작일이 종료일보다 늦지 않은 조회 기간이 필요합니다.`);
  }
}

function parseDashboardNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

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
    birth_date: null,
    email: null,
    MBTI: null,
    certifications: null,
    future_card_stat: row.future_card_stat ?? null,
    business_type: row.business_type_code != null ? String(row.business_type_code) : null,
    participation_type: row.participation_type ?? null,
    participation_stage: row.participation_stage ?? null,
    capa: null,
    recognition_date: null,
    desired_job: row.desired_job_1 ?? null,
    desired_job_1: row.desired_job_1 ?? null,
    desired_job_2: row.desired_job_2 ?? null,
    desired_job_3: row.desired_job_3 ?? null,
    desired_area_1: null,
    desired_area_2: null,
    desired_area_3: null,
    desired_payment: null,
    has_car: false,
    is_working_parttime: false,
    can_drive: null,
    counsel_notes: null,
    address: null,
    address_1: null,
    address_2: null,
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
    training_name: null,
    training_start: null,
    training_end: row.job_place_end ?? null,
    training_allowance: null,
    intensive_start: null,
    intensive_end: null,
    support_end_date: null,
    hire_place: row.hire_place ?? null,
    hire_job_type: row.hire_job_type ?? null,
    hire_date: row.hire_date ?? null,
    hire_payment: row.hire_payment ?? null,
    employment_duration: null,
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
    participate_type: Array.isArray(row.business_code) ? row.business_code[0]?.participate_type ?? null : null,
    created_at: createdAt,
    update_at: updatedAt,
  };
}

export interface DashboardStats {
  totalClients: number;
  inProgress: number;
  employed: number;
  followUpNeeded: number;
  averageScore: number | null;
  scoredClients: number;
  unscoredClients: number;
  scoreDistribution: { range: string; count: number }[];
  stageBreakdown: { stage: string; count: number }[];
}

export interface DashboardMonthlyStat {
  month: string;
  clients: number;
  sessions: number;
}

export interface DashboardCalendarEntry {
  counselId: string;
  clientId: string;
  clientName: string;
  counselDate: string;
  startTime: string | null;
  endTime: string | null;
  participationStage: string | null;
}

const DASHBOARD_STAGE_ORDER = [
  '초기상담',
  '심층상담',
  '취업지원',
  '직업훈련',
  '취업알선',
  '취업완료',
  '사후관리',
];

function compareDashboardStage(a: string, b: string): number {
  const aIndex = DASHBOARD_STAGE_ORDER.indexOf(a);
  const bIndex = DASHBOARD_STAGE_ORDER.indexOf(b);

  if (aIndex >= 0 && bIndex >= 0) return aIndex - bIndex;
  if (aIndex >= 0) return -1;
  if (bIndex >= 0) return 1;
  return a.localeCompare(b, 'ko');
}

const DASHBOARD_SCORE_RANGES = [
  { label: '0-59', min: 0, max: 59 },
  { label: '60-69', min: 60, max: 69 },
  { label: '70-79', min: 70, max: 79 },
  { label: '80-89', min: 80, max: 89 },
  { label: '90-100', min: 90, max: 100 },
];

function buildDashboardScoreDistribution(scores: number[]): { range: string; count: number }[] {
  return DASHBOARD_SCORE_RANGES.map(range => ({
    range: range.label,
    count: scores.filter(score => score >= range.min && score <= range.max).length,
  }));
}

function formatDashboardMonthLabel(monthKey: string): string {
  return `${Number(monthKey.slice(5, 7))}월`;
}

function buildRecentDashboardMonthKeys(monthCount: number): string[] {
  const normalizedMonthCount = Math.max(1, Math.min(24, Math.trunc(monthCount)));
  const cursor = new Date();
  cursor.setDate(1);
  cursor.setHours(0, 0, 0, 0);
  cursor.setMonth(cursor.getMonth() - (normalizedMonthCount - 1));

  return Array.from({ length: normalizedMonthCount }, (_, index) => {
    const date = new Date(cursor.getFullYear(), cursor.getMonth() + index, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  });
}

function createDashboardMonthlyBuckets(monthCount: number): DashboardMonthlyStat[] {
  return buildRecentDashboardMonthKeys(monthCount).map(monthKey => ({
    month: formatDashboardMonthLabel(monthKey),
    clients: 0,
    sessions: 0,
  }));
}

export async function searchDashboardClients(
  authUserId: string,
  rawQuery: string,
): Promise<ClientRow[]> {
  const scopedAuthUserId = assertDashboardRuntimeContract('대시보드 검색', authUserId);
  const normalizedQuery = rawQuery.trim();
  if (!normalizedQuery) return [];

  const safeQuery = normalizedQuery.replace(/[%(),]/g, '');
  if (!safeQuery) return [];

  const likeQuery = `%${safeQuery}%`;
  const { data, error } = await runQuery<LiveClientRecord[]>(
    '대시보드 고객 검색',
    sb()
      .from('client')
      .select(CLIENT_SELECT_FIELDS)
      .eq('counselor_id', scopedAuthUserId)
      .or(`client_name.ilike.${likeQuery},phone_encrypted.ilike.${likeQuery},desired_job_1.ilike.${likeQuery}`)
      .order('update_at', { ascending: false, nullsFirst: false })
      .limit(10),
  );

  if (error) throw error;
  return ((data ?? []) as LiveClientRecord[]).map(row => liveClientToRow(row));
}

export async function fetchDashboardStats(authUserId?: string): Promise<DashboardStats> {
  assertDashboardSupabaseConfigured('대시보드 통계');
  const scopedAuthUserId = authUserId?.trim() || null;

  let query = sb()
    .from('client')
    .select('participation_stage, retest_stat, continue_serv_1_stat');

  if (scopedAuthUserId) {
    query = query.eq('counselor_id', scopedAuthUserId);
  }

  const { data, error } = await runQuery<Array<{
    participation_stage: string | null;
    retest_stat: number | null;
    continue_serv_1_stat: number | string | null;
  }>>('대시보드 통계 조회', query);
  if (error) throw error;

  const rows = (data ?? []) as Array<{
    participation_stage: string | null;
    retest_stat: number | null;
    continue_serv_1_stat: number | string | null;
  }>;

  const stageCounts = new Map<string, number>();
  const scores = rows
    .map(row => parseDashboardNumber(row.retest_stat))
    .filter((score): score is number => score != null);

  rows.forEach(row => {
    const stage = row.participation_stage?.trim();
    if (!stage) return;
    stageCounts.set(stage, (stageCounts.get(stage) ?? 0) + 1);
  });

  const stageBreakdown = Array.from(stageCounts.entries())
    .sort(([stageA], [stageB]) => compareDashboardStage(stageA, stageB))
    .map(([stage, count]) => ({ stage, count }));

  return {
    totalClients: rows.length,
    inProgress: rows.filter(row => row.participation_stage !== '취업완료').length,
    employed: rows.filter(row => row.participation_stage === '취업완료').length,
    followUpNeeded: rows.filter(
      row => (parseDashboardNumber(row.continue_serv_1_stat) ?? 0) > 0,
    ).length,
    averageScore: scores.length > 0
      ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1))
      : null,
    scoredClients: scores.length,
    unscoredClients: rows.length - scores.length,
    scoreDistribution: buildDashboardScoreDistribution(scores),
    stageBreakdown,
  };
}

export async function fetchDashboardMonthlyStats(
  authUserId: string,
  monthCount = 12,
): Promise<DashboardMonthlyStat[]> {
  const scopedAuthUserId = assertDashboardRuntimeContract('대시보드 월간 통계', authUserId);
  const monthKeys = buildRecentDashboardMonthKeys(monthCount);
  const [firstMonthKey, lastMonthKey] = [monthKeys[0], monthKeys[monthKeys.length - 1]];
  const rangeStart = `${firstMonthKey}-01`;
  const rangeEndDate = new Date(Number(lastMonthKey.slice(0, 4)), Number(lastMonthKey.slice(5, 7)), 0);
  const rangeEnd = `${rangeEndDate.getFullYear()}-${String(rangeEndDate.getMonth() + 1).padStart(2, '0')}-${String(rangeEndDate.getDate()).padStart(2, '0')}`;

  const { data: histories, error } = await runQuery<Array<{
    client_id: number | null;
    counsel_date: string | null;
  }>>(
    '대시보드 월간 통계 조회',
    sb()
      .from('counsel_history')
      .select('client_id, counsel_date')
      .eq('user_id', scopedAuthUserId)
      .gte('counsel_date', rangeStart)
      .lte('counsel_date', rangeEnd),
  );

  if (error) throw error;

  const sessionCountByMonth = new Map<string, number>();
  const clientIdsByMonth = new Map<string, Set<number>>();

  (histories ?? []).forEach(row => {
    if (!row.counsel_date) return;
    const monthKey = row.counsel_date.slice(0, 7);
    if (!monthKeys.includes(monthKey)) return;

    sessionCountByMonth.set(monthKey, (sessionCountByMonth.get(monthKey) ?? 0) + 1);
    if (typeof row.client_id === 'number') {
      const clientIds = clientIdsByMonth.get(monthKey) ?? new Set<number>();
      clientIds.add(row.client_id);
      clientIdsByMonth.set(monthKey, clientIds);
    }
  });

  return createDashboardMonthlyBuckets(monthCount).map((bucket, index) => {
    const monthKey = monthKeys[index];
    return {
      month: bucket.month,
      clients: clientIdsByMonth.get(monthKey)?.size ?? 0,
      sessions: sessionCountByMonth.get(monthKey) ?? 0,
    };
  });
}

export async function fetchDashboardCalendarMonthCounts(
  authUserId: string,
  monthStart: string,
  monthEnd: string,
): Promise<Record<string, number>> {
  const scopedAuthUserId = assertDashboardRuntimeContract('캘린더', authUserId);
  assertDashboardDateRange('캘린더', monthStart, monthEnd);

  const { data: histories, error } = await runQuery<Array<{
    client_id: number | null;
    counsel_date: string | null;
  }>>(
    '캘린더 월간 일정 수 조회',
    sb()
      .from('counsel_history')
      .select('client_id, counsel_date')
      .eq('user_id', scopedAuthUserId)
      .gte('counsel_date', monthStart)
      .lte('counsel_date', monthEnd),
  );

  if (error) throw error;

  const clientIds = Array.from(
    new Set((histories ?? []).map(row => row.client_id).filter((id): id is number => typeof id === 'number')),
  );
  if (clientIds.length === 0) return {};

  const { data: clients, error: clientError } = await runQuery<Array<{
    client_id: number;
  }>>(
    '캘린더 고객 소유권 검증',
    sb()
      .from('client')
      .select('client_id')
      .eq('counselor_id', scopedAuthUserId)
      .in('client_id', clientIds),
  );

  if (clientError) throw clientError;

  const allowedClientIds = new Set((clients ?? []).map(row => row.client_id));

  return (histories ?? []).reduce<Record<string, number>>((acc, row) => {
    if (typeof row.client_id !== 'number' || !row.counsel_date || !allowedClientIds.has(row.client_id)) return acc;
    acc[row.counsel_date] = (acc[row.counsel_date] ?? 0) + 1;
    return acc;
  }, {});
}

export async function fetchDashboardCalendarEntries(
  authUserId: string,
  rangeStart: string,
  rangeEnd: string,
): Promise<DashboardCalendarEntry[]> {
  const scopedAuthUserId = assertDashboardRuntimeContract('캘린더', authUserId);
  assertDashboardDateRange('캘린더', rangeStart, rangeEnd);

  const { data: histories, error } = await runQuery<Array<{
    counsel_id: number;
    client_id: number | null;
    user_id: string | null;
    counsel_date: string | null;
    start_time: string | null;
    end_time: string | null;
    session_number: number | null;
    counselor_opinion: string | null;
    counsel_type: string | null;
    document_link: string | null;
    economic_situation: number | null;
    social_situation_family: number | null;
    social_situation_society: number | null;
    self_esteem: number | null;
    self_efficacy: number | null;
    holland_code: string | null;
    career_fluidity: number | null;
    info_gathering: number | null;
    personality_test_result: string | null;
    life_history_result: string | null;
    profiling_grade: string | null;
    memo: string | null;
    create_at: string | null;
  }>>(
    '캘린더 일정 조회',
    sb()
      .from('counsel_history')
      .select('counsel_id, client_id, user_id, counsel_date, start_time, end_time, session_number, counselor_opinion, counsel_type, document_link, economic_situation, social_situation_family, social_situation_society, self_esteem, self_efficacy, holland_code, career_fluidity, info_gathering, personality_test_result, life_history_result, profiling_grade, memo, create_at')
      .eq('user_id', scopedAuthUserId)
      .gte('counsel_date', rangeStart)
      .lte('counsel_date', rangeEnd)
      .order('counsel_date', { ascending: false })
      .order('start_time', { ascending: false }),
  );

  if (error) throw error;

  const clientIds = Array.from(
    new Set((histories ?? []).map(row => row.client_id).filter((id): id is number => typeof id === 'number')),
  );
  if (clientIds.length === 0) return [];

  const { data: clients, error: clientError } = await runQuery<Array<{
    client_id: number;
    client_name: string;
    counselor_id: string | null;
    participation_stage: string | null;
  }>>(
    '캘린더 일정 고객 조회',
    sb()
      .from('client')
      .select('client_id, client_name, counselor_id, participation_stage')
      .eq('counselor_id', scopedAuthUserId)
      .in('client_id', clientIds),
  );

  if (clientError) throw clientError;

  const clientMap = new Map((clients ?? []).map(client => [client.client_id, client]));

  return (histories ?? [])
    .map(row => {
      const client = row.client_id != null ? clientMap.get(row.client_id) : undefined;
      if (!client || !row.counsel_date) return null;
      return {
        counselId: String(row.counsel_id),
        clientId: String(client.client_id),
        clientName: client.client_name,
        counselDate: row.counsel_date,
        startTime: row.start_time,
        endTime: row.end_time,
        participationStage: client.participation_stage,
      } satisfies DashboardCalendarEntry;
    })
    .filter((row): row is DashboardCalendarEntry => row !== null);
}

export async function fetchMyMemo(authUserId: string): Promise<string | null> {
  const scopedAuthUserId = assertDashboardRuntimeContract('개인 메모', authUserId);

  const { data, error } = await runQuery<LiveUserMemoRecord | null>(
    '개인 메모 조회',
    sb()
      .from('user')
      .select('memo')
      .eq('user_id', scopedAuthUserId)
      .maybeSingle(),
  );

  if (error) {
    if (isMissingSchemaError(error)) {
      return null;
    }
    throw error;
  }

  return normalizeMemoValue((data as LiveUserMemoRecord | null)?.memo ?? null);
}

export async function updateMyMemo(authUserId: string, memo: string | null): Promise<string | null> {
  const normalizedMemo = normalizeMemoValue(memo);
  const scopedAuthUserId = assertDashboardRuntimeContract('개인 메모', authUserId);

  const { error, count } = await runQuery<null>(
    '개인 메모 저장',
    sb()
      .from('user')
      .update({ memo: normalizedMemo }, { count: 'exact' })
      .eq('user_id', scopedAuthUserId),
  );

  if (error) throw error;
  if (count === 0) {
    throw new Error('상담사 메모 UPDATE가 적용되지 않았습니다. public.user의 UPDATE 정책과 user_id/auth.uid() 매핑을 확인하세요.');
  }

  const refreshedMemo = await fetchMyMemo(scopedAuthUserId);
  if (refreshedMemo !== normalizedMemo) {
    if (refreshedMemo == null && normalizedMemo == null) {
      return null;
    }
    throw new Error('상담사 메모 저장 후 재조회가 되지 않았습니다. public.user SELECT/UPDATE 정책을 함께 확인하세요.');
  }

  return refreshedMemo;
}
