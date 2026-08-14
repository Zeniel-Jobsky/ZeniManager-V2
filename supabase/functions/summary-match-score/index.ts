import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

type RequestBody = {
  desiredJobs?: string[];
  certifications?: string[];
  extraSpecs?: string[];
  gender?: string | null;
};

type PeerClient = {
  client_id: number;
  desired_job_1: string | null;
  desired_job_2: string | null;
  desired_job_3: string | null;
  work_ex_history: string | null;
  work_ex_company: string | null;
  participation_stage: string | null;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async request => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.');
    }

    const body = await request.json() as RequestBody;
    const desiredJobs = normalizeArray(body.desiredJobs);
    const certifications = normalizeArray(body.certifications);
    const extraSpecs = normalizeArray(body.extraSpecs);

    if (desiredJobs.length === 0) {
      return json({
        score: null,
        reason: '희망 직업 정보가 없어 동일 직군 비교를 수행할 수 없습니다.',
        matchedPeerCount: 0,
        percentile: null,
        comparedJobs: [],
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const peerRows = await fetchPeerClients(admin, desiredJobs);
    if (peerRows.length === 0) {
      return json({
        score: null,
        reason: '동일 직군 비교 대상자가 아직 없습니다.',
        matchedPeerCount: 0,
        percentile: null,
        comparedJobs: desiredJobs,
      });
    }

    const peerIds = peerRows.map(row => row.client_id);

    const [{ data: certificateRows, error: certificateError }, { data: trainingRows, error: trainingError }] = await Promise.all([
      admin
        .from('client_certificates')
        .select('client_id, certificate_name')
        .in('client_id', peerIds),
      admin
        .from('work_tranning')
        .select('client_id, tranning_type, tranning_name')
        .in('client_id', peerIds),
    ]);

    if (certificateError) throw certificateError;
    if (trainingError) throw trainingError;

    const peerProfiles = peerRows.map(peer => {
      const peerCertificates = normalizeArray(
        (certificateRows ?? [])
          .filter(row => row.client_id === peer.client_id)
          .map(row => row.certificate_name),
      );

      const peerSpecs = normalizeArray([
        peer.work_ex_history,
        peer.work_ex_company,
        ...((trainingRows ?? [])
          .filter(row => row.client_id === peer.client_id)
          .flatMap(row => [row.tranning_type, row.tranning_name])),
      ]);

      return {
        clientId: peer.client_id,
        desiredJobs: normalizeArray([peer.desired_job_1, peer.desired_job_2, peer.desired_job_3]),
        certificates: peerCertificates,
        extraSpecs: peerSpecs,
      };
    });

    const certificateCounts = peerProfiles.map(profile => profile.certificates.length);
    const specCounts = peerProfiles.map(profile => profile.extraSpecs.length);
    const certificateOverlapRatios = peerProfiles.map(profile => overlapRatio(certifications, profile.certificates));
    const specOverlapRatios = peerProfiles.map(profile => overlapRatio(extraSpecs, profile.extraSpecs));

    const certificatePercentile = percentileRank(certifications.length, certificateCounts);
    const specPercentile = percentileRank(extraSpecs.length, specCounts);
    const averageCertificateOverlap = average(certificateOverlapRatios);
    const averageSpecOverlap = average(specOverlapRatios);

    const baseline = 20;
    const certificateDepthScore = certificateCounts.length > 0 ? (certificatePercentile / 100) * 25 : 0;
    const certificateMatchScore = averageCertificateOverlap * 25;
    const specDepthScore = specCounts.length > 0 ? (specPercentile / 100) * 15 : 0;
    const specMatchScore = averageSpecOverlap * 15;

    const finalScore = clampScore(
      Math.round(baseline + certificateDepthScore + certificateMatchScore + specDepthScore + specMatchScore),
    );

    const overallPercentile = Math.round((certificatePercentile + specPercentile) / 2);

    return json({
      score: finalScore,
      reason: buildReason({
        desiredJobs,
        matchedPeerCount: peerProfiles.length,
        certificatePercentile,
        specPercentile,
        averageCertificateOverlap,
        averageSpecOverlap,
      }),
      matchedPeerCount: peerProfiles.length,
      percentile: overallPercentile,
      comparedJobs: desiredJobs,
    });
  } catch (error) {
    return json(
      {
        score: null,
        reason: error instanceof Error ? error.message : '점수 계산 중 오류가 발생했습니다.',
        matchedPeerCount: 0,
        percentile: null,
        comparedJobs: [],
      },
      500,
    );
  }
});

async function fetchPeerClients(
  admin: ReturnType<typeof createClient>,
  desiredJobs: string[],
): Promise<PeerClient[]> {
  const escaped = desiredJobs.slice(0, 5).map(escapeLikeValue);
  const orFilter = escaped.flatMap(job => [
    `desired_job_1.ilike.%${job}%`,
    `desired_job_2.ilike.%${job}%`,
    `desired_job_3.ilike.%${job}%`,
  ]).join(',');

  const { data, error } = await admin
    .from('client')
    .select('client_id, desired_job_1, desired_job_2, desired_job_3, work_ex_history, work_ex_company, participation_stage')
    .or(orFilter)
    .limit(300);

  if (error) throw error;

  return (data ?? []) as PeerClient[];
}

function normalizeArray(values: Array<string | null | undefined> | undefined): string[] {
  return Array.from(
    new Set(
      (values ?? [])
        .map(value => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''))
        .filter(Boolean),
    ),
  );
}

function overlapRatio(source: string[], target: string[]): number {
  if (source.length === 0 || target.length === 0) return 0;

  const normalizedTarget = target.map(normalizeToken);
  const matches = source.filter(sourceItem => {
    const token = normalizeToken(sourceItem);
    return normalizedTarget.some(targetItem => targetItem.includes(token) || token.includes(targetItem));
  });

  return matches.length / source.length;
}

function percentileRank(value: number, population: number[]): number {
  if (population.length === 0) return 0;
  const lowerOrEqual = population.filter(item => item <= value).length;
  return Math.round((lowerOrEqual / population.length) * 100);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}

function escapeLikeValue(value: string): string {
  return value.replace(/[%_,]/g, '');
}

function clampScore(value: number): number {
  return Math.min(100, Math.max(1, value));
}

function buildReason(input: {
  desiredJobs: string[];
  matchedPeerCount: number;
  certificatePercentile: number;
  specPercentile: number;
  averageCertificateOverlap: number;
  averageSpecOverlap: number;
}): string {
  return [
    `${input.desiredJobs.join(', ')} 직군 기준 ${input.matchedPeerCount}명의 유사 데이터를 비교했습니다.`,
    `자격증 보유 수준은 동일 직군 대비 ${input.certificatePercentile}백분위입니다.`,
    `부가 스펙 수준은 동일 직군 대비 ${input.specPercentile}백분위입니다.`,
    `자격증 일치도는 ${Math.round(input.averageCertificateOverlap * 100)}%, 부가 스펙 일치도는 ${Math.round(input.averageSpecOverlap * 100)}%입니다.`,
  ].join(' ');
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
