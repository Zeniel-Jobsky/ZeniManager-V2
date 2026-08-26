import type { SupabaseClient } from '@supabase/supabase-js';
import {
  normalizeAppRole,
  ROLE_COUNSELOR,
  type AppRole,
} from '@shared/const';
import {
  executeSupabaseRequest,
  getSupabaseAnonKey,
  getSupabaseUrl,
} from '@/lib/supabase';

export interface UserIdentity {
  authUserId: string;
  email: string;
}

export interface CounselorProfileRecord {
  id: string;
  counselorId: string | null;
  name: string;
  department: string | null;
  role: unknown;
}

export interface AuthenticatedUserProfile {
  id: string;
  name: string;
  email: string;
  role: AppRole;
  department?: string;
  branch?: string;
  counselorId?: string;
}

export interface CounselorProfileResolution {
  profile: CounselorProfileRecord | null;
  hadLookupError: boolean;
}

type SupabaseLike = Pick<SupabaseClient, 'from' | 'rpc'>;
export type ProfileLookup = (
  identity: UserIdentity,
) => Promise<CounselorProfileRecord | null>;

type RestCounselorProfileRecord = {
  user_id: string;
  user_name: string;
  department: string | null;
  role: unknown;
};

type RestCounselorIdentityRecord = {
  id: string;
  auth_user_id: string | null;
};

export function normalizeLoginEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function mapCounselorProfileToUser(
  identity: UserIdentity,
  profile: CounselorProfileRecord,
): AuthenticatedUserProfile {
  const department = profile.department || undefined;

  return {
    id: identity.authUserId,
    name: profile.name,
    email: identity.email,
    role: normalizeAppRole(profile.role),
    department,
    branch: department,
    counselorId: profile.counselorId ?? undefined,
  };
}

export function buildFallbackUser(
  identity: UserIdentity,
): AuthenticatedUserProfile {
  return {
    id: identity.authUserId,
    name: identity.email.split('@')[0] || '사용자',
    email: identity.email,
    role: ROLE_COUNSELOR,
  };
}

export async function resolveCounselorProfile(
  identity: UserIdentity,
  lookups: ProfileLookup[],
): Promise<CounselorProfileResolution> {
  let hadLookupError = false;

  for (const lookup of lookups) {
    try {
      const profile = await lookup(identity);
      if (profile) {
        return {
          profile,
          hadLookupError,
        };
      }
    } catch {
      hadLookupError = true;
    }
  }

  return {
    profile: null,
    hadLookupError,
  };
}

async function fetchCounselorProfileByAccessToken(
  identity: UserIdentity,
  accessToken: string,
): Promise<CounselorProfileRecord | null> {
  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabaseAnonKey();
  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  const requestUrl = new URL('/rest/v1/user', supabaseUrl);
  requestUrl.searchParams.set('select', 'user_id,user_name,role,department');
  requestUrl.searchParams.set('user_id', `eq.${identity.authUserId}`);

  const counselorRequestUrl = new URL('/rest/v1/counselors', supabaseUrl);
  counselorRequestUrl.searchParams.set('select', 'id,auth_user_id');
  counselorRequestUrl.searchParams.set('auth_user_id', `eq.${identity.authUserId}`);

  const requestHeaders = {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  };

  const parseRestResponse = async <T,>(response: Response) => {
    const responseText = await response.text();
    const responseJson = responseText ? JSON.parse(responseText) : null;

    return {
      data: response.ok && Array.isArray(responseJson) ? responseJson as T[] : null,
      error: response.ok
        ? null
        : (typeof responseJson === 'object' && responseJson !== null
          ? responseJson
          : { message: response.statusText || '로그인 사용자 프로필 조회 실패' }),
      status: response.status,
    };
  };

  const [profileResult, counselorResult] = await Promise.all([
    executeSupabaseRequest<RestCounselorProfileRecord[]>(
      '로그인 사용자 프로필 조회',
      fetch(requestUrl.toString(), {
        method: 'GET',
        headers: requestHeaders,
      }).then(response => parseRestResponse<RestCounselorProfileRecord>(response)),
    ),
    executeSupabaseRequest<RestCounselorIdentityRecord[]>(
      '로그인 상담사 식별자 조회',
      fetch(counselorRequestUrl.toString(), {
        method: 'GET',
        headers: requestHeaders,
      }).then(response => parseRestResponse<RestCounselorIdentityRecord>(response)),
    ),
  ]);

  if (profileResult.error) throw profileResult.error;
  if (counselorResult.error) throw counselorResult.error;

  const profile = profileResult.data?.[0];
  if (!profile) {
    return null;
  }

  return {
    id: profile.user_id,
    counselorId: counselorResult.data?.[0]?.id ?? null,
    name: profile.user_name,
    department: profile.department,
    role: profile.role,
  };
}

export function createCounselorProfileLookups(
  sb: SupabaseLike,
  accessToken?: string | null,
): ProfileLookup[] {
  const lookups: ProfileLookup[] = [];

  if (accessToken) {
    lookups.push(async (identity) => {
      return fetchCounselorProfileByAccessToken(identity, accessToken);
    });
  }

  lookups.push(
    async ({ authUserId }) => {
      const [profileResult, counselorResult] = await Promise.all([
        sb
          .from('user')
          .select('user_id, user_name, role, department')
          .eq('user_id', authUserId)
          .maybeSingle(),
        sb
          .from('counselors')
          .select('id, auth_user_id')
          .eq('auth_user_id', authUserId)
          .maybeSingle(),
      ]);

      if (profileResult.error) throw profileResult.error;
      if (counselorResult.error) throw counselorResult.error;

      if (!profileResult.data) {
        return null;
      }

      return {
        id: profileResult.data.user_id,
        counselorId: counselorResult.data?.id ?? null,
        name: profileResult.data.user_name,
        department: profileResult.data.department,
        role: profileResult.data.role,
      };
    },
  );

  return lookups;
}
