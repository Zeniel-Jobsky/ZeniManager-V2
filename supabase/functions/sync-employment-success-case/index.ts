import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {
  buildEmbeddingText,
  clampLimit,
  createEmbedding,
  isEmploymentSuccessCandidate,
  maskKoreanName,
  parseEmploymentDate,
  resolveOpenAIKey,
  toAgeDecade,
  type EmploymentSourceRow,
  vectorLiteral,
} from '../_shared/employment-success.ts';

type RequestBody = {
  clientId?: number;
  backfill?: boolean;
  limit?: number;
  openAIKey?: string;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CLIENT_SELECT_FIELDS = [
  'client_id',
  'client_name',
  'age',
  'education_level',
  'school_name',
  'major',
  'desired_job_1',
  'desired_job_2',
  'desired_job_3',
  'participation_stage',
  'hire_place',
  'hire_type',
  'hire_job_type',
  'hire_date',
  'job_place_start',
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

    if (!Number.isFinite(body.clientId)) {
      return json({ error: 'clientId가 필요합니다.' }, 400);
    }

    const client = await fetchClientById(admin, Number(body.clientId));
    if (!client) {
      return json({ error: '상담자 데이터를 찾을 수 없습니다.' }, 404);
    }

    const apiKey = isEmploymentSuccessCandidate(client) ? resolveOpenAIKey(body.openAIKey) : null;
    const result = await syncOneClient(admin, client, apiKey);

    console.log('[sync-employment-success-case] single', {
      clientId: client.client_id,
      status: result.status,
    });

    return json(result);
  } catch (error) {
    console.error('[sync-employment-success-case] failed', error);
    return json(
      {
        error: error instanceof Error ? error.message : '성공사례 동기화 중 오류가 발생했습니다.',
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
  clientId: number,
): Promise<EmploymentSourceRow | null> {
  const { data, error } = await admin
    .from('client')
    .select(CLIENT_SELECT_FIELDS)
    .eq('client_id', clientId)
    .maybeSingle();

  if (error) throw error;
  return (data as EmploymentSourceRow | null) ?? null;
}

async function fetchBackfillClients(
  admin: ReturnType<typeof createClient>,
  limit: number,
): Promise<EmploymentSourceRow[]> {
  const { data, error } = await admin
    .from('client')
    .select(CLIENT_SELECT_FIELDS)
    .eq('participation_stage', '취업완료')
    .not('hire_place', 'is', null)
    .order('client_id', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as EmploymentSourceRow[];
}

async function syncOneClient(
  admin: ReturnType<typeof createClient>,
  client: EmploymentSourceRow,
  apiKey: string | null,
): Promise<{ status: 'activated' | 'deactivated'; sourceClientId: number }> {
  if (!isEmploymentSuccessCandidate(client)) {
    const { error } = await admin
      .from('employment_success_case')
      .update({ is_active: false })
      .eq('source_client_id', client.client_id);

    if (error) throw error;

    return {
      status: 'deactivated',
      sourceClientId: client.client_id,
    };
  }

  if (!apiKey) {
    throw new Error('임베딩 생성을 위한 OpenAI API 키가 필요합니다.');
  }

  const rawText = buildEmbeddingText(client, { includeEmployment: true });
  const embedding = await createEmbedding(apiKey, rawText);
  const employmentDate = parseEmploymentDate(client.job_place_start, client.hire_date);

  const { error } = await admin
    .from('employment_success_case')
    .upsert({
      source_client_id: client.client_id,
      masked_client_name: maskKoreanName(client.client_name),
      age: client.age,
      age_decade: toAgeDecade(client.age),
      education_level: client.education_level,
      school_name: client.school_name,
      major: client.major,
      desired_job_1: client.desired_job_1,
      desired_job_2: client.desired_job_2,
      desired_job_3: client.desired_job_3,
      employment_company: client.hire_place,
      employment_type: client.hire_type,
      employment_job_type: client.hire_job_type,
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
    sourceClientId: client.client_id,
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
