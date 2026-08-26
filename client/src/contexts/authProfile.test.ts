import { describe, expect, it, vi } from 'vitest';
import { ROLE_ADMIN, ROLE_COUNSELOR } from '@shared/const';

vi.mock('@/lib/supabase', () => ({
  executeSupabaseRequest: async (_operationLabel: string, request: PromiseLike<unknown>) => await request,
  getSupabaseAnonKey: () => 'anon-key',
  getSupabaseUrl: () => 'https://example.supabase.co',
}));

import {
  buildFallbackUser,
  createCounselorProfileLookups,
  mapCounselorProfileToUser,
  normalizeLoginEmail,
  resolveCounselorProfile,
} from './authProfile';

describe('authProfile', () => {
  it('normalizes login email before resolving the app user', () => {
    expect(normalizeLoginEmail(' Senior@Test.com ')).toBe('senior@test.com');
  });

  it('maps an admin profile to the admin app role', () => {
    const user = mapCounselorProfileToUser(
      {
        authUserId: 'auth-admin-1',
        email: 'senior@test.com',
      },
      {
        id: 'auth-admin-1',
        counselorId: 'counselor-admin-1',
        name: '시니어 관리자',
        department: '본사',
        role: ROLE_ADMIN,
      },
    );

    expect(user.role).toBe(ROLE_ADMIN);
    expect(user.id).toBe('auth-admin-1');
    expect(user.counselorId).toBe('counselor-admin-1');
    expect(user.email).toBe('senior@test.com');
    expect(user.department).toBe('본사');
  });

  it('falls back through lookup strategies until it finds a profile', async () => {
    const legacyLookup = vi.fn().mockResolvedValue({
      id: 'auth-admin-1',
      counselorId: 'counselor-admin-1',
      name: '시니어 관리자',
      department: '본사',
      role: ROLE_ADMIN,
    });
    const result = await resolveCounselorProfile(
      {
        authUserId: 'auth-admin-1',
        email: 'senior@test.com',
      },
      [
        vi.fn().mockResolvedValue(null),
        legacyLookup,
        vi.fn().mockResolvedValue({
          id: 'ignored',
          counselorId: 'ignored-counselor',
          name: 'ignored',
          department: null,
          role: ROLE_COUNSELOR,
        }),
      ],
    );

    expect(result.profile?.role).toBe(ROLE_ADMIN);
    expect(result.hadLookupError).toBe(false);
    expect(legacyLookup).toHaveBeenCalledOnce();
  });

  it('marks lookup failure when every strategy errors or misses', async () => {
    const result = await resolveCounselorProfile(
      {
        authUserId: 'auth-user-1',
        email: 'counselor@test.com',
      },
      [
        vi.fn().mockRejectedValue(new Error('network error')),
        vi.fn().mockResolvedValue(null),
      ],
    );

    expect(result.profile).toBeNull();
    expect(result.hadLookupError).toBe(true);
  });

  it('uses counselor fallback when no profile can be resolved', () => {
    const user = buildFallbackUser({
      authUserId: 'auth-user-1',
      email: 'counselor@test.com',
    });

    expect(user.role).toBe(ROLE_COUNSELOR);
    expect(user.name).toBe('counselor');
  });

  it('resolves the internal counselor id separately from the auth user id', async () => {
    const queryLog: Array<[string, string, string]> = [];
    const from = vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn((column: string, value: string) => {
          queryLog.push([table, column, value]);
          return {
            maybeSingle: vi.fn().mockResolvedValue(table === 'user'
              ? {
                data: {
                  user_id: 'auth-user-1',
                  user_name: '상담사',
                  department: '본사',
                  role: ROLE_COUNSELOR,
                },
                error: null,
              }
              : {
                data: {
                  id: 'counselor-row-1',
                  auth_user_id: 'auth-user-1',
                },
                error: null,
              }),
          };
        }),
      })),
    }));

    const [lookup] = createCounselorProfileLookups({
      from,
      rpc: vi.fn(),
    } as any);

    await expect(lookup({
      authUserId: 'auth-user-1',
      email: 'counselor@test.com',
    })).resolves.toMatchObject({
      id: 'auth-user-1',
      counselorId: 'counselor-row-1',
    });
    expect(queryLog).toContainEqual(['counselors', 'auth_user_id', 'auth-user-1']);
  });

  it('prefers token-backed profile lookup when an access token is available', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes('/rest/v1/counselors')
        ? [{ id: 'counselor-admin-1', auth_user_id: 'auth-admin-1' }]
        : [{
          user_id: 'auth-admin-1',
          user_name: '시니어 관리자',
          department: '본사',
          role: ROLE_ADMIN,
        }];

      return Promise.resolve(new Response(JSON.stringify(body), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }));
    });

    vi.stubGlobal('fetch', fetchMock);

    try {
      const [lookup] = createCounselorProfileLookups({
        from: vi.fn(),
        rpc: vi.fn(),
      } as any, 'access-token');

      const result = await lookup({
        authUserId: 'auth-admin-1',
        email: 'senior@test.com',
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls.some(([url]) => {
        const parsed = new URL(String(url));
        return parsed.pathname === '/rest/v1/counselors'
          && parsed.searchParams.get('auth_user_id') === 'eq.auth-admin-1';
      })).toBe(true);
      expect(result).toEqual({
        id: 'auth-admin-1',
        counselorId: 'counselor-admin-1',
        name: '시니어 관리자',
        department: '본사',
        role: ROLE_ADMIN,
      });
    } finally {
      if (originalFetch) {
        vi.stubGlobal('fetch', originalFetch);
      } else {
        vi.unstubAllGlobals();
      }
    }
  });
});
