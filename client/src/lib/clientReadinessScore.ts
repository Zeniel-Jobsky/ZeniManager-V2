import type { ClientRow, SessionRow, SurveyRow } from './supabase';

export interface ReadinessScoreBreakdown {
  key: 'profile' | 'progress' | 'activity' | 'capability' | 'employment';
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

  const profile = scoreProfile(client);
  const progress = scoreProgress(client);
  const activity = scoreActivity(client, sessions, latestSession, now);
  const capability = scoreCapability(client, latestSurvey);
  const employment = scoreEmployment(client);

  const breakdown = [profile, progress, activity, capability, employment];
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

function scoreProfile(client: ClientRow): ReadinessScoreBreakdown {
  let score = 0;

  if (hasText(client.desired_job)) score += 8;
  score += competencyGradeScore(client.competency_grade);

  if (hasText(client.education_level)) score += 2;
  if (hasText(client.major) || hasText(client.school)) score += 2;

  return {
    key: 'profile',
    label: '구직 기본정보',
    score: clamp(score, 0, 20),
    max: 20,
    reason: '희망직종, 기존 역량등급, 학력·전공 정보의 구직지원 활용 가능성을 반영',
  };
}

function scoreProgress(client: ClientRow): ReadinessScoreBreakdown {
  let score = participationStageScore(client.participation_stage);

  if (hasText(client.initial_counsel_date)) score += 3;
  if (hasText(client.recognition_date)) score += 3;
  if (hasText(client.iap_date)) score += 5;
  if (
    hasText(client.support_end_date) ||
    hasText(client.intensive_start) ||
    hasText(client.intensive_end)
  ) {
    score += 4;
  }

  return {
    key: 'progress',
    label: '관리 진행도',
    score: clamp(score, 0, 30),
    max: 30,
    reason: '참여단계, 초기상담, 인정통지, IAP, 집중취업지원·지원종료 진행상태를 반영',
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

  if (hasText(latestSession?.next_action)) score += 4;
  else if (hasText(client.counsel_notes)) score += 2;

  return {
    key: 'activity',
    label: '상담·구직활동',
    score: clamp(score, 0, 20),
    max: 20,
    reason: '상담 누적횟수, 최근 상담 시점, 다음 조치 또는 상담메모를 반영',
  };
}

function scoreCapability(
  client: ClientRow,
  survey: SurveyRow | null,
): ReadinessScoreBreakdown {
  let score = 0;

  if (survey) {
    score += smallPositiveSurveyScore(survey.survey_1);
    score += smallPositiveSurveyScore(survey.survey_2);
    score += smallPositiveSurveyScore(survey.survey_3);

    score += smallSupportNeedScore(survey.survey_4);
    score += smallSupportNeedScore(survey.survey_5);
    score += smallSupportNeedScore(survey.survey_6);

    score += smallInverseSurveyScore(survey.survey_7);
    score += smallPositiveSurveyScore(survey.survey_8);
  }

  if (hasText(client.training_name)) score += 2;
  if (
    hasText(client.work_exp_company) ||
    hasText(client.work_exp_type) ||
    hasText(client.work_exp_completed)
  ) {
    score += 2;
  }

  return {
    key: 'capability',
    label: '역량·지원준비',
    score: clamp(score, 0, 20),
    max: 20,
    reason: survey
      ? '구직준비도 설문, 직업훈련, 일경험을 반영'
      : '직업훈련·일경험을 반영하며 구직준비도 설문 등록 시 세부 지원 필요도를 추가 반영',
  };
}

function scoreEmployment(client: ClientRow): ReadinessScoreBreakdown {
  let score = 0;

  if (isEmploymentStage(client.participation_stage)) score += 4;
  if (hasText(client.employer)) score += 2;
  if (hasText(client.job_title)) score += 2;
  if (hasText(client.employment_date)) score += 2;

  return {
    key: 'employment',
    label: '취업·후속관리',
    score: clamp(score, 0, 10),
    max: 10,
    reason: '취업단계, 취업처, 직무, 취업일자 등 실제 성과 기록을 반영',
  };
}

function competencyGradeScore(value: string | null | undefined): number {
  const grade = normalize(value).toUpperCase();
  if (grade === 'A') return 8;
  if (grade === 'B') return 6;
  if (grade === 'C') return 4;
  if (grade === 'D') return 2;
  return grade ? 3 : 0;
}

function smallPositiveSurveyScore(value: number | null | undefined): number {
  if (value === 3) return 2;
  if (value === 2) return 1;
  return 0;
}

function smallInverseSurveyScore(value: number | null | undefined): number {
  if (value === 1) return 2;
  if (value === 2) return 1;
  return 0;
}

function smallSupportNeedScore(value: number | null | undefined): number {
  if (value === 1) return 2;
  if (value === 2) return 1;
  return 0;
}

function sessionCountScore(count: number): number {
  if (count >= 4) return 8;
  if (count === 3) return 7;
  if (count === 2) return 5;
  if (count === 1) return 3;
  return 0;
}

function recencyScore(value: string | null | undefined, now: Date): number {
  if (!value) return 0;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;

  const diffMs = now.getTime() - date.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days < 0) return 0;
  if (days <= 30) return 8;
  if (days <= 60) return 6;
  if (days <= 90) return 4;
  return 2;
}

function participationStageScore(value: string | null | undefined): number {
  const stage = normalize(value);
  if (!stage) return 0;

  if (isEmploymentStage(stage)) return 15;
  if (stage.includes('집중취업') || stage.includes('구직활동') || stage === '취업지원') return 12;
  if (
    stage.includes('iap') ||
    stage.includes('수립') ||
    stage.includes('직업훈련') ||
    stage.includes('취업알선')
  ) {
    return 9;
  }
  if (stage.includes('심층')) return 6;
  if (stage.includes('초기')) return 3;
  return 5;
}

function isEmploymentStage(value: string | null | undefined): boolean {
  const stage = normalize(value);
  if (!stage) return false;

  return (
    stage === '취업' ||
    stage === '취업완료' ||
    stage.endsWith('취업') ||
    stage.startsWith('취업(') ||
    ['파견', '공무원합격', '창업'].includes(stage)
  );
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
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  return 'D';
}

function gradeLabel(grade: ClientReadinessScore['grade']): string {
  if (grade === 'A') return '관리·구직 진행 우수';
  if (grade === 'B') return '안정적 진행';
  if (grade === 'C') return '보완 필요';
  return '집중관리 필요';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
