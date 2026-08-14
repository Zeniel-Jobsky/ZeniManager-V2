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

  ['eq', 'gte', 'lte', 'in', 'order', 'or', 'limit'].forEach(method => {
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
      counsel_history: {
        select: { data: [], error: null },
      },
    });

    await expect(fetchDashboardCalendarMonthCounts('auth-1', '2026-03-01', '2026-03-31')).resolves.toEqual({});
  });

  it('filters calendar month counts through counselor-owned clients', async () => {
    const queryLog: QueryLogEntry[] = [];
    supabaseState.client = createMockSupabaseClient({
      counsel_history: {
        select: {
          data: [
            { client_id: 10, counsel_date: '2026-03-10' },
            { client_id: 20, counsel_date: '2026-03-10' },
            { client_id: 20, counsel_date: '2026-03-11' },
          ],
          error: null,
        },
      },
      client: {
        select: {
          data: [{ client_id: 20 }],
          error: null,
        },
      },
    }, queryLog);

    const result = await fetchDashboardCalendarMonthCounts('auth-1', '2026-03-01', '2026-03-31');

    expect(result).toEqual({
      '2026-03-10': 1,
      '2026-03-11': 1,
    });
    expect(queryLog).toContainEqual({
      table: 'client',
      operation: 'select',
      method: 'eq',
      args: ['counselor_id', 'auth-1'],
    });
  });

  it('filters calendar entries through counselor-owned clients', async () => {
    supabaseState.client = createMockSupabaseClient({
      counsel_history: {
        select: {
          data: [
            { counsel_id: 1, client_id: 10, counsel_date: '2026-03-10', start_time: '09:00:00', end_time: '10:00:00' },
            { counsel_id: 2, client_id: 20, counsel_date: '2026-03-11', start_time: null, end_time: null },
          ],
          error: null,
        },
      },
      client: {
        select: {
          data: [{ client_id: 20, client_name: '허용 고객', counselor_id: 'auth-1', participation_stage: '초기상담' }],
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
      counsel_history: {
        select: {
          data: [
            { client_id: 10, counsel_date: '2026-02-05' },
            { client_id: 10, counsel_date: '2026-03-10' },
            { client_id: 20, counsel_date: '2026-03-11' },
            { client_id: 20, counsel_date: '2026-03-20' },
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
      client: {
        select: {
          data: [
            { participation_stage: '초기상담', retest_stat: null, continue_serv_1_stat: null },
            { participation_stage: '취업지원', retest_stat: 65, continue_serv_1_stat: 0 },
            { participation_stage: '취업완료', retest_stat: 72, continue_serv_1_stat: 1 },
            { participation_stage: '취업완료', retest_stat: 88, continue_serv_1_stat: 0 },
            { participation_stage: '사후관리', retest_stat: 91, continue_serv_1_stat: 2 },
          ],
          error: null,
        },
      },
    });

    await expect(fetchDashboardStats('auth-1')).resolves.toEqual({
      totalClients: 5,
      inProgress: 3,
      employed: 2,
      followUpNeeded: 2,
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

  it('searches dashboard clients through the live client table only', async () => {
    const queryLog: QueryLogEntry[] = [];
    supabaseState.client = createMockSupabaseClient({
      client: {
        select: {
          data: [
            {
              client_id: 7,
              client_name: '홍길동',
              counselor_id: 'auth-1',
              age: null,
              gender_code: null,
              phone_encrypted: '010-1234-5678',
              education_level: null,
              school_name: null,
              major: null,
              business_type_code: null,
              participation_type: null,
              participation_stage: '초기상담',
              desired_job_1: '개발자',
              desired_job_2: '프론트엔드 개발자',
              desired_job_3: '백엔드 개발자',
              hire_type: null,
              hire_place: '제니소프트',
              hire_job_type: '웹 개발',
              hire_payment: 3200,
              hire_date: '2026-03-15',
              job_place_start: '2026-03-14',
              job_place_end: null,
              iap_to: null,
              retest_stat: null,
              retest_date: null,
              continue_serv_1_date: null,
              continue_serv_1_stat: null,
              continue_serv_6_date: null,
              continue_serv_6_stat: null,
              continue_serv_12_date: null,
              continue_serv_12_stat: null,
              continue_serv_18_date: null,
              continue_serv_18_stat: null,
              future_card_stat: null,
              memo: null,
              business_code: null,
              created_at: '2026-03-01T00:00:00Z',
              update_at: '2026-03-10',
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
      desired_job_2: '프론트엔드 개발자',
      desired_job_3: '백엔드 개발자',
      hire_place: '제니소프트',
      hire_job_type: '웹 개발',
      hire_payment: 3200,
      hire_date: '2026-03-15',
    });
    expect(queryLog).toContainEqual({
      table: 'client',
      operation: 'select',
      method: 'eq',
      args: ['counselor_id', 'auth-1'],
    });
  });
});
