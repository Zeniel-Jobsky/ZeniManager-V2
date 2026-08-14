export type EmploymentSourceRow = {
  client_id: number;
  client_name: string | null;
  age: number | null;
  education_level: string | null;
  school_name: string | null;
  major: string | null;
  desired_job_1: string | null;
  desired_job_2: string | null;
  desired_job_3: string | null;
  participation_stage: string | null;
  hire_place: string | null;
  hire_type: string | null;
  hire_job_type: string | null;
  hire_date: string | null;
  job_place_start: string | null;
};

export type SearchCandidateRow = {
  id: number;
  source_client_id: number;
  masked_client_name: string;
  age_decade: string;
  education_level: string | null;
  major: string | null;
  employment_company: string;
  employment_type: string | null;
  employment_job_type: string | null;
  employment_date: string | null;
  similarity: number | null;
};

export function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeList(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map(normalizeText).filter((value): value is string => Boolean(value))),
  );
}

export function maskKoreanName(name: string | null | undefined): string {
  const trimmed = normalizeText(name);
  if (!trimmed) return '익명';
  const [familyName] = Array.from(trimmed);
  return familyName ? `${familyName}OO` : '익명';
}

export function toAgeDecade(age: number | null | undefined): string {
  if (typeof age !== 'number' || !Number.isFinite(age) || age < 10) {
    return '연령 미상';
  }
  if (age >= 60) return '60대 이상';
  return `${Math.floor(age / 10) * 10}대`;
}

export function parseEmploymentDate(
  jobPlaceStart: string | null | undefined,
  hireDate: string | null | undefined,
): string | null {
  return normalizeDate(jobPlaceStart) ?? normalizeDate(hireDate);
}

export function isEmploymentSuccessCandidate(row: EmploymentSourceRow): boolean {
  return normalizeText(row.participation_stage) === '취업완료' && Boolean(normalizeText(row.hire_place));
}

export function buildEmbeddingText(
  row: EmploymentSourceRow,
  options: { includeEmployment: boolean },
): string {
  const desiredJobs = normalizeList([row.desired_job_1, row.desired_job_2, row.desired_job_3]);
  const sentences: string[] = [
    options.includeEmployment ? '취업 성공 사례 프로필입니다.' : '상담 대상자 프로필입니다.',
    `연령대는 ${toAgeDecade(row.age)}입니다.`,
  ];

  const education = normalizeText(row.education_level);
  if (education) sentences.push(`최종 학력은 ${education}입니다.`);

  const school = normalizeText(row.school_name);
  if (school) sentences.push(`학교명은 ${school}입니다.`);

  const major = normalizeText(row.major);
  if (major) sentences.push(`전공은 ${major}입니다.`);

  if (desiredJobs.length > 0) {
    sentences.push(`희망 직무는 ${desiredJobs.join(', ')}입니다.`);
  }

  if (options.includeEmployment) {
    const company = normalizeText(row.hire_place);
    if (company) sentences.push(`최종 취업처는 ${company}입니다.`);

    const jobType = normalizeText(row.hire_job_type);
    if (jobType) sentences.push(`취업 직무는 ${jobType}입니다.`);

    const hireType = normalizeText(row.hire_type);
    if (hireType) sentences.push(`고용 형태는 ${hireType}입니다.`);
  }

  return sentences.join(' ');
}

export function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

export async function createEmbedding(apiKey: string, input: string): Promise<number[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input,
      encoding_format: 'float',
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`임베딩 생성 실패: ${response.status} ${detail}`);
  }

  const payload = await response.json() as { data?: Array<{ embedding?: number[] }> };
  const embedding = payload.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('임베딩 응답 형식이 올바르지 않습니다.');
  }
  return embedding;
}

export function resolveOpenAIKey(requestKey?: string | null): string {
  const key = normalizeText(requestKey) ?? Deno.env.get('OPENAI_API_KEY') ?? null;
  if (!key) {
    throw new Error('앱 설정에 OpenAI API Key가 필요합니다.');
  }
  return key;
}

export function clampLimit(value: number | null | undefined, fallback: number, max = 20): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(value)));
}

export function buildMatchReason(
  similarity: number,
  flags: {
    ageMatched: boolean;
    educationMatched: boolean;
    majorMatched: boolean;
    majorPartialMatched: boolean;
  },
): string {
  const reasons = [`벡터 유사도 ${Math.round(similarity * 100)}%`];
  if (flags.ageMatched) reasons.push('연령대 일치');
  if (flags.educationMatched) reasons.push('학력 일치');
  if (flags.majorMatched) reasons.push('전공 일치');
  else if (flags.majorPartialMatched) reasons.push('전공 유사');
  return reasons.join(' · ');
}

export function majorMatchLevel(
  sourceMajor: string | null | undefined,
  targetMajor: string | null | undefined,
): 'exact' | 'partial' | 'none' {
  const left = normalizeText(sourceMajor)?.toLowerCase();
  const right = normalizeText(targetMajor)?.toLowerCase();
  if (!left || !right) return 'none';
  if (left === right) return 'exact';
  if (left.includes(right) || right.includes(left)) return 'partial';
  return 'none';
}

function normalizeDate(value: string | null | undefined): string | null {
  const trimmed = normalizeText(value);
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
