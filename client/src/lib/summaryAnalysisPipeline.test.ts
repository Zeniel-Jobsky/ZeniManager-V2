import { describe, expect, it } from "vitest";
import type { ClientRow } from "./supabase";
import type { MergedDocumentProfile } from "./summaryAnalysis";
import {
  buildStructuredSummaryJson,
  calculateCompetencyScoring,
} from "./summaryAnalysisPipeline";

describe("summaryAnalysisPipeline scoring", () => {
  it("keeps only the single highest language score across all language tests", () => {
    const result = calculateCompetencyScoring({
      clientId: "30",
      desiredJobs: [],
      qualifications: [],
      certifications: [],
      languageScores: [
        "TOEIC: 900",
        "TOEIC Speaking: AH",
        "OPIc: IH",
        "TOEIC: 700",
      ],
      languageScoreDetails: [],
      experience: [],
      education: null,
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
    });

    expect(result.score).toBe(60);
    expect(result.grade).toBe("D");
  });

  it("uses only the highest education when multiple education strings exist", () => {
    const client = {
      id: "30",
      memo: null,
      school: "한국대학교",
      major: "경영학과",
      education_level: "고등학교 졸업",
    } as unknown as ClientRow;

    const profile = {
      aiSummary: "요약",
      desiredJobs: [],
      certifications: [],
      extraSpecs: [
        "고등학교 졸업",
        "석사 과정",
        "직업훈련 수료",
      ],
      gender: null,
      reliability: "high",
      keywordTags: [],
      sourceHash: "hash",
      fileCount: 1,
      sourceTexts: [],
    } as MergedDocumentProfile;

    const json = buildStructuredSummaryJson(client, profile);
    const result = calculateCompetencyScoring(json);

    expect(json.education).toContain("석사");
    expect(result.score).toBe(80);
    expect(result.grade).toBe("B");
  });

  it("scores 4-year college graduation strings correctly", () => {
    const result = calculateCompetencyScoring({
      clientId: "30",
      desiredJobs: ["개발자"],
      qualifications: ["정보처리기사", "정보통신기사"],
      certifications: ["정보처리기사", "정보통신기사"],
      languageScores: ["OPIc: IH"],
      languageScoreDetails: [],
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
    });

    expect(result.score).toBe(88);
    expect(result.grade).toBe("B");
  });
  it("scores SQLD as a 5-point national certificate", () => {
    const result = calculateCompetencyScoring({
      clientId: "30",
      desiredJobs: [],
      qualifications: ["SQLD"],
      certifications: ["SQLD"],
      languageScores: [],
      languageScoreDetails: [],
      experience: [],
      education: null,
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
    });

    expect(result.score).toBe(55);
    expect(result.grade).toBe("E");
  });
});
