import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {
  buildEmbeddingText,
  clampLimit,
  createEmbedding,
  describeError,
  isEmploymentSuccessCandidate,
  maskKoreanName,
  parseEmploymentDate,
  resolveOpenAIKey,
  toAgeDecade,
  type EmploymentSourceRow,
  vectorLiteral,
} from '../_shared/employment-success.ts';

type RequestBody = {
  clientId?: string;
  backfill?: boolean;
  limit?: number;
  openAIKey?: string;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// NOTE(2026-08-26): public.clients 스키마 기준 (id는 uuid).
const CLIENT_SELECT_FIELDS = [
  'id',
  'name',
  'age',
  'education_level',
  'school',
  'major',
  'desired_job',
  'participation_stage',
  'employer',
  'employment_type',
  'job_title',
  'employment_date',
].join(', ');

Deno.serve(async request => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const admin = createAdminClient();
    const body = await readBody(request);

    if (body.backfill) {
      const limit = clampLimit(body.limit, 100, 500);
      const clients = await fetchBackfillClients(admin, limit);
      const apiKey = clients.length > 0 ? resolveOpenAIKey(body.openAIKey) : null;

      let activated = 0;
      let deactivated = 0;

      for (const client of clients) {
        const result = await syncOneClient(admin, client, apiKey);
        if (result.status === 'activated') activated += 1;
        if (result.status === 'deactivated') deactivated += 1;
      }

      console.log('[sync-employment-success-case] backfill', { processed: clients.length, activated, deactivated });

      return json({
        processed: clients.length,
        activated,
        deactivated,
      });
    }

    if (!body.clientId) {
      return json({ error: 'clientId가 필요합니다.' }, 400);
    }

    const client = await fetchClientById(admin, body.clientId);
    if (!client) {
      return json({ error: '상담자 데이터를 찾을 수 없습니다.' }, 404);
    }

    const apiKey = isEmploymentSuccessCandidate(client) ? resolveOpenAIKey(body.openAIKey) : null;
    const result = await syncOneClient(admin, client, apiKey);

    console.log('[sync-employment-success-case] single', {
      clientId: client.id,
      status: result.status,
    });

    return json(result);
  } catch (error) {
    console.error('[sync-employment-success-case] failed', error);
    return json(
      {
        error: describeError(error, '성공사례 동기화 중 오류가 발생했습니다.'),
      },
      500,
    );
  }
});

function createAdminClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

async function readBody(request: Request): Promise<RequestBody> {
  if (request.headers.get('content-length') === '0') {
    return {};
  }

  try {
    return await request.json() as RequestBody;
  } catch {
    return {};
  }
}

async function fetchClientById(
  admin: ReturnType<typeof createClient>,
  clientId: string,
): Promise<EmploymentSourceRow | null> {
  const { data, error } = await admin
    .from('clients')
    .select(CLIENT_SELECT_FIELDS)
    .eq('id', clientId)
    .maybeSingle();

  if (error) throw error;
  return (data as EmploymentSourceRow | null) ?? null;
}

async function fetchBackfillClients(
  admin: ReturnType<typeof createClient>,
  limit: number,
): Promise<EmploymentSourceRow[]> {
  const { data, error } = await admin
    .from('clients')
    .select(CLIENT_SELECT_FIELDS)
    .eq('participation_stage', '취업완료')
    .not('employer', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as EmploymentSourceRow[];
}

async function syncOneClient(
  admin: ReturnType<typeof createClient>,
  client: EmploymentSourceRow,
  apiKey: string | null,
): Promise<{ status: 'activated' | 'deactivated'; sourceClientId: string }> {
  if (!isEmploymentSuccessCandidate(client)) {
    const { error } = await admin
      .from('employment_success_case')
      .update({ is_active: false })
      .eq('source_client_id', client.id);

    if (error) throw error;

    return {
      status: 'deactivated',
      sourceClientId: client.id,
    };
  }

  if (!apiKey) {
    throw new Error('임베딩 생성을 위한 OpenAI API 키가 필요합니다.');
  }

  const rawText = buildEmbeddingText(client, { includeEmployment: true });
  const embedding = await createEmbedding(apiKey, rawText);
  const employmentDate = parseEmploymentDate(client.employment_date);

  const { error } = await admin
    .from('employment_success_case')
    .upsert({
      source_client_id: client.id,
      masked_client_name: maskKoreanName(client.name),
      age: client.age,
      age_decade: toAgeDecade(client.age),
      education_level: client.education_level,
      school_name: client.school,
      major: client.major,
      desired_job_1: client.desired_job,
      desired_job_2: null,
      desired_job_3: null,
      employment_company: client.employer,
      employment_type: client.employment_type,
      employment_job_type: client.job_title,
      employment_date: employmentDate,
      source_participation_stage: client.participation_stage ?? '취업완료',
      raw_text_used_for_embedding: rawText,
      embedding: vectorLiteral(embedding),
      embedding_model: 'text-embedding-3-small',
      is_active: true,
    }, {
      onConflict: 'source_client_id',
    });

  if (error) throw error;

  return {
    status: 'activated',
    sourceClientId: client.id,
  };
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}
