import { fetchSessions, fetchSurveys } from "./api";
import {
  getOpenAIKey,
  getSupabaseClient,
  isSupabaseConfigured,
  type ClientRow,
  type SessionRow,
  type SurveyRow,
} from "./supabase";

const COUNSELING_ANALYSIS_TABLE = "client_counseling_analysis";
const OPENAI_MODEL = "gpt-4o-mini";

export type AnalysisLevel = "높음" | "보통" | "낮음" | "정보 부족";

export interface AnalysisIndicator {
  level: AnalysisLevel;
  score: number | null;
  reason: string;
}

export interface CounselingDataAnalysis {
  summary: string;
  jobWill: AnalysisIndicator;
  readiness: AnalysisIndicator;
  strengths: string[];
  barriers: string[];
  recommendations: string[];
  nextActions: string[];
  sourceInfo: {
    sessionCount: number;
    latestSessionDate: string | null;
    surveyDate: string | null;
    generatedAt: string;
    model: string;
  };
}

type StoredCounselingAnalysis = {
  client_id: string;
  source_hash: string;
  result: CounselingDataAnalysis;
  sources: Record<string, unknown>;
  model: string;
  generated_at: string;
};

type AnalysisSource = {
  client: {
    desiredJob: string | null;
    participationStage: string | null;
    educationLevel: string | null;
    trainingName: string | null;
    workExperienceIntent: string | null;
    workExperienceCompany: string | null;
    employmentType: string | null;
    employmentDate: string | null;
    employer: string | null;
    jobTitle: string | null;
    counselNotes: string | null;
  };
  sessions: Array<{
    id: string;
    date: string;
    type: string;
    content: string | null;
    nextAction: string | null;
  }>;
  survey: SurveyRow | null;
};

export async function loadOrGenerateCounselingAnalysis(
  client: ClientRow,
  options?: { force?: boolean }
): Promise<CounselingDataAnalysis> {
  const sessions = await safeFetchSessions(client.id);
  const surveys = await safeFetchSurveys(client.id);
  const latestSurvey = surveys[0] ?? null;
  const source = buildSource(client, sessions, latestSurvey);
  const sourceHash = await sha256(JSON.stringify(source));

  if (!options?.force) {
    const cached = await fetchStoredAnalysis(client.id);
    if (
      cached?.source_hash === sourceHash &&
      isCounselingDataAnalysis(cached.result)
    ) {
      return cached.result;
    }
  }

  const fallback = buildRuleBasedAnalysis(client, sessions, latestSurvey);
  const enhanced = await enhanceWithOpenAI(source, fallback);
  const generatedAt = new Date().toISOString();
  const result: CounselingDataAnalysis = {
    ...enhanced.result,
    sourceInfo: {
      sessionCount: sessions.length,
      latestSessionDate: sessions[0]?.date ?? null,
      surveyDate: latestSurvey?.survey_date ?? null,
      generatedAt,
      model: enhanced.model,
    },
  };

  await saveAnalysis({
    clientId: client.id,
    sourceHash,
    result,
    model: enhanced.model,
    generatedAt,
    sources: {
      session_ids: sessions.map(session => session.id),
      survey_id: latestSurvey?.survey_id ?? null,
      survey_date: latestSurvey?.survey_date ?? null,
      participation_stage: client.participation_stage,
      desired_job: client.desired_job,
    },
  });

  return result;
}

async function safeFetchSessions(clientId: string): Promise<SessionRow[]> {
  try {
    return await fetchSessions(clientId);
  } catch (error) {
    console.warn("[counselingAnalysis] session load failed", error);
    return [];
  }
}

async function safeFetchSurveys(clientId: string): Promise<SurveyRow[]> {
  try {
    return await fetchSurveys(clientId);
  } catch (error) {
    console.warn("[counselingAnalysis] survey load failed", error);
    return [];
  }
}

function buildSource(
  client: ClientRow,
  sessions: SessionRow[],
  survey: SurveyRow | null
): AnalysisSource {
  return {
    client: {
      desiredJob: client.desired_job,
      participationStage: client.participation_stage,
      educationLevel: client.education_level,
      trainingName: client.training_name,
      workExperienceIntent: client.work_exp_intent,
      workExperienceCompany: client.work_exp_company,
      employmentType: client.employment_type,
      employmentDate: client.employment_date,
      employer: client.employer,
      jobTitle: client.job_title,
      counselNotes: redactSensitiveText(client.counsel_notes),
    },
    sessions: sessions.map(session => ({
      id: session.id,
      date: session.date,
      type: session.type,
      content: redactSensitiveText(session.content),
      nextAction: redactSensitiveText(session.next_action),
    })),
    survey,
  };
}

async function fetchStoredAnalysis(
  clientId: string
): Promise<StoredCounselingAnalysis | null> {
  if (!isSupabaseConfigured()) return null;
  const client = getSupabaseClient();
  if (!client) return null;

  try {
    const { data, error } = await client
      .from(COUNSELING_ANALYSIS_TABLE)
      .select("client_id, source_hash, result, sources, model, generated_at")
      .eq("client_id", clientId)
      .maybeSingle();

    if (error) throw error;
    return (data as StoredCounselingAnalysis | null) ?? null;
  } catch (error) {
    console.warn("[counselingAnalysis] cached analysis load failed", error);
    return null;
  }
}

async function saveAnalysis(input: {
  clientId: string;
  sourceHash: string;
  result: CounselingDataAnalysis;
  sources: Record<string, unknown>;
  model: string;
  generatedAt: string;
}): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const client = getSupabaseClient();
  if (!client) return;

  try {
    const { error } = await client.from(COUNSELING_ANALYSIS_TABLE).upsert(
      {
        client_id: input.clientId,
        source_hash: input.sourceHash,
        result: input.result,
        sources: input.sources,
        model: input.model,
        generated_at: input.generatedAt,
      },
      { onConflict: "client_id" }
    );
    if (error) throw error;
  } catch (error) {
    // Analysis remains usable in the UI even when persistence is temporarily blocked.
    console.warn("[counselingAnalysis] analysis save failed", error);
  }
}

function buildRuleBasedAnalysis(
  client: ClientRow,
  sessions: SessionRow[],
  survey: SurveyRow | null
): Omit<CounselingDataAnalysis, "sourceInfo"> {
  const latest = sessions[0] ?? null;
  const jobWillScore = survey?.survey_2
    ? positiveScore(survey.survey_2)
    : null;

  const readinessScores = survey
    ? [
        positiveScore(survey.survey_1),
        positiveScore(survey.survey_2),
        positiveScore(survey.survey_3),
        inverseScore(survey.survey_4),
        inverseScore(survey.survey_5),
        inverseScore(survey.survey_6),
        inverseScore(survey.survey_7),
        positiveScore(survey.survey_8),
      ].filter((value): value is number => value !== null)
    : [];

  const readinessScore =
    readinessScores.length > 0
      ? Math.round(
          readinessScores.reduce((sum, value) => sum + value, 0) /
            readinessScores.length
        )
      : null;

  const strengths = unique([
    client.desired_job ? `희망 직종이 '${client.desired_job}'로 설정되어 있음` : null,
    survey?.survey_1 === 3 ? "구직 목표가 명확함" : null,
    survey?.survey_2 === 3 ? "3개월 내 취업 의지가 높음" : null,
    survey?.survey_3 === 3 ? "희망 직종에 대한 구직 계획이 구체적임" : null,
    survey?.survey_8 === 3 ? "건강상태가 취업활동에 큰 지장이 없는 것으로 응답함" : null,
    client.training_name ? `직업훈련 이력: ${client.training_name}` : null,
    sessions.length >= 3 ? `상담 이력 ${sessions.length}건으로 참여 지속성이 확인됨` : null,
  ]);

  const barriers = unique([
    survey?.survey_4 && survey.survey_4 >= 2
      ? "이력서·면접 등 구직기술 지원 필요"
      : null,
    survey?.survey_5 && survey.survey_5 >= 2
      ? "취업처 발굴·채용정보 지원 필요"
      : null,
    survey?.survey_6 && survey.survey_6 >= 2
      ? "직업훈련·자격증 등 취업역량 향상 지원 필요"
      : null,
    survey?.survey_7 && survey.survey_7 >= 2
      ? survey.survey_7_memo?.trim()
        ? `취업 장애요인: ${survey.survey_7_memo.trim()}`
        : "취업 장애요인이 있다고 응답함"
      : null,
    survey?.survey_8 && survey.survey_8 <= 2
      ? "건강상태가 취업활동에 영향을 줄 가능성 확인 필요"
      : null,
  ]);

  const recommendations = unique([
    survey?.survey_4 && survey.survey_4 >= 2
      ? "이력서 점검과 모의면접을 우선 지원"
      : null,
    survey?.survey_5 && survey.survey_5 >= 2
      ? client.desired_job
        ? `${client.desired_job} 중심으로 채용공고와 기업정보를 선별 제공`
        : "희망 직종을 구체화한 뒤 맞춤 채용정보를 제공"
      : null,
    survey?.survey_6 && survey.survey_6 >= 2
      ? "희망 직무에 필요한 훈련·자격 요건을 확인하고 보완계획 수립"
      : null,
    survey?.survey_7 && survey.survey_7 >= 2
      ? "취업 장애요인을 우선순위별로 정리하고 해결 가능한 지원서비스 연계 검토"
      : null,
    barriers.length === 0 && client.desired_job
      ? `${client.desired_job} 관련 실제 채용공고 지원으로 구직활동을 구체화`
      : null,
  ]);

  const nextActions = unique([
    latest?.next_action?.trim() || null,
    survey?.survey_3 && survey.survey_3 < 3
      ? "다음 상담에서 구체적인 주간 구직활동 계획 수립"
      : null,
    survey?.survey_4 && survey.survey_4 >= 2
      ? "이력서 또는 자기소개서 1차 점검"
      : null,
    survey?.survey_5 && survey.survey_5 >= 2
      ? "맞춤 채용공고 3건 이상 검토"
      : null,
    survey?.survey_6 && survey.survey_6 >= 2
      ? "직무역량 보완 항목과 교육·자격 과정 확인"
      : null,
    sessions.length === 0 ? "초기상담 기록 작성" : null,
  ]);

  const summaryParts = [
    client.desired_job
      ? `희망 직종은 ${client.desired_job}로 확인됩니다.`
      : "희망 직종은 추가 확인이 필요합니다.",
    latest
      ? `최근 상담은 ${latest.date} ${latest.type}이며, ${summarizeText(
          latest.content,
          120
        )}`
      : "등록된 상담 이력이 없습니다.",
    survey
      ? `최근 구직준비도 설문은 ${survey.survey_date}에 작성되었고, 구직의지는 ${answerLabel(
          survey.survey_2
        )}, 구직계획은 ${answerLabel(survey.survey_3)}로 응답했습니다.`
      : "구직준비도 설문이 없어 준비도 평가는 제한적입니다.",
  ];

  return {
    summary: summaryParts.join(" "),
    jobWill: {
      level: levelFromScore(jobWillScore),
      score: jobWillScore,
      reason: survey
        ? `구직준비도 설문 2번(3개월 내 구직의지) 응답: ${answerLabel(
            survey.survey_2
          )}`
        : "구직준비도 설문이 없어 판단 근거가 부족합니다.",
    },
    readiness: {
      level: levelFromScore(readinessScore),
      score: readinessScore,
      reason: survey
        ? "구직목표·의지·계획·지원필요도·장애요인·건강상태 응답을 종합한 준비도입니다."
        : "구직준비도 설문이 없어 판단 근거가 부족합니다.",
    },
    strengths: strengths.length > 0 ? strengths : ["확인 가능한 강점 정보가 아직 부족합니다."],
    barriers: barriers.length > 0 ? barriers : ["설문에서 뚜렷한 취업 장애요인이 확인되지 않았습니다."],
    recommendations:
      recommendations.length > 0
        ? recommendations
        : ["상담 이력과 희망 직무를 기준으로 구직활동 계획을 구체화합니다."],
    nextActions:
      nextActions.length > 0
        ? nextActions
        : ["다음 상담에서 현재 구직활동 현황과 지원 필요사항을 재확인합니다."],
  };
}

async function enhanceWithOpenAI(
  source: AnalysisSource,
  fallback: Omit<CounselingDataAnalysis, "sourceInfo">
): Promise<{
  result: Omit<CounselingDataAnalysis, "sourceInfo">;
  model: string;
}> {
  const openAIKey = getOpenAIKey();
  if (!openAIKey) {
    return { result: fallback, model: "rule-based-v1" };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openAIKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "당신은 취업상담 기록 분석 보조도구입니다. 제공된 상담이력, 기본정보, 구직준비도 설문만 근거로 분석하세요. 기록에 없는 사실·진단·성격·의학적 상태를 추정하지 마세요. 개인정보를 재구성하지 마세요. 결과는 한국어 JSON만 반환하세요.",
          },
          {
            role: "user",
            content: JSON.stringify({
              task:
                "상담사가 다음 상담을 준비할 수 있도록 현재 상태를 요약하고, 구직의지·취업준비도·강점·장애요인·권고사항·다음 액션을 근거 중심으로 정리하세요.",
              rules: [
                "구직의지와 취업준비도 score는 0~100 또는 null",
                "근거가 부족하면 level은 '정보 부족'으로 표시",
                "상담 기록에 없는 강점이나 장애요인을 만들지 않음",
                "recommendations와 nextActions는 실제 상담사가 실행할 수 있는 수준으로 작성",
                "각 배열은 최대 6개",
              ],
              source,
              deterministicBaseline: fallback,
              outputSchema: {
                summary: "string",
                jobWill: {
                  level: "높음|보통|낮음|정보 부족",
                  score: "number|null",
                  reason: "string",
                },
                readiness: {
                  level: "높음|보통|낮음|정보 부족",
                  score: "number|null",
                  reason: "string",
                },
                strengths: ["string"],
                barriers: ["string"],
                recommendations: ["string"],
                nextActions: ["string"],
              },
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed: ${response.status}`);
    }

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content;
    if (!raw) throw new Error("OpenAI returned an empty response.");

    const parsed = JSON.parse(raw);
    return {
      result: normalizeAiResult(parsed, fallback),
      model: OPENAI_MODEL,
    };
  } catch (error) {
    console.warn("[counselingAnalysis] AI enhancement failed", error);
    return { result: fallback, model: "rule-based-v1" };
  }
}

function normalizeAiResult(
  value: any,
  fallback: Omit<CounselingDataAnalysis, "sourceInfo">
): Omit<CounselingDataAnalysis, "sourceInfo"> {
  return {
    summary: safeString(value?.summary, fallback.summary, 1200),
    jobWill: normalizeIndicator(value?.jobWill, fallback.jobWill),
    readiness: normalizeIndicator(value?.readiness, fallback.readiness),
    strengths: safeStringArray(value?.strengths, fallback.strengths),
    barriers: safeStringArray(value?.barriers, fallback.barriers),
    recommendations: safeStringArray(
      value?.recommendations,
      fallback.recommendations
    ),
    nextActions: safeStringArray(value?.nextActions, fallback.nextActions),
  };
}

function normalizeIndicator(
  value: any,
  fallback: AnalysisIndicator
): AnalysisIndicator {
  const score =
    typeof value?.score === "number" && Number.isFinite(value.score)
      ? Math.max(0, Math.min(100, Math.round(value.score)))
      : fallback.score;
  const level = isAnalysisLevel(value?.level)
    ? value.level
    : score === null
      ? fallback.level
      : levelFromScore(score);

  return {
    level,
    score,
    reason: safeString(value?.reason, fallback.reason, 500),
  };
}

function isCounselingDataAnalysis(value: any): value is CounselingDataAnalysis {
  return Boolean(
    value &&
      typeof value.summary === "string" &&
      value.jobWill &&
      value.readiness &&
      Array.isArray(value.strengths) &&
      Array.isArray(value.barriers) &&
      Array.isArray(value.recommendations) &&
      Array.isArray(value.nextActions)
  );
}

function isAnalysisLevel(value: unknown): value is AnalysisLevel {
  return (
    value === "높음" ||
    value === "보통" ||
    value === "낮음" ||
    value === "정보 부족"
  );
}

function positiveScore(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (value <= 1) return 0;
  if (value === 2) return 50;
  return 100;
}

function inverseScore(value: number | null | undefined): number | null {
  const positive = positiveScore(value);
  return positive === null ? null : 100 - positive;
}

function levelFromScore(score: number | null): AnalysisLevel {
  if (score === null) return "정보 부족";
  if (score >= 67) return "높음";
  if (score >= 34) return "보통";
  return "낮음";
}

function answerLabel(value: number | null | undefined): string {
  if (value === 3) return "예";
  if (value === 2) return "보통";
  if (value === 1) return "아니오";
  return "미응답";
}

function summarizeText(value: string | null | undefined, maxLength: number): string {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) return "상담 내용은 별도 확인이 필요합니다.";
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}…`
    : normalized;
}

function redactSensitiveText(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .replace(/\b01[016789][\s-]?\d{3,4}[\s-]?\d{4}\b/g, "[연락처]")
    .replace(/\b\d{6}[\s-]?[1-4]\d{6}\b/g, "[주민번호]")
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      "[이메일]"
    )
    .trim();
}

function safeString(
  value: unknown,
  fallback: string,
  maxLength: number
): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return value.trim().slice(0, maxLength);
}

function safeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const cleaned = unique(
    value
      .filter((item): item is string => typeof item === "string")
      .map(item => item.trim().slice(0, 300))
      .filter(Boolean)
  ).slice(0, 6);
  return cleaned.length > 0 ? cleaned : fallback;
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map(value => value?.trim())
        .filter((value): value is string => Boolean(value))
    )
  );
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}
