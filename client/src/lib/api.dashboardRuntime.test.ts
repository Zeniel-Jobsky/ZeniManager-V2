import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseState: {
  isConfigured: boolean;
  url: string | null;
  client: ReturnType<typeof createMockSupabaseClient> | null;
} = {
  isConfigured: true,
  url: 'https://example.supabase.co',
  client: null,
};

vi.mock('./supabase', () => ({
  executeSupabaseRequest: async (_operationLabel: string, request: PromiseLike<unknown>) => await request,
  getSupabaseClient: () => supabaseState.client,
  getSupabaseUrl: () => supabaseState.url,
  isSupabaseConfigured: () => supabaseState.isConfigured,
}));

import {
  fetchDashboardCalendarEntries,
  fetchDashboardCalendarMonthCounts,
  fetchDashboardMonthlyStats,
  fetchDashboardStats,
  fetchMyMemo,
  searchDashboardClients,
  updateMyMemo,
} from './api.dashboard';

type QueryResult = {
  data?: unknown;
  error?: unknown;
  count?: number | null;
};

type TableBehavior = {
  select?: QueryResult | QueryResult[];
  update?: QueryResult | QueryResult[];
};

type QueryLogEntry = {
  table: string;
  operation: 'select' | 'update';
  method: string;
  args: unknown[];
};

function takeResult(value?: QueryResult | QueryResult[]): QueryResult {
  if (Array.isArray(value)) {
    return value.shift() ?? { data: null, error: null };
  }
  return value ?? { data: null, error: null };
}

function createQueryChain(
  table: string,
  operation: 'select' | 'update',
  result: QueryResult,
  queryLog: QueryLogEntry[],
) {
  const chain: Record<string, any> = {
    data: result.data ?? null,
    error: result.error ?? null,
    count: result.count ?? null,
  };

  ['eq', 'gte', 'lte', 'in', 'order', 'or', 'limit', 'range'].forEach(method => {
    chain[method] = (...args: unknown[]) => {
      queryLog.push({ table, operation, method, args });
      return chain;
    };
  });

  chain.maybeSingle = () => {
    queryLog.push({ table, operation, method: 'maybeSingle', args: [] });
    return Promise.resolve({
      data: chain.data,
      error: chain.error,
      count: chain.count,
    });
  };

  return chain;
}

function createMockSupabaseClient(
  tableBehaviors: Record<string, TableBehavior>,
  queryLog: QueryLogEntry[] = [],
) {
  return {
    from(table: string) {
      return {
        select(...args: unknown[]) {
          queryLog.push({ table, operation: 'select', method: 'select', args });
          return createQueryChain(table, 'select', takeResult(tableBehaviors[table]?.select), queryLog);
        },
        update(...args: unknown[]) {
          queryLog.push({ table, operation: 'update', method: 'update', args });
          return createQueryChain(table, 'update', takeResult(tableBehaviors[table]?.update), queryLog);
        },
      };
    },
  };
}

describe('dashboard runtime APIs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-28T09:00:00Z'));
    supabaseState.isConfigured = true;
    supabaseState.url = 'https://example.supabase.co';
    supabaseState.client = createMockSupabaseClient({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws explicit errors for memo/calendar APIs when Supabase is unset', async () => {
    supabaseState.isConfigured = false;
    supabaseState.client = null;

    await expect(fetchMyMemo('auth-1')).rejects.toThrow('개인 메모 기능을 사용하려면 Supabase 설정이 필요합니다.');
    await expect(updateMyMemo('auth-1', 'memo')).rejects.toThrow('개인 메모 기능을 사용하려면 Supabase 설정이 필요합니다.');
    await expect(fetchDashboardCalendarMonthCounts('auth-1', '2026-03-01', '2026-03-31')).rejects.toThrow('캘린더 기능을 사용하려면 Supabase 설정이 필요합니다.');
    await expect(fetchDashboardCalendarEntries('auth-1', '2026-03-01', '2026-03-31')).rejects.toThrow('캘린더 기능을 사용하려면 Supabase 설정이 필요합니다.');
  });

  it('throws explicit errors when auth user id is missing', async () => {
    await expect(fetchMyMemo('')).rejects.toThrow('개인 메모 기능을 호출하려면 로그인한 상담사 user_id가 필요합니다.');
    await expect(updateMyMemo('   ', 'memo')).rejects.toThrow('개인 메모 기능을 호출하려면 로그인한 상담사 user_id가 필요합니다.');
    await expect(fetchDashboardCalendarMonthCounts('', '2026-03-01', '2026-03-31')).rejects.toThrow('캘린더 기능을 호출하려면 로그인한 상담사 user_id가 필요합니다.');
    await expect(fetchDashboardCalendarEntries('', '2026-03-01', '2026-03-31')).rejects.toThrow('캘린더 기능을 호출하려면 로그인한 상담사 user_id가 필요합니다.');
  });

  it('validates calendar date ranges before querying', async () => {
    await expect(fetchDashboardCalendarMonthCounts('auth-1', '2026-03-31', '2026-03-01')).rejects.toThrow('캘린더 기능을 호출하려면 시작일이 종료일보다 늦지 않은 조회 기간이 필요합니다.');
    await expect(fetchDashboardCalendarEntries('auth-1', '2026/03/01', '2026-03-31')).rejects.toThrow('캘린더 기능을 호출하려면 YYYY-MM-DD 형식의 조회 기간이 필요합니다.');
  });

  it('returns null when the live memo row does not exist', async () => {
    supabaseState.client = createMockSupabaseClient({
      user: {
        select: { data: null, error: null },
      },
    });

    await expect(fetchMyMemo('auth-1')).resolves.toBeNull();
  });

  it('throws when memo save verification does not match the refreshed DB value', async () => {
    supabaseState.client = createMockSupabaseClient({
      user: {
        update: { data: null, error: null, count: 1 },
        select: { data: { memo: null }, error: null },
      },
    });

    await expect(updateMyMemo('auth-1', '저장할 메모')).rejects.toThrow('상담사 메모 저장 후 재조회가 되지 않았습니다.');
  });

  it('returns empty month counts when there is no calendar history', async () => {
    supabaseState.client = createMockSupabaseClient({
      sessions: {
        select: { data: [], error: null },
      },
    });

    await expect(fetchDashboardCalendarMonthCounts('auth-1', '2026-03-01', '2026-03-31')).resolves.toEqual({});
  });

  it('filters calendar month counts through counselor-owned clients', async () => {
    const queryLog: QueryLogEntry[] = [];
    supabaseState.client = createMockSupabaseClient({
      sessions: {
        select: {
          data: [
            { client_id: '10', date: '2026-03-10' },
            { client_id: '20', date: '2026-03-10' },
            { client_id: '20', date: '2026-03-11' },
          ],
          error: null,
        },
      },
      clients: {
        select: {
          data: [{ id: '20' }],
          error: null,
        },
      },
    }, queryLog);

    const result = await fetchDashboardCalendarMonthCounts('auth-1', '2026-03-01', '2026-03-31');

    expect(result).toEqual({
      '2026-03-10': 1,
      '2026-03-11': 1,
    });
    // 소유권 필터는 앱 코드가 아니라 RLS(clients_select)가 담당하므로,
    // 여기서는 세션에서 발견된 client_id들로 소유권 검증 조회가 나가는지만 확인한다.
    expect(queryLog).toContainEqual({
      table: 'clients',
      operation: 'select',
      method: 'in',
      args: ['id', ['10', '20']],
    });
  });

  it('filters calendar entries through counselor-owned clients', async () => {
    supabaseState.client = createMockSupabaseClient({
      sessions: {
        select: {
          data: [
            { id: '1', client_id: '10', counselor_id: 'auth-1', date: '2026-03-10' },
            { id: '2', client_id: '20', counselor_id: 'auth-1', date: '2026-03-11' },
          ],
          error: null,
        },
      },
      clients: {
        select: {
          data: [{ id: '20', name: '허용 고객', counselor_id: 'auth-1', participation_stage: '초기상담' }],
          error: null,
        },
      },
    });

    await expect(fetchDashboardCalendarEntries('auth-1', '2026-03-01', '2026-03-31')).resolves.toEqual([
      {
        counselId: '2',
        clientId: '20',
        clientName: '허용 고객',
        counselDate: '2026-03-11',
        startTime: null,
        endTime: null,
        participationStage: '초기상담',
      },
    ]);
  });

  it('aggregates live monthly dashboard stats from sessions and unique clients only', async () => {
    supabaseState.client = createMockSupabaseClient({
      sessions: {
        select: {
          data: [
            { client_id: '10', date: '2026-02-05' },
            { client_id: '10', date: '2026-03-10' },
            { client_id: '20', date: '2026-03-11' },
            { client_id: '20', date: '2026-03-20' },
          ],
          error: null,
        },
      },
    });

    const result = await fetchDashboardMonthlyStats('auth-1');

    expect(result).toHaveLength(12);
    expect(result.at(-2)).toEqual({ month: '2월', clients: 1, sessions: 1 });
    expect(result.at(-1)).toEqual({ month: '3월', clients: 2, sessions: 3 });
  });

  it('aggregates score KPIs, score-range distribution, and follow-up counts from live dashboard stats', async () => {
    supabaseState.client = createMockSupabaseClient({
      clients: {
        select: {
          data: [
            { participation_stage: '초기상담', score: null, retention_1m_yn: null },
            { participation_stage: '취업지원', score: 65, retention_1m_yn: null },
            { participation_stage: '취업완료', score: 72, retention_1m_yn: 'Y' },
            { participation_stage: '취업완료', score: 88, retention_1m_yn: 'N' },
            { participation_stage: '사후관리', score: 91, retention_1m_yn: null },
          ],
          error: null,
        },
      },
    });

    await expect(fetchDashboardStats('auth-1')).resolves.toEqual({
      totalClients: 5,
      inProgress: 3,
      employed: 2,
      followUpNeeded: 1,
      averageScore: 79,
      scoredClients: 4,
      unscoredClients: 1,
      scoreDistribution: [
        { range: '0-59', count: 0 },
        { range: '60-69', count: 1 },
        { range: '70-79', count: 1 },
        { range: '80-89', count: 1 },
        { range: '90-100', count: 1 },
      ],
      stageBreakdown: [
        { stage: '초기상담', count: 1 },
        { stage: '취업지원', count: 1 },
        { stage: '취업완료', count: 2 },
        { stage: '사후관리', count: 1 },
      ],
    });
  });

  it('searches dashboard clients through the live clients table only', async () => {
    const queryLog: QueryLogEntry[] = [];
    supabaseState.client = createMockSupabaseClient({
      clients: {
        select: {
          data: [
            {
              id: '7',
              name: '홍길동',
              counselor_id: 'auth-1',
              age: null,
              gender: null,
              phone: '010-1234-5678',
              education_level: null,
              school: null,
              major: null,
              business_type: null,
              participation_type: null,
              participation_stage: '초기상담',
              desired_job: '개발자',
              employment_type: null,
              employer: '제니소프트',
              job_title: '웹 개발',
              salary: '3200',
              employment_date: '2026-03-15',
              iap_date: null,
              rediagnosis_yn: null,
              rediagnosis_date: null,
              retention_1m_date: null,
              retention_1m_yn: null,
              retention_6m_date: null,
              retention_6m_yn: null,
              retention_12m_date: null,
              retention_12m_yn: null,
              retention_18m_date: null,
              retention_18m_yn: null,
              score: null,
              counsel_notes: null,
              created_at: '2026-03-01T00:00:00Z',
              updated_at: '2026-03-10',
            },
          ],
          error: null,
        },
      },
    }, queryLog);

    const result = await searchDashboardClients('auth-1', '홍길동');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: '홍길동',
      desired_job: '개발자',
      employer: '제니소프트',
      job_title: '웹 개발',
      salary: '3200',
      employment_date: '2026-03-15',
    });
    // 소유권 필터는 앱 코드가 아니라 RLS(clients_select)가 담당하므로,
    // 여기서는 검색 조건(or)이 실제로 실렸는지만 확인한다.
    expect(queryLog).toContainEqual({
      table: 'clients',
      operation: 'select',
      method: 'or',
      args: ['name.ilike.%홍길동%,phone.ilike.%홍길동%,desired_job.ilike.%홍길동%'],
    });
  });
});
