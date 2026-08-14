import { getOpenAIKey } from "./supabase";
import type { ClientRow } from "./supabase";
import type { MergedDocumentProfile } from "./summaryAnalysis";

export interface MemoInsights {
  preferredSchedule: string | null;
  preferredSalary: string | null;
  preferredLocation: string | null;
  mbti: string | null;
  jobBarriers: string[];
  hiddenStrengths: string[];
}

export interface LanguageScoreEntry {
  type: "OPIc" | "TOEIC" | "TOEIC Speaking";
  score: string;
  raw: string;
}

export interface StructuredSummaryJson {
  clientId: string;
  desiredJobs: string[];
  qualifications: string[];
  certifications: string[];
  languageScores: string[];
  languageScoreDetails: LanguageScoreEntry[];
  experience: Array<{
    company: string | null;
    task: string | null;
  }>;
  education: string | null;
  additionalSpecs: {
    careerHistory: string[];
    completedEducation: string[];
  };
  memoInsights: MemoInsights;
  sourceSummary: string;
}

export interface CompetencyScoring {
  score: number;
  grade: "A" | "B" | "C" | "D" | "E" | "-";
  finalGrade: "A" | "B" | "C" | "D" | "E" | "-";
  breakdown: Array<{
    label: string;
    score: number;
    reason: string;
  }>;
}

export interface RecommendationResult {
  recommendedJobs: string[];
  industries: string[];
  reasons: string[];
  requiredCapabilities: string[];
}

export function extractMemoInsights(
  memo: string | null | undefined,
  mbti?: string | null
): MemoInsights {
  const text = memo?.trim() ?? "";

  return {
    preferredSchedule: findSingle(text, [
      /희망근무\s*요일\s*및\s*시간\s*[:：]?\s*([^\n-]+)/i,
      /희망근무\s*[:：]?\s*([^\n-]+)/i,
    ]),
    preferredSalary: findSingle(text, [
      /희망임금\s*[:：]?\s*([^\n-]+)/i,
      /희망\s*급여\s*[:：]?\s*([^\n-]+)/i,
    ]),
    preferredLocation: findSingle(text, [
      /희망근무지역\s*[:：]?\s*([^\n-]+)/i,
      /희망지역\s*[:：]?\s*([^\n-]+)/i,
    ]),
    mbti: mbti?.trim() || null,
    jobBarriers: collectLines(text, ["구직애로", "애로사항", "어려움"]).slice(
      0,
      6
    ),
    hiddenStrengths: collectLines(text, [
      "적성이",
      "강점",
      "잘 맞",
      "경험",
      "선호",
    ]).slice(0, 6),
  };
}

export function buildStructuredSummaryJson(
  client: ClientRow,
  profile: MergedDocumentProfile
): StructuredSummaryJson {
  const extractedMemoInsights = extractMemoInsights(client.memo, client.MBTI);
  const memoInsights = {
    ...extractedMemoInsights,
    preferredLocation:
      extractedMemoInsights.preferredLocation ??
      firstNonEmpty([client.desired_area_1, client.desired_area_2, client.desired_area_3]),
    preferredSalary:
      extractedMemoInsights.preferredSalary ?? formatDesiredPayment(client.desired_payment),
  };
  const cleanedCertifications = cleanData(profile.certifications);
  const cleanedExtraSpecs = cleanData(profile.extraSpecs);
  const combinedQualificationCandidates = [
    ...cleanedCertifications,
    ...expandAdditionalSpecValues(cleanedExtraSpecs),
    ...extractQualificationCandidates([
      ...cleanedExtraSpecs,
      ...profile.sourceTexts,
    ]),
  ];
  const { certifications, languageScores } = splitCertificationsAndLanguage(
    combinedQualificationCandidates
  );
  const languageScoreDetails = uniqueLanguageScoreEntries([
    ...parseLanguageScoreEntries(languageScores),
    ...extractLanguageScoreEntriesFromSourceTexts(profile.sourceTexts),
  ]);
  const { careerHistory, completedEducation } =
    splitAdditionalSpecs(cleanedExtraSpecs);
  const experience = buildExperience(cleanedExtraSpecs);
  const education = selectHighestEducation(
    cleanedExtraSpecs,
    client,
    profile.sourceTexts
  );

  return {
    clientId: client.id,
    desiredJobs: profile.desiredJobs,
    qualifications: certifications,
    certifications,
    languageScores: languageScoreDetails.map(entry => entry.raw),
    languageScoreDetails,
    experience,
    education,
    additionalSpecs: {
      careerHistory,
      completedEducation,
    },
    memoInsights,
    sourceSummary: profile.aiSummary,
  };
}

export function calculateCompetencyScoring(
  json: StructuredSummaryJson
): CompetencyScoring {
  const educationScore = scoreEducationLevel(json.education);
  const highestLanguageScores =
    json.languageScores.length > 0
      ? [
          json.languageScores.reduce((best, current) =>
            scoreLanguage(current) >= scoreLanguage(best) ? current : best
          ),
        ]
      : [];
  const breakdown = [
    {
      label: "기본 점수",
      score: 50,
      reason: "모든 사용자의 시작 점수",
    },
    {
      label: json.education ?? "학력 정보 없음",
      score: educationScore,
      reason: "최종 학력 1개 반영 점수",
    },
    ...json.certifications.map(name => ({
      label: name,
      score: scoreCertificate(name),
      reason: "자격증 절대 기준 점수",
    })),
    ...highestLanguageScores.map(name => ({
      label: name,
      score: scoreLanguage(name),
      reason: "어학 점수 절대 기준 점수",
    })),
  ];
  const score = clamp(
    breakdown.reduce((sum, item) => sum + item.score, 0),
    50,
    100
  );
  const grade = toGrade(score);

  return {
    score,
    grade,
    finalGrade: grade,
    breakdown,
  };
}

export async function buildRecommendation(
  json: StructuredSummaryJson
): Promise<RecommendationResult> {
  const fallback = buildRuleBasedRecommendation(json);
  const openAIKey = getOpenAIKey();

  if (!openAIKey) return fallback;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openAIKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        top_p: 1,
        seed: 42,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: getRecommendationSystemPrompt(),
          },
          {
            role: "user",
            content: JSON.stringify({
              task: "Recommend the best-fit jobs and industries from the structured candidate JSON.",
              candidate: json,
              outputSchema: {
                recommendedJobs: ["string"],
                industries: ["string"],
                reasons: ["string"],
                requiredCapabilities: ["string"],
              },
            }),
          },
        ],
      }),
    });

    if (!response.ok)
      throw new Error(`recommendation failed: ${response.status}`);

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content;
    if (!raw) throw new Error("empty recommendation response");
    const parsed = JSON.parse(raw);

    return {
      recommendedJobs: sanitizeStringList(
        parsed.recommendedJobs,
        fallback.recommendedJobs
      ),
      industries: sanitizeStringList(parsed.industries, fallback.industries),
      reasons: sanitizeStringList(parsed.reasons, fallback.reasons),
      requiredCapabilities: sanitizeStringList(
        parsed.requiredCapabilities,
        fallback.requiredCapabilities
      ),
    };
  } catch {
    return fallback;
  }
}

export function getSummaryExtractionPromptPreview(): {
  systemPrompt: string;
  extractionRules: Record<string, string>;
} {
  return {
    systemPrompt:
      "You extract only job-counseling-relevant structured facts from Korean documents. Return strict JSON only. Be consistent for the same input. If a field is missing, return an empty array or null instead of guessing.",
    extractionRules: {
      aiSummary:
        "Summarize only desired job, gender, certifications, and extra specs such as education and work history.",
      desiredJobs:
        "Return only atomic role names. Remove salary, region, schedule, counseling notes, and explanatory sentences.",
      certifications:
        "Return only certificate names and language test scores. If the text looks like 전산회계 1급, 정보처리기사, 컴활 2급, 토익 850점, it must go to qualifications/certifications and never to experience or extra specs. Delete salary and standalone numbers.",
      extraSpecs:
        "Return only previous companies/career history, job tasks, and completed education or training programs. Remove salary, allowance, amount, qualification names, language scores, or isolated numbers.",
    },
  };
}

export function getRecommendationSystemPrompt(): string {
  return [
    "You are a Korean career-matching analyst.",
    "Use only the provided structured JSON.",
    "Recommend jobs and industries that align with proven certifications, language scores, career history, and completed education.",
    "Do not recommend vague roles.",
    "Return strict JSON only.",
    "For each recommendation, explain why it matches and list capabilities still needed.",
  ].join(" ");
}

function buildRuleBasedRecommendation(
  json: StructuredSummaryJson
): RecommendationResult {
  const recommendedJobs =
    json.desiredJobs.length > 0
      ? json.desiredJobs.slice(0, 3)
      : inferJobsFromSkills(json);

  const industries = inferIndustries(recommendedJobs, json);

  return {
    recommendedJobs,
    industries,
    reasons: [
      json.certifications.length > 0
        ? `보유 자격증 ${json.certifications.join(", ")}이 직무 적합도를 높입니다.`
        : "문서에서 확인된 자격증은 제한적이지만 희망 직무 정보가 존재합니다.",
      json.additionalSpecs.careerHistory.length > 0
        ? `경력 이력 ${json.additionalSpecs.careerHistory.join(", ")}이 실무 적합성을 보완합니다.`
        : "경력 이력은 추가 확인이 필요합니다.",
      json.additionalSpecs.completedEducation.length > 0
        ? `교육 이수 ${json.additionalSpecs.completedEducation.join(", ")}가 직무 연계성을 높입니다.`
        : "교육 이수 이력은 추가 확인이 필요합니다.",
    ],
    requiredCapabilities: [
      "직무별 포트폴리오 또는 실무 사례 정리",
      "채용 공고 기준 핵심 키워드 이력서 반영",
      ...(json.languageScores.length === 0
        ? ["어학 점수 또는 커뮤니케이션 역량 보완"]
        : []),
    ],
  };
}

function inferJobsFromSkills(json: StructuredSummaryJson): string[] {
  if (json.certifications.some(item => item.includes("정보처리")))
    return ["인프라 엔지니어", "시스템 엔지니어"];
  if (
    json.additionalSpecs.completedEducation.some(item =>
      item.includes("마케팅")
    )
  )
    return ["마케팅 사무직", "콘텐츠 마케터"];
  if (json.additionalSpecs.careerHistory.some(item => item.includes("간호")))
    return ["간호사"];
  return ["사무직"];
}

function inferIndustries(
  recommendedJobs: string[],
  json: StructuredSummaryJson
): string[] {
  const values = new Set<string>();
  recommendedJobs.forEach(job => {
    if (/(엔지니어|개발|인프라|시스템)/.test(job)) values.add("IT 인프라");
    if (/(마케팅|홍보|콘텐츠)/.test(job)) values.add("디지털 마케팅");
    if (/(간호|의료)/.test(job)) values.add("의료 서비스");
    if (/(사무|행정|회계)/.test(job)) values.add("사무 행정");
  });
  if (
    json.additionalSpecs.completedEducation.some(item => item.includes("KOSA"))
  )
    values.add("IT 교육 연계");
  return values.size > 0 ? Array.from(values) : ["일반 사무"];
}

function splitCertificationsAndLanguage(values: string[]): {
  certifications: string[];
  languageScores: string[];
} {
  const certifications: string[] = [];
  const languageScores: string[] = [];

  cleanData(values.flatMap(splitMixedSpecValueV2)).forEach(value => {
    if (!cleanData([value]).length) return;
    if (parseLanguageScoreEntries([value]).length > 0) {
      languageScores.push(value);
    } else if (isQualificationEntry(value)) {
      certifications.push(value.replace(/[([]+$/g, "").trim());
    }
  });

  return {
    certifications: unique(certifications),
    languageScores: unique(languageScores),
  };
}

export function parseLanguageScoreEntries(
  values: string[]
): LanguageScoreEntry[] {
  return unique(values)
    .map(raw => {
      const normalized = raw.replace(/\s+/g, " ").trim();

      if (
        /(?:토익스피킹|토익 스피킹|toeic\s*speaking|toeic speaking)/i.test(
          normalized
        )
      ) {
        return {
          type: "TOEIC Speaking" as const,
          score:
            normalized
              .match(/\b(AH|AM|AL|IH|IM1|IM2|IM3)\b/i)?.[1]
              ?.toUpperCase() ?? normalized,
          raw: normalized,
        };
      }

      if (/(?:opic|opic|오픽)/i.test(normalized)) {
        return {
          type: "OPIc" as const,
          score:
            normalized.match(/\b(AL|IH|IM1|IM2|IM3)\b/i)?.[1]?.toUpperCase() ??
            normalized,
          raw: normalized,
        };
      }

      if (/(?:toeic|토익)/i.test(normalized)) {
        return {
          type: "TOEIC" as const,
          score: normalized.match(/(\d{3,4})/)?.[1] ?? normalized,
          raw: normalized,
        };
      }

      return null;
    })
    .filter((entry): entry is LanguageScoreEntry => entry !== null);
}

function extractLanguageScoreEntriesFromSourceTexts(
  values: string[]
): LanguageScoreEntry[] {
  const patterns: Array<{
    type: LanguageScoreEntry["type"];
    regex: RegExp;
    normalize: (match: RegExpExecArray) => string;
  }> = [
    {
      type: "TOEIC Speaking",
      regex:
        /(?:toeic\s*speaking|toeic speaking|토익\s*스피킹|토익스피킹)\s*[:\-]?\s*(AH|AM|AL|IH|IM1|IM2|IM3)/gi,
      normalize: match => match[1].toUpperCase(),
    },
    {
      type: "OPIc",
      regex: /(?:opic|opic|오픽)\s*[:\-]?\s*(AL|IH|IM1|IM2|IM3)/gi,
      normalize: match => match[1].toUpperCase(),
    },
    {
      type: "TOEIC",
      regex: /(?:toeic|토익)\s*[:\-]?\s*(\d{3,4})(?:점)?/gi,
      normalize: match => match[1],
    },
  ];

  const entries: LanguageScoreEntry[] = [];

  for (const rawText of values) {
    const normalizedText = rawText.replace(/\s+/g, " ").trim();
    for (const pattern of patterns) {
      pattern.regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.regex.exec(normalizedText)) !== null) {
        const score = pattern.normalize(match);
        entries.push({
          type: pattern.type,
          score,
          raw: `${pattern.type}: ${score}`,
        });
      }
    }
  }

  return uniqueLanguageScoreEntries(entries);
}

function uniqueLanguageScoreEntries(
  values: LanguageScoreEntry[]
): LanguageScoreEntry[] {
  let bestEntry: LanguageScoreEntry | null = null;

  for (const entry of values) {
    if (!bestEntry) {
      bestEntry = entry;
      continue;
    }

    const currentScore = scoreLanguage(entry.raw);
    const bestScore = scoreLanguage(bestEntry.raw);

    if (currentScore >= bestScore) {
      bestEntry = entry;
    }
  }

  return bestEntry ? [bestEntry] : [];
}

function splitAdditionalSpecs(values: string[]): {
  careerHistory: string[];
  completedEducation: string[];
} {
  const normalized = expandAdditionalSpecValues(values).filter(
    value => !isQualificationEntry(value)
  );
  const careerHistory = normalized.filter(
    value => isCompanyLike(value) || /(경력|근무|재직|인턴)/.test(value)
  );
  const completedEducation = normalized.filter(value =>
    /(대학교|대학원|학과|졸업|수료|교육|훈련|아카데미|부트캠프)/.test(value)
  );

  return {
    careerHistory: unique(careerHistory),
    completedEducation: unique(completedEducation),
  };
}

function scoreCertificate(value: string): number {
  if (/(?:\uC0B0\uC5C5\uAE30\uC0AC|industrial engineer)/i.test(value)) return 7;
  if (/(?:\uAE30\uC0AC|engineer)/i.test(value)) return 10;
  if (/(?:\uAE30\uB2A5\uC0AC|craftsman)/i.test(value)) return 5;
  if (
    /(?:\uCEF4\uD4E8\uD130\uD65C\uC6A9\uB2A5\uB825|\uCEF4\uD65C|\uC6CC\uB4DC\uD504\uB85C\uC138\uC11C|erp|gtq|mos|sqld|\uC804\uC0B0\uD68C\uACC4|\uC804\uC0B0\uC138\uBB34|\uD55C\uAD6D\uC0AC\uB2A5\uB825\uAC80\uC815|\uC720\uD1B5\uAD00\uB9AC\uC0AC|\uC0AC\uD68C\uBCF5\uC9C0\uC0AC|\uBCF4\uC721\uAD50\uC0AC|\uAC04\uD638\uC870\uBB34\uC0AC|\uC9C1\uC5C5\uC0C1\uB2F4\uC0AC|\uAD6D\uAC00\uACF5\uC778)/i.test(
      value
    )
  )
    return 5;
  return 3;
}

function scoreLanguage(value: string): number {
  const score = Number((value.match(/(\d{3,4})/) ?? [])[1] ?? 0);
  if (
    /(?:TOEIC\s*Speaking|\uD1A0\uC775\s*\uC2A4\uD53C\uD0B9|\uD1A0\uC775\uC2A4\uD53C\uD0B9)/i.test(
      value
    )
  ) {
    if (/(AH|AM)/i.test(value)) return 10;
    if (/(AL|IH)/i.test(value)) return 8;
    if (/(IM1|IM2|IM3)/i.test(value)) return 5;
    return 0;
  }
  if (/(?:OPIC|OPIc|\uC624\uD53D)/i.test(value)) {
    if (/(AL|IH)/i.test(value)) return 8;
    if (/(IM1|IM2|IM3)/i.test(value)) return 5;
    return 0;
  }
  if (score >= 900) return 8;
  if (score >= 800) return 6;
  if (score >= 700) return 4;
  if (score >= 600) return 2;
  return 0;
}

function toGrade(score: number): "A" | "B" | "C" | "D" | "E" | "-" {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  if (score >= 51) return "E";
  return "-";
}

function scoreEducationLevel(value: string | null): number {
  if (!value) return 0;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (/(?:\uBC15\uC0AC|ph\.?d|doctor)/i.test(normalized)) return 40;
  if (/(?:\uC11D\uC0AC|master)/i.test(normalized)) return 30;
  if (
    /(?:\uD559\uC0AC|bachelor|4\s*년제|사년제|4년제|\uB300\uD559(?:\uAD50)?\s*(?:\uC878\uC5C5|\uC7AC\uD559|\uC218\uB8CC)|\uB300\uC878)/i.test(
      normalized
    )
  )
    return 10;
  if (
    /(?:\uC804\uBB38\uB300|\uC804\uBB38\uB300\uD559\uAD50|\uC804\uBB38\uD559\uC0AC|2\s*년제|이년제|\uC804\uBB38\uACFC)/i.test(
      normalized
    )
  )
    return 5;
  if (
    /(?:\uACE0\uB4F1\uD559\uAD50|\uACE0\uC878|\uACE0\uAD50\s*\uC878\uC5C5)/i.test(
      normalized
    )
  )
    return 1;
  if (
    /(?:\uC911\uD559\uAD50|\uC911\uC878|\uCD08\uB4F1\uD559\uAD50|\uCD08\uC878)/i.test(
      normalized
    )
  )
    return 0;
  return 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function findSingle(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const value = text.match(pattern)?.[1]?.trim();
    if (value) return value;
  }
  return null;
}

function collectLines(text: string, keywords: string[]): string[] {
  return text
    .split(/\n+/)
    .map(line => line.trim())
    .filter(
      line => Boolean(line) && keywords.some(keyword => line.includes(keyword))
    );
}

function sanitizeStringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return unique(
    value
      .filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0
      )
      .map(item => item.trim())
  );
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function firstNonEmpty(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function formatDesiredPayment(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return `연 ${value}만원`;
}

export function cleanData(values: string[]): string[] {
  return unique(
    values
      .map(value => value.replace(/\s+/g, " ").trim())
      .filter(value => !containsAmountNoise(value))
      .map(value => value.replace(/^\d+\s*[\.\)]\s*/, "").trim())
      .filter(value => value.length > 1)
      .filter(value => !/^\d+$/.test(value))
      .filter(value => !isMeaninglessNoise(value))
  );
}

function containsAmountNoise(value: string): boolean {
  return /(월급|급여|연봉|수당|만원|원|salary|pay)/i.test(value);
}

function isMeaninglessNoise(value: string): boolean {
  return /^(근무|경력|과거 근무|훈련|교육)$/i.test(value);
}

function isQualification(value: string): boolean {
  return /((?:\d+\s*급)|기사|산업기사|기능사|기술사|관리사|자격증|자격|면허증|면허|전산회계|컴활|워드프로세서|MOS|GTQ|ERP|회계|(?:토익\s*스피킹|토익스피킹)\s*(?:AH|AM|AL|IH|IM1|IM2|IM3)|오픽\s*(?:AL|IH|IM1|IM2|IM3)|토익\s*\d+점|토플\s*\d+점|텝스\s*\d+점|TOEIC(?:\s*Speaking)?\s*(?:\d+|AH|AM|AL|IH|IM1|IM2|IM3)|OPIC\s*(?:AL|IH|IM1|IM2|IM3)|TOEFL\s*\d+|TEPS\s*\d+)/i.test(
    value
  );
}

function isCompanyLike(value: string): boolean {
  return /(\(주\)|주식회사|컴퍼니|엔지니어링|공사|센터|협회|법인|병원|학교|대학|연구소)/.test(
    value
  );
}

function buildExperience(
  values: string[]
): Array<{ company: string | null; task: string | null }> {
  const cleaned = expandAdditionalSpecValues(values).filter(
    value => !isQualificationEntry(value)
  );
  const companyCandidates = cleaned.filter(isCompanyLike);
  const taskCandidates = cleaned.filter(
    value =>
      /(개발|운영|관리|기획|마케팅|설계|분석|지원|상담|제작|유지보수)/.test(
        value
      ) && !isCompanyLike(value)
  );

  const experiences = companyCandidates.map((company, index) => ({
    company,
    task: taskCandidates[index] ?? null,
  }));

  if (experiences.length > 0) {
    return experiences;
  }

  return cleaned
    .filter(value => /(경력|근무|재직|인턴)/.test(value))
    .map(value => ({
      company: isCompanyLike(value) ? value : null,
      task: !isCompanyLike(value) ? value : null,
    }));
}

function buildEducation(values: string[], client: ClientRow): string | null {
  const cleaned = expandAdditionalSpecValues(values).filter(
    value => !isQualificationEntry(value)
  );
  const matched = cleaned.find(value =>
    /(대학교|대학원|학과|졸업|수료)/.test(value)
  );
  if (matched) return matched;

  const schoolParts = [
    client.school,
    client.major,
    client.education_level,
  ].filter(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0
  );

  return schoolParts.length > 0 ? schoolParts.join(" ") : null;
}

function selectHighestEducation(
  values: string[],
  client: ClientRow,
  sourceTexts: string[] = []
): string | null {
  const schoolParts = [client.school, client.major, client.education_level]
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0
    )
    .map(value => value.trim());

  const candidates = [
    ...expandAdditionalSpecValues(values),
    ...extractEducationCandidatesFromSourceTexts(sourceTexts),
    ...schoolParts,
    ...(schoolParts.length > 0 ? [schoolParts.join(" ")] : []),
  ].filter(candidate =>
    /(?:\uBC15\uC0AC|ph\.?d|\uC11D\uC0AC|master|\uB300\uD559\uAD50|\uB300\uD559|\uC804\uBB38\uB300|\uC804\uBB38\uD559\uC0AC|\uACE0\uB4F1\uD559\uAD50|\uACE0\uC878|\uC911\uD559\uAD50|\uC911\uC878|\uD559\uC0AC|\uC878\uC5C5|\uC218\uB8CC|\uD559\uB825|\uB300\uD559\uC6D0)/i.test(
      candidate
    )
  );

  let bestEducation: string | null = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    const score = scoreEducationLevel(candidate);

    if (score > bestScore) {
      bestEducation = candidate;
      bestScore = score;
      continue;
    }

    if (
      score === bestScore &&
      bestEducation &&
      candidate.length > bestEducation.length
    ) {
      bestEducation = candidate;
    }
  }

  return bestEducation;
}

function extractQualificationCandidates(values: string[]): string[] {
  const patterns = [
    /([가-힣A-Za-z0-9]+(?:산업기사|기사|기능사|기술사|관리사))/g,
    /\b(SQLD|ADSP|MOS|GTQ|ERP)\b/gi,
    /(?:컴퓨터활용능력\s*\d급|컴퓨터활용능력|컴활\s*\d급|컴활|워드프로세서)/gi,
  ];

  const matches: string[] = [];

  for (const value of values) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(value)) !== null) {
        const token = (match[1] ?? match[0] ?? "").replace(/\s+/g, " ").trim();
        if (token) matches.push(token.replace(/\(\s*$/, "").trim());
      }
    }
  }

  return unique(matches);
}

function expandAdditionalSpecValues(values: string[]): string[] {
  return cleanData(values.flatMap(splitMixedSpecValueV2));
}

function isQualificationEntry(value: string): boolean {
  return /(?:기사|산업기사|기능사|기술사|관리사|자격증|면허증|면허|정보처리기사|정보통신기사|sqld|adsp|컴퓨터활용능력|컴활|워드프로세서|mos|gtq|erp|전산회계|전산세무|사회복지사|보육교사|간호조무사|직업상담사|유통관리사|한국사능력검정|국가공인|민간자격|toeic(?:\s*speaking)?|토익(?:\s*스피킹|스피킹)?|opic|오픽|toefl|토플|teps|텝스)/i.test(
    value
  );
}

function splitMixedSpecValue(value: string): string[] {
  const normalized = value
    .replace(/\[(?:자격증|어학|학력|경력)\]/gi, "|")
    .replace(/(?:자격증|어학|학력|경력)\s*[:：]/gi, "|")
    .replace(/[•·]/g, "|")
    .replace(/\s\*\s/g, "|")
    .replace(/\s\/\s/g, "|")
    .replace(/\s\|\s/g, "|");

  return normalized
    .split("|")
    .map(part => part.trim())
    .filter(Boolean);
}

function splitMixedSpecValueV2(value: string): string[] {
  const normalized = value
    .replace(/\[(?:자격증|어학|학력|경력)\]/gi, "|")
    .replace(/(?:자격증|어학|학력|경력)\s*[:：]/gi, "|")
    .replace(/[•·]/g, "|")
    .replace(/\*/g, "|")
    .replace(/\s\/\s/g, "|")
    .replace(/\s\|\s/g, "|")
    .replace(/,\s*/g, "|");

  return normalized
    .split("|")
    .map(part => part.trim())
    .filter(Boolean);
}

function extractEducationCandidatesFromSourceTexts(values: string[]): string[] {
  const patterns = [
    /(?:박사|Ph\.?D|doctor)[^\n,.;)]*/gi,
    /(?:석사|master)[^\n,.;)]*/gi,
    /(?:학사|bachelor)[^\n,.;)]*/gi,
    /(?:4\s*년제|사년제|4년제)[^\n,.;)]*/gi,
    /(?:전문대|전문대학교|전문학사|2\s*년제|이년제|전문과)[^\n,.;)]*/gi,
    /(?:고등학교|고졸|고교\s*졸업)[^\n,.;)]*/gi,
    /(?:중학교|중졸|초등학교|초졸)[^\n,.;)]*/gi,
  ];

  const candidates: string[] = [];

  for (const rawText of values) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(rawText)) !== null) {
        const candidate = match[0].replace(/\s+/g, " ").trim();
        if (candidate) candidates.push(candidate);
      }
    }
  }

  return unique(candidates);
}
