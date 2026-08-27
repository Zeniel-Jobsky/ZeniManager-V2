import { describe, expect, it } from "vitest";
import {
  canonicalizeJobFilters,
  filterJobPostings,
  InvalidJobFiltersError,
  matchesEducation,
  matchesExperience,
  matchesRegions,
  serializeJobFilters,
  type CanonicalJobFilters,
  type RegionFilter,
} from "./filters.ts";
import type { JobPostingRecommendation } from "./types.ts";

const EMPTY_FILTERS: CanonicalJobFilters = {
  education: [],
  experience: { types: [], range: null },
  regions: [],
};

describe("job filter request canonicalization", () => {
  it("treats omitted, null, empty, and explicit any values as the same unrestricted search", () => {
    expect(canonicalizeJobFilters(undefined)).toEqual(EMPTY_FILTERS);
    expect(canonicalizeJobFilters(null)).toEqual(EMPTY_FILTERS);
    expect(canonicalizeJobFilters({})).toEqual(EMPTY_FILTERS);
    expect(
      canonicalizeJobFilters({
        education: ["any", "bachelor"],
        experience: {
          types: ["any", "experienced"],
          range: { kind: "minimum-years", years: 7 },
        },
        regions: [
          { code: "any", label: "지역 무관" },
          { code: "seoul", label: "서울특별시" },
        ],
      })
    ).toEqual(EMPTY_FILTERS);
  });

  it("deduplicates and deterministically orders valid values for cache keys", () => {
    const first = canonicalizeJobFilters({
      education: ["master", "high-school", "master"],
      experience: { types: ["experienced", "entry", "entry"], range: null },
      regions: [
        { code: "seoul/gangnam-gu", label: "서울특별시 강남구" },
        { code: "gyeonggi", label: "경기도" },
        { code: "seoul/gangnam-gu", label: "서울특별시 강남구" },
      ],
    });
    const second = canonicalizeJobFilters({
      education: ["high-school", "master"],
      experience: { types: ["entry", "experienced"], range: null },
      regions: [
        { code: "gyeonggi", label: "경기도" },
        { code: "seoul/gangnam-gu", label: "서울특별시 강남구" },
      ],
    });

    expect(first).toEqual(second);
    expect(first).toEqual({
      education: ["high-school", "master"],
      experience: { types: ["entry", "experienced"], range: null },
      regions: [
        { code: "gyeonggi", label: "경기도" },
        { code: "seoul/gangnam-gu", label: "서울특별시 강남구" },
      ],
    });
    expect(serializeJobFilters(first)).toBe(serializeJobFilters(second));
  });

  it.each([
    { education: "bachelor" },
    { education: ["college"] },
    {
      education: [
        "any",
        "high-school",
        "associate",
        "bachelor",
        "master",
        "doctorate",
        "post-doctorate",
        "high-school-or-less",
        "entry",
      ],
    },
    { experience: "entry" },
    { experience: { types: ["intern"], range: null } },
    {
      experience: {
        types: ["entry"],
        range: { kind: "minimum-years", years: 2 },
      },
    },
    {
      experience: {
        types: ["experienced"],
        range: { kind: "minimum-years", years: 0 },
      },
    },
    {
      experience: {
        types: ["experienced"],
        range: { kind: "minimum-years", years: 100 },
      },
    },
    {
      experience: {
        types: ["experienced"],
        range: { kind: "minimum-years", years: 2.5 },
      },
    },
    {
      experience: {
        types: ["experienced"],
        range: { kind: "up-to-one-year", years: 1 },
      },
    },
    { experience: { types: ["experienced"], range: { kind: "unknown" } } },
    { education: [], metadata: true },
    { experience: { types: [], range: null, metadata: true } },
    {
      experience: {
        types: ["experienced"],
        range: { kind: "minimum-years", years: 2, unit: "years" },
      },
    },
  ])(
    "rejects a malformed education or experience filter: $education $experience",
    value => {
      expect(() => canonicalizeJobFilters(value)).toThrow(
        InvalidJobFiltersError
      );
    }
  );

  it("accepts both supported experience range shapes", () => {
    expect(
      canonicalizeJobFilters({
        experience: {
          types: ["experienced"],
          range: { kind: "up-to-one-year" },
        },
      }).experience
    ).toEqual({ types: ["experienced"], range: { kind: "up-to-one-year" } });
    expect(
      canonicalizeJobFilters({
        experience: {
          types: ["experienced"],
          range: { kind: "minimum-years", years: 99 },
        },
      }).experience
    ).toEqual({
      types: ["experienced"],
      range: { kind: "minimum-years", years: 99 },
    });
  });

  it("validates and normalizes province and child region entries", () => {
    expect(
      canonicalizeJobFilters({
        regions: [
          { code: " SEOUL/GANGNAM-GU ", label: "  서울특별시   강남구 " },
          { code: "gangwon", label: "강원특별자치도" },
          { code: "jeonbuk/jeonju-si", label: "전북특별자치도 전주시" },
        ],
      }).regions
    ).toEqual([
      { code: "gangwon", label: "강원특별자치도" },
      { code: "jeonbuk/jeonju-si", label: "전북특별자치도 전주시" },
      { code: "seoul/gangnam-gu", label: "서울특별시 강남구" },
    ]);
  });

  it("canonicalizes region aliases and removes children covered by a selected province", () => {
    expect(
      canonicalizeJobFilters({
        regions: [
          { code: "seoul/mapo-gu", label: "서울시 마포구" },
          { code: "seoul", label: "서울" },
          { code: "jeju/jeju-si", label: "제주도 제주시" },
        ],
      }).regions
    ).toEqual([
      { code: "jeju/jeju-si", label: "제주특별자치도 제주시" },
      { code: "seoul", label: "서울특별시" },
    ]);
  });

  it.each([
    [{ code: "any", label: "전국" }],
    [{ code: "unknown", label: "서울특별시" }],
    [{ code: "seoul/gangnam_gu", label: "서울특별시 강남구" }],
    [{ code: "seoul/gangnam-gu/extra", label: "서울특별시 강남구" }],
    [{ code: "seoul", label: "경기도" }],
    [{ code: "seoul", label: "서울특별시 강남구" }],
    [{ code: "seoul/gangnam-gu", label: "서울특별시" }],
    [{ code: "seoul/gangnam-gu", label: "<서울 강남구>" }],
    [{ code: "seoul/gangnam-gu", label: "서울특별시 강남시" }],
    [{ code: "seoul/gangnam-gu", label: "서울특별시 강남구", metadata: true }],
  ])("rejects an invalid region entry: %j", regions => {
    expect(() => canonicalizeJobFilters({ regions })).toThrow(
      InvalidJobFiltersError
    );
  });

  it("rejects more than ten regions before attempting to scrape", () => {
    const regions = Array.from({ length: 11 }, (_, index) => ({
      code: `seoul/district-${index}`,
      label: `서울특별시 테스트구${index}`,
    }));
    expect(() => canonicalizeJobFilters({ regions })).toThrow(
      "지역은 최대 10개"
    );
  });
});

describe("education matching", () => {
  it("does not restrict results when no education is selected", () => {
    expect(matchesEducation(null, [])).toBe(true);
    expect(matchesEducation("알 수 없음", [])).toBe(true);
  });

  it("excludes education-unrestricted postings when a concrete level is selected", () => {
    expect(matchesEducation("학력 무관", ["bachelor"])).toBe(false);
    expect(matchesEducation("학력제한없음", ["doctorate"])).toBe(false);
    expect(matchesEducation("학력 무관", [])).toBe(true);
  });

  it.each([
    ["고졸 이하", "high-school-or-less"],
    ["고등학교 졸업", "high-school"],
    ["초대졸↑", "associate"],
    ["대졸(4년제)↑", "bachelor"],
    ["대학원졸 이상", "master"],
    ["석사 졸업", "master"],
    ["박사 졸업", "doctorate"],
    ["박사 졸업 이상", "post-doctorate"],
    ["포스트닥", "post-doctorate"],
  ] as const)("classifies %s as %s", (text, level) => {
    expect(matchesEducation(text, [level])).toBe(true);
  });

  it("strictly excludes unknown or non-selected education values", () => {
    expect(matchesEducation(null, ["bachelor"])).toBe(false);
    expect(matchesEducation("면접 후 결정", ["bachelor"])).toBe(false);
    expect(matchesEducation("무관", ["bachelor"])).toBe(false);
    expect(matchesEducation("고졸", ["bachelor"])).toBe(false);
    expect(matchesEducation("초대졸↑", ["bachelor"])).toBe(false);
  });

  it("recognizes each explicit level in a composite education label", () => {
    expect(matchesEducation("대졸 / 석사", ["bachelor"])).toBe(true);
    expect(matchesEducation("대졸 / 석사", ["master"])).toBe(true);
    expect(matchesEducation("석사 / 박사", ["doctorate"])).toBe(true);
  });
});

describe("experience and minimum-year matching", () => {
  it("does not restrict results when no experience type is selected", () => {
    expect(matchesExperience(null, [], null)).toBe(true);
  });

  it("excludes career-unrestricted postings when a concrete type or range is selected", () => {
    expect(matchesExperience("경력 무관", ["entry"], null)).toBe(false);
    expect(
      matchesExperience("경력무관", ["experienced"], {
        kind: "minimum-years",
        years: 20,
      })
    ).toBe(false);
    expect(matchesExperience("경력 무관", [], null)).toBe(true);
    expect(matchesExperience("무관", ["entry"], null)).toBe(false);
  });

  it("matches entry, experienced, and mixed posting labels by selected type", () => {
    expect(matchesExperience("신입", ["entry"], null)).toBe(true);
    expect(matchesExperience("신입", ["experienced"], null)).toBe(false);
    expect(matchesExperience("경력 3년↑", ["experienced"], null)).toBe(true);
    expect(matchesExperience("신입·경력", ["entry"], null)).toBe(true);
    expect(matchesExperience("신입/경력(1년↑)", ["experienced"], null)).toBe(
      true
    );
    expect(matchesExperience("3↑", ["experienced"], null)).toBe(true);
    expect(matchesExperience("2~4년", ["experienced"], null)).toBe(true);
  });

  it("applies a year range only to the experienced branch of a multi-selection", () => {
    const selected = ["entry", "experienced"] as const;
    expect(
      matchesExperience("신입", [...selected], {
        kind: "minimum-years",
        years: 5,
      })
    ).toBe(true);
    expect(
      matchesExperience("경력 3년↑", [...selected], {
        kind: "minimum-years",
        years: 5,
      })
    ).toBe(false);
    expect(
      matchesExperience("신입·경력 1년↑", [...selected], {
        kind: "minimum-years",
        years: 5,
      })
    ).toBe(true);
  });

  it("matches one year or less using the parsed minimum requirement", () => {
    expect(
      matchesExperience("경력 1년 이하", ["experienced"], {
        kind: "up-to-one-year",
      })
    ).toBe(true);
    expect(
      matchesExperience("경력1년↑", ["experienced"], { kind: "up-to-one-year" })
    ).toBe(false);
    expect(
      matchesExperience("경력2년↑", ["experienced"], { kind: "up-to-one-year" })
    ).toBe(false);
    expect(
      matchesExperience("경력 5년 이하", ["experienced"], {
        kind: "up-to-one-year",
      })
    ).toBe(false);
    expect(
      matchesExperience("경력 2~5년", ["experienced"], {
        kind: "up-to-one-year",
      })
    ).toBe(false);
    expect(
      matchesExperience("경력 0~1년", ["experienced"], {
        kind: "up-to-one-year",
      })
    ).toBe(true);
    expect(
      matchesExperience("경력 8개월", ["experienced"], {
        kind: "up-to-one-year",
      })
    ).toBe(true);
  });

  it("matches minimum-years against the posting minimum requirement", () => {
    const range = { kind: "minimum-years", years: 3 } as const;
    expect(matchesExperience("경력 5년 이상", ["experienced"], range)).toBe(
      true
    );
    expect(matchesExperience("경력 3~7년", ["experienced"], range)).toBe(true);
    expect(matchesExperience("경력 2~5년", ["experienced"], range)).toBe(false);
    expect(matchesExperience("경력 5년 이하", ["experienced"], range)).toBe(
      false
    );
    expect(matchesExperience("경력 5년 미만", ["experienced"], range)).toBe(
      false
    );
    expect(matchesExperience("2~5년", ["experienced"], range)).toBe(false);
    expect(matchesExperience("3↑", ["experienced"], range)).toBe(true);
  });

  it("keeps the entry branch of a mixed posting independent from its experienced range", () => {
    const range = { kind: "minimum-years", years: 10 } as const;
    expect(
      matchesExperience("신입·경력 2~5년", ["entry", "experienced"], range)
    ).toBe(true);
    expect(matchesExperience("신입·경력 2~5년", ["experienced"], range)).toBe(
      false
    );
  });

  it("excludes an unknown year only while a year range is active", () => {
    expect(matchesExperience("경력", ["experienced"], null)).toBe(true);
    expect(
      matchesExperience("경력", ["experienced"], { kind: "up-to-one-year" })
    ).toBe(false);
    expect(matchesExperience(null, ["experienced"], null)).toBe(false);
  });
});

describe("Korean region matching", () => {
  const region = (code: string, label: string): RegionFilter => ({
    code,
    label,
  });

  it.each([
    ["seoul", "서울특별시", "서울시 종로구"],
    ["busan", "부산광역시", "부산시 해운대구"],
    ["daegu", "대구광역시", "대구시 수성구"],
    ["incheon", "인천광역시", "인천시 연수구"],
    ["gwangju", "광주광역시", "광주 북구"],
    ["daejeon", "대전광역시", "대전시 유성구"],
    ["ulsan", "울산광역시", "울산시 남구"],
    ["sejong", "세종특별자치시", "세종시"],
    ["gyeonggi", "경기도", "경기 수원시"],
    ["gangwon", "강원특별자치도", "강원도 춘천시"],
    ["chungbuk", "충청북도", "충북 청주시"],
    ["chungnam", "충청남도", "충남 천안시"],
    ["jeonbuk", "전북특별자치도", "전라북도 전주시"],
    ["jeonnam", "전라남도", "전남 목포시"],
    ["gyeongbuk", "경상북도", "경북 포항시"],
    ["gyeongnam", "경상남도", "경남 창원시"],
    ["jeju", "제주특별자치도", "제주도 제주시"],
  ])("normalizes the %s province aliases", (code, label, location) => {
    expect(matchesRegions(location, [region(code, label)])).toBe(true);
  });

  it("does not restrict results when no region is selected", () => {
    expect(matchesRegions(null, [])).toBe(true);
  });

  it("matches a province across full and abbreviated portal labels", () => {
    const seoul = [region("seoul", "서울특별시")];
    const gangwon = [region("gangwon", "강원특별자치도")];
    expect(matchesRegions("서울 강남구", seoul)).toBe(true);
    expect(matchesRegions("서울특별시 마포구", seoul)).toBe(true);
    expect(matchesRegions("서울전체 , 강서구 , 마포구", seoul)).toBe(true);
    expect(matchesRegions("서울 전지역", seoul)).toBe(true);
    expect(matchesRegions("강원도 춘천시", gangwon)).toBe(true);
    expect(matchesRegions("서울시 송파구", seoul)).toBe(true);
    expect(matchesRegions("경기 성남시", seoul)).toBe(false);
  });

  it("matches a child only when the normalized full label occurs", () => {
    const gangnam = [region("seoul/gangnam-gu", "서울특별시 강남구")];
    expect(matchesRegions("서울 > 강남구 외", gangnam)).toBe(true);
    expect(matchesRegions("서울전체 , 강남구 , 마포구", gangnam)).toBe(true);
    expect(matchesRegions("서울 마포구", gangnam)).toBe(false);
    expect(matchesRegions("부산 강남구", gangnam)).toBe(false);
  });

  it("carries a province over comma-separated child regions without mixing provinces", () => {
    const mapo = [region("seoul/mapo-gu", "서울특별시 마포구")];
    const seongnam = [region("gyeonggi/seongnam-si", "경기도 성남시")];
    const gyeonggiGwangju = [region("gyeonggi/gwangju-si", "경기도 광주시")];
    expect(matchesRegions("서울전체, 강서구, 마포구 외", mapo)).toBe(true);
    expect(matchesRegions("서울 강남구, 경기 성남시", seongnam)).toBe(true);
    expect(matchesRegions("서울 성남시, 경기 수원시", seongnam)).toBe(false);
    expect(matchesRegions("경기전체, 광주시, 수원시", gyeonggiGwangju)).toBe(
      true
    );
    expect(
      matchesRegions("경기 광주시", [region("gwangju", "광주광역시")])
    ).toBe(false);
  });

  it("normalizes old and abbreviated province names for child matching", () => {
    expect(
      matchesRegions("전라북도 전주시 외", [
        region("jeonbuk/jeonju-si", "전북특별자치도 전주시"),
      ])
    ).toBe(true);
    expect(
      matchesRegions("제주도 제주시", [
        region("jeju/jeju-si", "제주특별자치도 제주시"),
      ])
    ).toBe(true);
  });

  it("uses OR semantics for multiple concrete regions and excludes nationwide postings", () => {
    const selected = [
      region("seoul/gangnam-gu", "서울특별시 강남구"),
      region("gyeonggi/suwon-si", "경기도 수원시"),
    ];
    expect(matchesRegions("경기 수원시 영통구", selected)).toBe(true);
    expect(matchesRegions("전국", selected)).toBe(false);
    expect(matchesRegions("전지역", selected)).toBe(false);
    expect(matchesRegions("지역무관", selected)).toBe(false);
    expect(matchesRegions(null, selected)).toBe(false);
    expect(matchesRegions("전국", [])).toBe(true);
  });
});

describe("combined posting filtering", () => {
  it("applies education, experience, and region with AND semantics", () => {
    const postings = [
      makePosting("1", {
        education: "대졸↑",
        experience: "경력 3년↑",
        location: "서울 강남구",
      }),
      makePosting("2", {
        education: "고졸",
        experience: "경력 3년↑",
        location: "서울 강남구",
      }),
      makePosting("3", {
        education: "대졸↑",
        experience: "신입",
        location: "서울 강남구",
      }),
      makePosting("4", {
        education: "대졸↑",
        experience: "경력 3년↑",
        location: "경기 수원시",
      }),
      makePosting("5", {
        education: "학력 무관",
        experience: "경력 3년↑",
        location: "서울 강남구",
      }),
      makePosting("6", {
        education: "대졸↑",
        experience: "경력 무관",
        location: "서울 강남구",
      }),
      makePosting("7", {
        education: "대졸↑",
        experience: "경력 3년↑",
        location: "전국",
      }),
    ];
    const filters = canonicalizeJobFilters({
      education: ["bachelor"],
      experience: {
        types: ["experienced"],
        range: { kind: "minimum-years", years: 3 },
      },
      regions: [{ code: "seoul/gangnam-gu", label: "서울특별시 강남구" }],
    });

    expect(
      filterJobPostings(postings, filters).map(posting => posting.sourceId)
    ).toEqual(["1"]);
  });
});

function makePosting(
  sourceId: string,
  fields: Pick<
    JobPostingRecommendation,
    "education" | "experience" | "location"
  >
): JobPostingRecommendation {
  return {
    id: `saramin:${sourceId}`,
    source: "saramin",
    sourceLabel: "사람인",
    sourceId,
    url: `https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=${sourceId}`,
    title: "개발자",
    company: "테스트 회사",
    employmentType: "정규직",
    postedAt: null,
    deadline: "2026-09-30",
    deadlineAt: "2026-09-30T15:00:00.000Z",
    deadlineLabel: "D-30",
    deadlineKind: "date",
    matchedDesiredJob: "개발자",
    links: [
      {
        source: "saramin",
        sourceLabel: "사람인",
        url: `https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=${sourceId}`,
      },
    ],
    ...fields,
  };
}
