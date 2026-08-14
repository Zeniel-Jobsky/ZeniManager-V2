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
    counselorId: profile.id,
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

  const { data, error } = await executeSupabaseRequest<RestCounselorProfileRecord[]>(
    '로그인 사용자 프로필 조회',
    fetch(requestUrl.toString(), {
      method: 'GET',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    }).then(async response => {
      const responseText = await response.text();
      const responseJson = responseText ? JSON.parse(responseText) : null;

      return {
        data: response.ok && Array.isArray(responseJson) ? responseJson as RestCounselorProfileRecord[] : null,
        error: response.ok
          ? null
          : (typeof responseJson === 'object' && responseJson !== null
            ? responseJson
            : { message: response.statusText || '로그인 사용자 프로필 조회 실패' }),
        status: response.status,
      };
    }),
  );

  if (error) {
    throw error;
  }

  const profile = data?.[0];
  if (!profile) {
    return null;
  }

  return {
    id: profile.user_id,
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
      const { data, error } = await sb
        .from('user')
        .select('user_id, user_name, role, department')
        .eq('user_id', authUserId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!data) {
        return null;
      }

      return {
        id: data.user_id,
        name: data.user_name,
        department: data.department,
        role: data.role,
      };
    },
  );

  return lookups;
}
