import { describe, it, expect } from "vitest";
import {
  buildSources,
  sourceHash,
  validateAnalysis,
  redact,
  type Source,
} from "./counseling-analysis";
const client = {
  id: "private-id",
  name: "홍길동",
  phone: "010-1234-5678",
  address: "secret address",
  desired_job: "회계",
  counsel_notes: "홍길동 연락처 010-1234-5678",
};
const sessions = [
  { id: "s2", date: "2026-10-02", type: "심층상담", content: "면접 준비" },
  { id: "s1", date: "2026-09-01", type: "초기상담", content: "희망직종 확인" },
];
const surveys = [
  {
    id: "q1",
    survey_date: "2026-09-01",
    q1_job_goal: 3,
    q7_barrier: 2,
    total_score: 20,
  },
];
const sources = buildSources(client, sessions, surveys, null);
const valid = {
  summary: { text: "회계 직종으로 구직 중", sources: ["profile"] },
  strengths: [],
  barriers: [],
  progress: [{ text: "면접 준비를 시작함", sources: ["session:s2"] }],
  nextActions: [],
  missingInformation: [],
};
describe("counseling analysis data contract", () => {
  it("uses chronological sessions and item-level survey responses, not total scores", () => {
    expect(sources.map(s => s.ref)).toEqual([
      "profile",
      "session:s1",
      "session:s2",
      "survey:q1",
    ]);
    expect(JSON.stringify(sources)).not.toContain("total_score");
  });
  it("minimizes profile fields and redacts identifiers in free text", () => {
    const text = JSON.stringify(sources);
    for (const value of [
      "홍길동",
      "010-1234-5678",
      "secret address",
      "private-id",
    ])
      expect(text).not.toContain(value);
    expect(redact("991212-1234567 a@test.com")).toBe("[주민번호] [이메일]");
  });
  it("hash stays stable on row order but changes on edited/deleted history, survey, model or document", async () => {
    const hash = await sourceHash(sources, "m1");
    expect(
      await sourceHash(
        buildSources(client, [...sessions].reverse(), surveys, null),
        "m1"
      )
    ).toBe(hash);
    for (const next of [
      buildSources(client, sessions.slice(1), surveys, null),
      buildSources(client, sessions, [{ ...surveys[0], q1_job_goal: 1 }], null),
      buildSources(client, sessions, surveys, { certifications: ["전산회계"] }),
      buildSources(
        { ...client, counsel_notes: "내용 수정" },
        sessions,
        surveys,
        null
      ),
    ])
      expect(await sourceHash(next, "m1")).not.toBe(hash);
    expect(await sourceHash(sources, "m2")).not.toBe(hash);
  });
  it("accepts grounded structured responses", () =>
    expect(validateAnalysis(valid, sources)).toEqual(valid));
  it("rejects fabricated evidence IDs", () =>
    expect(() =>
      validateAnalysis(
        { ...valid, summary: { text: "test", sources: ["session:missing"] } },
        sources
      )
    ).toThrow());
  it("rejects ungrounded or malformed output instead of generating a canned fallback", () => {
    for (const value of [
      { ...valid, summary: { text: "test", sources: [] } },
      { ...valid, barriers: "bad" },
      null,
    ])
      expect(() => validateAnalysis(value, sources)).toThrow();
  });
  it("does not mutate source rows", () => {
    expect(client.counsel_notes).toContain("홍길동");
    expect(sessions[0].id).toBe("s2");
  });
});
