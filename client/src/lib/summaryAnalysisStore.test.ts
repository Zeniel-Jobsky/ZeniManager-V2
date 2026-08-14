import { describe, expect, it } from "vitest";
import {
  hasDifferentCompetencyScoring,
  normalizeStoredSummaryAnalysis,
  type StoredSummaryAnalysis,
} from "./summaryAnalysisStore";

describe("summaryAnalysisStore normalization", () => {
  it("recomputes stale saved competency scoring from structured_json", () => {
    const saved = {
      client_id: 30,
      structured_json: {
        clientId: "30",
        desiredJobs: ["개발자"],
        qualifications: ["정보처리기사", "정보통신기사"],
        certifications: ["정보처리기사", "정보통신기사"],
        languageScores: ["OPIc: IH"],
        languageScoreDetails: [
          {
            raw: "OPIc: IH",
            type: "OPIc",
            score: "IH",
          },
        ],
        experience: [],
        education: "4년제 대졸",
        additionalSpecs: {
          careerHistory: [],
          completedEducation: [],
        },
        memoInsights: {
          preferredSchedule: null,
          preferredSalary: null,
          preferredLocation: null,
          jobBarriers: [],
          hiddenStrengths: [],
        },
        sourceSummary: "",
      },
      competency_scoring: {
        score: 78,
        grade: "C",
        finalGrade: "C",
        breakdown: [
          { label: "기본 점수", score: 50, reason: "모든 사용자의 시작 점수" },
          { label: "4년제 대졸", score: 0, reason: "최종 학력 1개 반영 점수" },
          { label: "정보처리기사", score: 10, reason: "자격증 절대 기준 점수" },
          { label: "정보통신기사", score: 10, reason: "자격증 절대 기준 점수" },
          { label: "OPIc: IH", score: 8, reason: "어학 점수 절대 기준 점수" },
        ],
      },
      recommendation: {
        recommendedJobs: [],
        industries: [],
        reasons: [],
        requiredCapabilities: [],
      },
      prompt_snapshot: {},
      file_refs: [],
      updated_at: "2026-03-30T08:48:35.322+00:00",
    } satisfies StoredSummaryAnalysis;

    const normalized = normalizeStoredSummaryAnalysis(saved);

    expect(normalized.competency_scoring.score).toBe(88);
    expect(normalized.competency_scoring.grade).toBe("B");
    expect(
      hasDifferentCompetencyScoring(
        saved.competency_scoring,
        normalized.competency_scoring
      )
    ).toBe(true);
  });
});
