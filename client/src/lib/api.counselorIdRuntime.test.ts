import { beforeEach, describe, expect, it, vi } from 'vitest';

type QueryResult = {
  data?: unknown;
  error?: unknown;
};

type TableBehavior = Partial<Record<'select' | 'insert' | 'update', QueryResult>>;

type QueryLogEntry = {
  table: string;
  operation: 'select' | 'insert' | 'update';
  method: string;
  args: unknown[];
};

const state: {
  client: ReturnType<typeof createMockSupabaseClient> | null;
} = {
  client: null,
};

vi.mock('./supabase', () => ({
  executeSupabaseRequest: async (_operationLabel: string, request: PromiseLike<unknown>) => await request,
  getSupabaseClient: () => state.client,
  isSupabaseConfigured: () => true,
}));

import { createClient, createSession, fetchClients, fetchCounselors } from './api';

function createQueryChain(
  table: string,
  operation: QueryLogEntry['operation'],
  result: QueryResult,
  queryLog: QueryLogEntry[],
) {
  const chain: Record<string, any> = {
    data: result.data ?? null,
    error: result.error ?? null,
  };

  ['select', 'eq', 'in', 'order', 'range', 'limit'].forEach(method => {
    chain[method] = (...args: unknown[]) => {
      queryLog.push({ table, operation, method, args });
      return chain;
    };
  });

  chain.single = () => {
    queryLog.push({ table, operation, method: 'single', args: [] });
    return Promise.resolve({ data: chain.data, error: chain.error });
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
          return createQueryChain(table, 'select', tableBehaviors[table]?.select ?? {}, queryLog);
        },
        insert(...args: unknown[]) {
          queryLog.push({ table, operation: 'insert', method: 'insert', args });
          return createQueryChain(table, 'insert', tableBehaviors[table]?.insert ?? {}, queryLog);
        },
        update(...args: unknown[]) {
          queryLog.push({ table, operation: 'update', method: 'update', args });
          return createQueryChain(table, 'update', tableBehaviors[table]?.update ?? {}, queryLog);
        },
      };
    },
  };
}

function clientFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'client-1',
    name: '희망직종 테스트 내담자',
    desired_job: '백엔드 개발자, 데이터 엔지니어',
    counselor_id: 'counselor-row-C',
    created_at: '2026-08-26T00:00:00.000Z',
    updated_at: '2026-08-26T00:00:00.000Z',
    ...overrides,
  };
}

describe('counselor row id contract', () => {
  beforeEach(() => {
    state.client = createMockSupabaseClient({});
  });

  it('queries clients with public.counselors.id directly and preserves DB desired_job', async () => {
    const queryLog: QueryLogEntry[] = [];
    state.client = createMockSupabaseClient({
      clients: { select: { data: [clientFixture()] } },
    }, queryLog);

    const clients = await fetchClients('counselor-row-C');

    expect(clients).toHaveLength(1);
    expect(clients[0]).toMatchObject({
      counselor_id: 'counselor-row-C',
      desired_job: '백엔드 개발자, 데이터 엔지니어',
    });
    expect(queryLog).toContainEqual({
      table: 'clients',
      operation: 'select',
      method: 'eq',
      args: ['counselor_id', 'counselor-row-C'],
    });
    expect(queryLog.some(entry => entry.table === 'counselors')).toBe(false);
    expect(JSON.stringify(queryLog)).not.toContain('00000000-0000-0000-0000-000000000000');
  });

  it('stores the counselor PK and comma-separated desired jobs without re-resolving auth_user_id', async () => {
    const queryLog: QueryLogEntry[] = [];
    state.client = createMockSupabaseClient({
      clients: { insert: { data: clientFixture() } },
    }, queryLog);

    await createClient({
      name: '희망직종 테스트 내담자',
      counselor_id: 'counselor-row-C',
      desired_job: '백엔드 개발자, 데이터 엔지니어',
    });

    const insert = queryLog.find(entry => entry.table === 'clients' && entry.method === 'insert');
    expect(insert?.args[0]).toMatchObject({
      counselor_id: 'counselor-row-C',
      desired_job: '백엔드 개발자, 데이터 엔지니어',
    });
    expect(queryLog.some(entry => entry.table === 'counselors')).toBe(false);
  });

  it('stores session counselor_id as the already-resolved counselor PK', async () => {
    const queryLog: QueryLogEntry[] = [];
    state.client = createMockSupabaseClient({
      sessions: {
        insert: {
          data: {
            id: 'session-1',
            client_id: 'client-1',
            counselor_id: 'counselor-row-C',
            date: '2026-08-26',
            type: '상담기록',
            content: '테스트',
            next_action: null,
            counselor_name: '상담사',
            created_at: '2026-08-26T00:00:00.000Z',
          },
        },
      },
    }, queryLog);

    await createSession({
      client_id: 'client-1',
      counselor_id: 'counselor-row-C',
      counselor_name: '상담사',
      date: '2026-08-26',
      type: '상담기록',
      content: '테스트',
      next_action: null,
    });

    const insert = queryLog.find(entry => entry.table === 'sessions' && entry.method === 'insert');
    expect(insert?.args[0]).toMatchObject({ counselor_id: 'counselor-row-C' });
    expect(queryLog.some(entry => entry.table === 'counselors')).toBe(false);
  });

  it('maps public.user auth UUIDs to public.counselors PKs for admin lists', async () => {
    const queryLog: QueryLogEntry[] = [];
    state.client = createMockSupabaseClient({
      user: {
        select: {
          data: [{
            user_id: 'auth-user-A',
            user_name: '상담사',
            department: '서울지점',
            memo: null,
            role: 5,
            manager_memo: null,
          }],
        },
      },
      counselors: {
        select: {
          data: [{ id: 'counselor-row-C', auth_user_id: 'auth-user-A' }],
        },
      },
    }, queryLog);

    await expect(fetchCounselors()).resolves.toEqual([
      expect.objectContaining({
        user_id: 'auth-user-A',
        counselor_id: 'counselor-row-C',
      }),
    ]);
    expect(queryLog).toContainEqual({
      table: 'counselors',
      operation: 'select',
      method: 'in',
      args: ['auth_user_id', ['auth-user-A']],
    });
  });

  it('keeps the admin counselor list visible when the optional PK mapping query fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    state.client = createMockSupabaseClient({
      user: {
        select: {
          data: [{
            user_id: 'auth-user-A',
            user_name: '상담사',
            department: '서울지점',
            memo: null,
            role: 5,
            manager_memo: null,
          }],
        },
      },
      counselors: {
        select: { data: null, error: { code: '42501', message: 'permission denied' } },
      },
    });

    await expect(fetchCounselors()).resolves.toEqual([
      expect.objectContaining({
        user_id: 'auth-user-A',
        counselor_id: null,
      }),
    ]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
