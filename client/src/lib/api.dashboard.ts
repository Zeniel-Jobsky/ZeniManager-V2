import { isEmploymentCompletedStage } from '@shared/const';
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

/**
 * PostgREST는 .range()가 없으면 프로젝트 기본 max-rows(보통 1000)까지만 반환한다.
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

const ISO_DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// NOTE(2026-08-26): public.clients 스키마 기준 (api.ts의 CLIENT_SELECT_FIELDS와 동일 컬럼 집합).
const CLIENT_SELECT_FIELDS = `
  id,
  name,
  counselor_id,
  age,
  gender,
  phone,
  education_level,
  school,
  major,
  business_type,
  participation_type,
  participation_stage,
  desired_job,
  employment_type,
  employer,
  job_title,
  salary,
  employment_date,
  iap_date,
  rediagnosis_yn,
  rediagnosis_date,
  retention_1m_date,
  retention_1m_yn,
  retention_6m_date,
  retention_6m_yn,
  retention_12m_date,
  retention_12m_yn,
  retention_18m_date,
  retention_18m_yn,
  score,
  counsel_notes,
  created_at,
  updated_at
`;

type LiveClientRecord = {
  id: string;
  name: string;
  counselor_id: string | null;
  age: number | null;
  gender: '남' | '여' | null;
  phone: string | null;
  education_level: string | null;
  school: string | null;
  major: string | null;
  business_type: string | null;
  participation_type: string | null;
  participation_stage: string | null;
  desired_job: string | null;
  employment_type: string | null;
  employer: string | null;
  job_title: string | null;
  salary: string | null;
  employment_date: string | null;
  iap_date: string | null;
  rediagnosis_yn: string | null;
  rediagnosis_date: string | null;
  retention_1m_date: string | null;
  retention_1m_yn: string | null;
  retention_6m_date: string | null;
  retention_6m_yn: string | null;
  retention_12m_date: string | null;
  retention_12m_yn: string | null;
  retention_18m_date: string | null;
  retention_18m_yn: string | null;
  score: number | null;
  counsel_notes: string | null;
  created_at: string | null;
  updated_at: string | null;
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

/**
 * 엑셀 등에서 마이그레이션된 텍스트 값에 눈에 안 보이는 앞뒤 공백이 섞여 있는 경우가 있다.
 * `participation_stage === '취업완료'` 같은 정확 비교가 공백 때문에 조용히 어긋나는 걸 막기
 * 위해 읽어올 때 항상 trim한다.
 */
function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return value ?? null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
  const updatedAt = row.updated_at ? parseSafeDate(row.updated_at) : createdAt;

  return {
    id: row.id,
    seq_no: null,
    year: null,
    assignment_type: null,
    name: row.name,
    resident_id_masked: null,
    phone: row.phone ?? null,
    last_counsel_date: null,
    age: row.age ?? null,
    gender: row.gender ?? null,
    business_type: row.business_type ?? null,
    participation_type: row.participation_type ?? null,
    participation_stage: trimOrNull(row.participation_stage),
    competency_grade: null,
    recognition_date: null,
    desired_job: row.desired_job ?? null,
    counsel_notes: row.counsel_notes ?? null,
    address: null,
    school: row.school ?? null,
    major: row.major ?? null,
    education_level: row.education_level ?? null,
    initial_counsel_date: createdAt ? createdAt.split('T')[0] : null,
    iap_date: row.iap_date ?? null,
    iap_duration: null,
    allowance_apply_date: null,
    rediagnosis_date: row.rediagnosis_date ?? null,
    rediagnosis_yn: row.rediagnosis_yn ?? null,
    work_exp_type: null,
    work_exp_intent: null,
    work_exp_company: null,
    work_exp_period: null,
    work_exp_completed: null,
    training_name: null,
    training_start: null,
    training_end: null,
    training_allowance: null,
    intensive_start: null,
    intensive_end: null,
    support_end_date: null,
    employment_type: row.employment_type ?? null,
    employment_date: row.employment_date ?? null,
    employer: row.employer ?? null,
    job_title: row.job_title ?? null,
    salary: row.salary ?? null,
    employment_duration: null,
    resignation_date: null,
    retention_1m_date: row.retention_1m_date ?? null,
    retention_1m_yn: row.retention_1m_yn ?? null,
    retention_6m_date: row.retention_6m_date ?? null,
    retention_6m_yn: row.retention_6m_yn ?? null,
    retention_12m_date: row.retention_12m_date ?? null,
    retention_12m_yn: row.retention_12m_yn ?? null,
    retention_18m_date: row.retention_18m_date ?? null,
    retention_18m_yn: row.retention_18m_yn ?? null,
    counselor_name: null,
    counselor_id: row.counselor_id ?? null,
    branch: null,
    follow_up: null,
    score: row.score ?? null,
    created_at: createdAt,
    updated_at: updatedAt,
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
  // NOTE(2026-08-26): clients.counselor_id는 public.counselors(id)를 참조하므로
  // 로그인 UUID로 직접 필터하면 안 된다 — RLS(clients_select)가 본인 소유만 걸러준다.
  assertDashboardRuntimeContract('대시보드 검색', authUserId);
  const normalizedQuery = rawQuery.trim();
  if (!normalizedQuery) return [];

  const safeQuery = normalizedQuery.replace(/[%(),]/g, '');
  if (!safeQuery) return [];

  const likeQuery = `%${safeQuery}%`;
  const { data, error } = await runQuery<LiveClientRecord[]>(
    '대시보드 고객 검색',
    sb()
      .from('clients')
      .select(CLIENT_SELECT_FIELDS)
      .or(`name.ilike.${likeQuery},phone.ilike.${likeQuery},desired_job.ilike.${likeQuery}`)
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(10),
  );

  if (error) throw error;
  return ((data ?? []) as LiveClientRecord[]).map(row => liveClientToRow(row));
}

export async function fetchDashboardStats(_authUserId?: string): Promise<DashboardStats> {
  assertDashboardSupabaseConfigured('대시보드 통계');

  // NOTE(2026-08-26): clients.counselor_id는 auth.uid()가 아니라 public.counselors(id)를
  // 참조한다. 로그인 UUID로 직접 .eq('counselor_id', authUserId) 필터를 걸면 항상 0건이
  // 나오는 버그가 있었다 — RLS(clients_select: is_admin() or counselor_id = get_my_counselor_id())가
  // 이미 본인 소유 고객만 정확히 걸러주므로 앱단 필터는 제거하고 RLS에 위임한다.
  const rawRows = await fetchAllPages<{
    participation_stage: string | null;
    score: number | null;
    retention_1m_yn: string | null;
  }>('대시보드 통계 조회', (from, to) =>
    sb()
      .from('clients')
      .select('participation_stage, score, retention_1m_yn')
      .range(from, to),
  );
  const rows = rawRows.map(row => ({ ...row, participation_stage: trimOrNull(row.participation_stage) }));

  const stageCounts = new Map<string, number>();
  const scores = rows
    .map(row => parseDashboardNumber(row.score))
    .filter((score): score is number => score != null);

  rows.forEach(row => {
    const stage = row.participation_stage;
    if (!stage) return;
    stageCounts.set(stage, (stageCounts.get(stage) ?? 0) + 1);
  });

  const stageBreakdown = Array.from(stageCounts.entries())
    .sort(([stageA], [stageB]) => compareDashboardStage(stageA, stageB))
    .map(([stage, count]) => ({ stage, count }));

  return {
    totalClients: rows.length,
    inProgress: rows.filter(row => !isEmploymentCompletedStage(row.participation_stage)).length,
    employed: rows.filter(row => isEmploymentCompletedStage(row.participation_stage)).length,
    followUpNeeded: rows.filter(
      row => isEmploymentCompletedStage(row.participation_stage) && row.retention_1m_yn === 'N',
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
  // NOTE(2026-08-26): sessions.counselor_id는 public.counselors(id)를 참조하므로
  // 로그인 UUID로 직접 필터하면 안 된다 — RLS(sessions_select)가 본인 소유만 걸러준다.
  assertDashboardRuntimeContract('대시보드 월간 통계', authUserId);
  const monthKeys = buildRecentDashboardMonthKeys(monthCount);
  const [firstMonthKey, lastMonthKey] = [monthKeys[0], monthKeys[monthKeys.length - 1]];
  const rangeStart = `${firstMonthKey}-01`;
  const rangeEndDate = new Date(Number(lastMonthKey.slice(0, 4)), Number(lastMonthKey.slice(5, 7)), 0);
  const rangeEnd = `${rangeEndDate.getFullYear()}-${String(rangeEndDate.getMonth() + 1).padStart(2, '0')}-${String(rangeEndDate.getDate()).padStart(2, '0')}`;

  const histories = await fetchAllPages<{
    client_id: string | null;
    date: string | null;
  }>('대시보드 월간 통계 조회', (from, to) =>
    sb()
      .from('sessions')
      .select('client_id, date')
      .gte('date', rangeStart)
      .lte('date', rangeEnd)
      .range(from, to),
  );

  const sessionCountByMonth = new Map<string, number>();
  const clientIdsByMonth = new Map<string, Set<string>>();

  histories.forEach(row => {
    if (!row.date) return;
    const monthKey = row.date.slice(0, 7);
    if (!monthKeys.includes(monthKey)) return;

    sessionCountByMonth.set(monthKey, (sessionCountByMonth.get(monthKey) ?? 0) + 1);
    if (row.client_id) {
      const clientIds = clientIdsByMonth.get(monthKey) ?? new Set<string>();
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
  // NOTE(2026-08-26): sessions/clients.counselor_id는 public.counselors(id)를 참조하므로
  // 로그인 UUID로 직접 필터하면 안 된다 — RLS가 본인 소유만 걸러준다.
  assertDashboardRuntimeContract('캘린더', authUserId);
  assertDashboardDateRange('캘린더', monthStart, monthEnd);

  const histories = await fetchAllPages<{
    client_id: string | null;
    date: string | null;
  }>('캘린더 월간 일정 수 조회', (from, to) =>
    sb()
      .from('sessions')
      .select('client_id, date')
      .gte('date', monthStart)
      .lte('date', monthEnd)
      .range(from, to),
  );

  const clientIds = Array.from(
    new Set(histories.map(row => row.client_id).filter((id): id is string => !!id)),
  );
  if (clientIds.length === 0) return {};

  const clients = await fetchAllPages<{ id: string }>('캘린더 고객 소유권 검증', (from, to) =>
    sb()
      .from('clients')
      .select('id')
      .in('id', clientIds)
      .range(from, to),
  );

  const allowedClientIds = new Set(clients.map(row => row.id));

  return histories.reduce<Record<string, number>>((acc, row) => {
    if (!row.client_id || !row.date || !allowedClientIds.has(row.client_id)) return acc;
    acc[row.date] = (acc[row.date] ?? 0) + 1;
    return acc;
  }, {});
}

export async function fetchDashboardCalendarEntries(
  authUserId: string,
  rangeStart: string,
  rangeEnd: string,
): Promise<DashboardCalendarEntry[]> {
  // NOTE(2026-08-26): sessions/clients.counselor_id는 public.counselors(id)를 참조하므로
  // 로그인 UUID로 직접 필터하면 안 된다 — RLS가 본인 소유만 걸러준다.
  assertDashboardRuntimeContract('캘린더', authUserId);
  assertDashboardDateRange('캘린더', rangeStart, rangeEnd);

  const histories = await fetchAllPages<{
    id: string;
    client_id: string | null;
    counselor_id: string | null;
    date: string | null;
  }>('캘린더 일정 조회', (from, to) =>
    sb()
      .from('sessions')
      .select('id, client_id, counselor_id, date')
      .gte('date', rangeStart)
      .lte('date', rangeEnd)
      .order('date', { ascending: false })
      .range(from, to),
  );

  const clientIds = Array.from(
    new Set(histories.map(row => row.client_id).filter((id): id is string => !!id)),
  );
  if (clientIds.length === 0) return [];

  const clients = await fetchAllPages<{
    id: string;
    name: string;
    counselor_id: string | null;
    participation_stage: string | null;
  }>('캘린더 일정 고객 조회', (from, to) =>
    sb()
      .from('clients')
      .select('id, name, counselor_id, participation_stage')
      .in('id', clientIds)
      .range(from, to),
  );

  const clientMap = new Map(clients.map(client => [client.id, client]));

  return histories
    .map((row): DashboardCalendarEntry | null => {
      const client = row.client_id != null ? clientMap.get(row.client_id) : undefined;
      if (!client || !row.date) return null;
      return {
        counselId: row.id,
        clientId: client.id,
        clientName: client.name,
        counselDate: row.date,
        startTime: null,
        endTime: null,
        participationStage: trimOrNull(client.participation_stage),
      };
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
