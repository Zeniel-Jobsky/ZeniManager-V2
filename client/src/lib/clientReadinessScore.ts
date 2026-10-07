import type { ClientRow, SessionRow, SurveyRow } from './supabase';

export interface ReadinessScoreBreakdown {
  key: 'readiness' | 'activity' | 'capability' | 'progress' | 'records';
  label: string;
  score: number;
  max: number;
  reason: string;
}

export interface ClientReadinessScore {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D';
  label: string;
  breakdown: ReadinessScoreBreakdown[];
  calculatedAt: string;
}

export function calculateClientReadinessScore(
  client: ClientRow,
  sessions: SessionRow[],
  surveys: SurveyRow[],
  now = new Date(),
): ClientReadinessScore {
  const latestSurvey = [...surveys]
    .sort((a, b) => (b.survey_date || '').localeCompare(a.survey_date || ''))[0] ?? null;
  const latestSession = [...sessions]
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0] ?? null;

  const readiness = scoreReadiness(client, latestSurvey);
  const activity = scoreActivity(client, sessions, latestSession, now);
  const capability = scoreCapability(client, latestSurvey);
  const progress = scoreProgress(client);
  const records = scoreRecords(client, sessions);

  const breakdown = [readiness, activity, capability, progress, records];
  const score = clamp(
    Math.round(breakdown.reduce((sum, item) => sum + item.score, 0)),
    0,
    100,
  );
  const grade = toGrade(score);

  return {
    score,
    grade,
    label: gradeLabel(grade),
    breakdown,
    calculatedAt: new Date().toISOString(),
  };
}

function scoreReadiness(
  client: ClientRow,
  survey: SurveyRow | null,
): ReadinessScoreBreakdown {
  let score = hasText(client.desired_job) ? 5 : 0;

  score += positiveSurveyScore(survey?.survey_1, 5);
  score += positiveSurveyScore(survey?.survey_2, 5);
  score += positiveSurveyScore(survey?.survey_3, 5);
  score += inverseSurveyScore(survey?.survey_7, 5);

  return {
    key: 'readiness',
    label: '구직 목표·의지',
    score: clamp(score, 0, 25),
    max: 25,
    reason: survey
      ? '희망직종, 구직목표, 취업의지, 계획, 장애요인을 반영'
      : '희망직종을 반영했으며 구직준비도 설문 등록 시 더 정교해집니다.',
  };
}

function scoreActivity(
  client: ClientRow,
  sessions: SessionRow[],
  latestSession: SessionRow | null,
  now: Date,
): ReadinessScoreBreakdown {
  let score = sessionCountScore(sessions.length);
  const latestDate = latestSession?.date || client.last_counsel_date || client.initial_counsel_date;
  score += recencyScore(latestDate, now);
  score += hasText(latestSession?.next_action) ? 5 : hasText(client.counsel_notes) ? 2 : 0;

  return {
    key: 'activity',
    label: '상담·구직활동',
    score: clamp(score, 0, 25),
    max: 25,
    reason: '상담 누적횟수, 최근 상담 시점, 다음 조치사항을 반영',
  };
}

function scoreCapability(
  client: ClientRow,
  survey: SurveyRow | null,
): ReadinessScoreBreakdown {
  let score = 0;

  // 문항 4~6은 "지원이 필요한가"를 묻기 때문에 낮은 필요도가 준비도 측면에서는 높은 점수다.
  score += supportNeedScore(survey?.survey_4);
  score += supportNeedScore(survey?.survey_5);
  score += supportNeedScore(survey?.survey_6);
  score += positiveSurveyScore(survey?.survey_8, 5);

  if (hasText(client.training_name)) score += 2.5;
  if (
    hasText(client.work_exp_company) ||
    hasText(client.work_exp_type) ||
    hasText(client.work_exp_completed)
  ) {
    score += 2.5;
  }

  return {
    key: 'capability',
    label: '지원역량·보완필요',
    score: clamp(Math.round(score * 10) / 10, 0, 25),
    max: 25,
    reason: survey
      ? '구직기술·정보·역량지원 필요도, 건강상태, 훈련·일경험을 반영'
      : '훈련·일경험을 반영했으며 구직준비도 설문 등록 시 지원 필요도를 함께 반영합니다.',
  };
}

function scoreProgress(client: ClientRow): ReadinessScoreBreakdown {
  let score = participationStageScore(client.participation_stage);
  if (hasText(client.iap_date)) score += 3;
  if (hasText(client.initial_counsel_date)) score += 2;

  return {
    key: 'progress',
    label: '관리 진행도',
    score: clamp(score, 0, 15),
    max: 15,
    reason: '참여단계, IAP 수립, 초기상담 진행 여부를 반영',
  };
}

function scoreRecords(
  client: ClientRow,
  sessions: SessionRow[],
): ReadinessScoreBreakdown {
  let score = 0;
  if (hasText(client.last_counsel_date)) score += 3;
  if (hasText(client.counsel_notes)) score += 2;
  if (hasText(client.rediagnosis_date) || isCompletedFlag(client.rediagnosis_yn)) score += 2;
  if (hasText(client.iap_duration) || hasText(client.allowance_apply_date)) score += 1;
  if (sessions.some(session => hasText(session.content))) score += 2;

  return {
    key: 'records',
    label: '관리기록 충실도',
    score: clamp(score, 0, 10),
    max: 10,
    reason: '최근상담일, 상담메모, 재진단, IAP·수당, 상담기록을 반영',
  };
}

function positiveSurveyScore(value: number | null | undefined, max: number): number {
  if (value === 3) return max;
  if (value === 2) return Math.round(max * 0.6 * 10) / 10;
  if (value === 1) return 0;
  return 0;
}

function inverseSurveyScore(value: number | null | undefined, max: number): number {
  if (value === 1) return max;
  if (value === 2) return Math.round(max * 0.4 * 10) / 10;
  if (value === 3) return 0;
  return 0;
}

function supportNeedScore(value: number | null | undefined): number {
  if (value === 1) return 5;
  if (value === 2) return 3;
  if (value === 3) return 1;
  return 0;
}

function sessionCountScore(count: number): number {
  if (count >= 4) return 10;
  if (count === 3) return 9;
  if (count === 2) return 7;
  if (count === 1) return 4;
  return 0;
}

function recencyScore(value: string | null | undefined, now: Date): number {
  if (!value) return 0;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;

  const diffMs = now.getTime() - date.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days < 0) return 0;
  if (days <= 30) return 10;
  if (days <= 60) return 7;
  if (days <= 90) return 4;
  return 1;
}

function participationStageScore(value: string | null | undefined): number {
  const stage = normalize(value);
  if (!stage) return 0;

  if (
    stage === '취업' ||
    stage === '취업완료' ||
    stage.endsWith('취업') ||
    stage.startsWith('취업(') ||
    ['파견', '공무원합격', '창업'].includes(stage)
  ) {
    return 10;
  }
  if (stage.includes('집중취업') || stage.includes('구직활동') || stage === '취업지원') return 8;
  if (stage.includes('iap') || stage.includes('수립')) return 6;
  if (stage.includes('심층')) return 4;
  if (stage.includes('초기')) return 2;
  return 1;
}

function isCompletedFlag(value: string | null | undefined): boolean {
  const normalized = normalize(value);
  return ['1', '완료', 'y', 'yes', 'true'].includes(normalized);
}

function normalize(value: string | null | undefined): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, '').trim().toLowerCase()
    : '';
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function toGrade(score: number): ClientReadinessScore['grade'] {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  return 'D';
}

function gradeLabel(grade: ClientReadinessScore['grade']): string {
  if (grade === 'A') return '준비도 높음';
  if (grade === 'B') return '취업활동 진행';
  if (grade === 'C') return '보완 필요';
  return '집중지원 필요';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
