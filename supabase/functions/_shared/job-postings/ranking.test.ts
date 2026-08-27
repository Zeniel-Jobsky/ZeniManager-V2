import { describe, expect, it } from "vitest";
import { canonicalizeJobFilters, type CanonicalJobFilters } from "./filters.ts";
import { calculateDesiredJobRelevance, rankJobPostings } from "./ranking.ts";
import type { JobPostingRecommendation, JobSource } from "./types.ts";

const EMPTY_FILTERS: CanonicalJobFilters = {
  education: [],
  experience: { types: [], range: null },
  regions: [],
};

describe("desired-job relevance scoring", () => {
  it("puts an exact normalized title above a phrase inclusion and partial token match", () => {
    const desiredJobs = ["백엔드 개발자"];
    expect(
      calculateDesiredJobRelevance("백엔드 개발자 채용", desiredJobs)
    ).toBe(10_000);
    expect(
      calculateDesiredJobRelevance("플랫폼 백엔드 개발자", desiredJobs)
    ).toBeGreaterThan(
      calculateDesiredJobRelevance("백엔드 엔지니어 및 개발 담당", desiredJobs)
    );
  });

  it("does not mistake merely being returned by a search for title relevance", () => {
    expect(
      calculateDesiredJobRelevance("총무 사원 모집", ["백엔드 개발자"])
    ).toBe(0);
    expect(
      calculateDesiredJobRelevance("백엔드 엔지니어", ["백엔드 개발자"])
    ).toBeGreaterThan(0);
  });
});

describe("posting ranking", () => {
  it("orders exact title, partial title, then an unrelated searched result", () => {
    const postings = [
      makePosting("unrelated", {
        title: "총무 사원 모집",
        matchedDesiredJob: "백엔드 개발자",
      }),
      makePosting("partial", {
        title: "백엔드 엔지니어",
        matchedDesiredJob: "백엔드 개발자",
      }),
      makePosting("exact", {
        title: "백엔드 개발자 채용",
        matchedDesiredJob: "백엔드 개발자",
      }),
    ];

    expect(
      rankJobPostings(postings, ["백엔드 개발자"], EMPTY_FILTERS).map(
        item => item.sourceId
      )
    ).toEqual(["exact", "partial", "unrelated"]);
  });

  it("uses the posting matchedDesiredJob as an auxiliary score for equal best-title relevance", () => {
    const postings = [
      makePosting("incidental", {
        title: "웹 개발자",
        matchedDesiredJob: "데이터 분석가",
      }),
      makePosting("own-query", {
        title: "웹 개발자",
        matchedDesiredJob: "웹 개발자",
      }),
    ];

    expect(
      rankJobPostings(
        postings,
        ["웹 개발자", "데이터 분석가"],
        EMPTY_FILTERS
      ).map(item => item.sourceId)
    ).toEqual(["own-query", "incidental"]);
  });

  it("uses a concrete child-region match as a filter-specificity tie-break", () => {
    const filters = canonicalizeJobFilters({
      education: ["bachelor"],
      experience: {
        types: ["experienced"],
        range: { kind: "minimum-years", years: 3 },
      },
      regions: [
        { code: "gyeonggi", label: "경기도" },
        { code: "seoul/gangnam-gu", label: "서울특별시 강남구" },
      ],
    });
    const postings = [
      makePosting("province", {
        title: "백엔드 개발자",
        education: "대졸",
        experience: "경력 7년 이상",
        location: "경기 수원시",
      }),
      makePosting("child", {
        title: "백엔드 개발자",
        education: "대졸",
        experience: "경력 3년 이상",
        location: "서울 강남구",
      }),
    ];

    expect(
      rankJobPostings(postings, ["백엔드 개발자"], filters).map(
        item => item.sourceId
      )
    ).toEqual(["child", "province"]);
  });

  it("does not mutate input and applies deterministic date/source/id tie-breaks", () => {
    const postings = [
      makePosting("b", { source: "saramin", postedAt: "2026-08-20" }),
      makePosting("c", { source: "incruit", postedAt: "2026-08-21" }),
      makePosting("a", { source: "jobkorea", postedAt: "2026-08-20" }),
    ];
    const originalOrder = postings.map(item => item.sourceId);
    const first = rankJobPostings(
      postings,
      ["백엔드 개발자"],
      EMPTY_FILTERS
    ).map(item => item.sourceId);
    const second = rankJobPostings(
      [...postings].reverse(),
      ["백엔드 개발자"],
      EMPTY_FILTERS
    ).map(item => item.sourceId);

    expect(postings.map(item => item.sourceId)).toEqual(originalOrder);
    expect(first).toEqual(["c", "a", "b"]);
    expect(second).toEqual(first);
  });
});

function makePosting(
  sourceId: string,
  overrides: Partial<JobPostingRecommendation> & { source?: JobSource } = {}
): JobPostingRecommendation {
  const source = overrides.source ?? "saramin";
  return {
    id: `${source}:${sourceId}`,
    source,
    sourceLabel: source,
    sourceId,
    url: `https://example.test/${source}/${sourceId}`,
    title: "백엔드 개발자",
    company: "테스트 회사",
    location: "서울 강남구",
    employmentType: "정규직",
    experience: "경력 3년 이상",
    education: "대졸",
    postedAt: null,
    deadline: "2026-09-30",
    deadlineAt: "2026-09-30T15:00:00.000Z",
    deadlineLabel: "D-30",
    deadlineKind: "date",
    matchedDesiredJob: "백엔드 개발자",
    links: [],
    ...overrides,
  };
}
