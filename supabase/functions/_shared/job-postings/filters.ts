import type { JobPostingRecommendation } from "./types.ts";

export const EDUCATION_FILTER_IDS = [
  "any",
  "high-school-or-less",
  "high-school",
  "associate",
  "bachelor",
  "master",
  "doctorate",
  "post-doctorate",
] as const;

export const EXPERIENCE_FILTER_IDS = ["any", "entry", "experienced"] as const;

export type EducationFilterId = (typeof EDUCATION_FILTER_IDS)[number];
export type ExperienceFilterId = (typeof EXPERIENCE_FILTER_IDS)[number];

export type ExperienceRangeFilter =
  | { kind: "up-to-one-year" }
  | { kind: "minimum-years"; years: number };

export interface RegionFilter {
  code: string;
  label: string;
}

export interface CanonicalJobFilters {
  /** An empty list means no education restriction. */
  education: Exclude<EducationFilterId, "any">[];
  experience: {
    /** An empty list means no experience restriction. */
    types: Exclude<ExperienceFilterId, "any">[];
    range: ExperienceRangeFilter | null;
  };
  /** An empty list means no region restriction. */
  regions: RegionFilter[];
}

const EDUCATION_FILTER_SET = new Set<string>(EDUCATION_FILTER_IDS);
const EXPERIENCE_FILTER_SET = new Set<string>(EXPERIENCE_FILTER_IDS);
const MAX_REGIONS = 10;
const MAX_REGION_CODE_LENGTH = 80;
const MAX_REGION_LABEL_LENGTH = 80;
const MIN_EXPERIENCE_YEARS = 1;
const MAX_EXPERIENCE_YEARS = 99;
const SAFE_LOCAL_CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_REGION_LABEL_PATTERN = /^[가-힣0-9A-Za-z\s().·-]+$/;
const TOP_LEVEL_FILTER_FIELDS = new Set(["education", "experience", "regions"]);
const EXPERIENCE_FIELDS = new Set(["types", "range"]);
const EXPERIENCE_RANGE_FIELDS = new Set(["kind", "years"]);
const REGION_FIELDS = new Set(["code", "label"]);

const PROVINCES = {
  seoul: {
    label: "서울특별시",
    short: "서울",
    aliases: ["서울특별시", "서울시", "서울"],
  },
  busan: {
    label: "부산광역시",
    short: "부산",
    aliases: ["부산광역시", "부산시", "부산"],
  },
  daegu: {
    label: "대구광역시",
    short: "대구",
    aliases: ["대구광역시", "대구시", "대구"],
  },
  incheon: {
    label: "인천광역시",
    short: "인천",
    aliases: ["인천광역시", "인천시", "인천"],
  },
  gwangju: {
    label: "광주광역시",
    short: "광주",
    aliases: ["광주광역시", "광주"],
  },
  daejeon: {
    label: "대전광역시",
    short: "대전",
    aliases: ["대전광역시", "대전시", "대전"],
  },
  ulsan: {
    label: "울산광역시",
    short: "울산",
    aliases: ["울산광역시", "울산시", "울산"],
  },
  sejong: {
    label: "세종특별자치시",
    short: "세종",
    aliases: ["세종특별자치시", "세종시", "세종"],
  },
  gyeonggi: { label: "경기도", short: "경기", aliases: ["경기도", "경기"] },
  gangwon: {
    label: "강원특별자치도",
    short: "강원",
    aliases: ["강원특별자치도", "강원도", "강원"],
  },
  chungbuk: { label: "충청북도", short: "충북", aliases: ["충청북도", "충북"] },
  chungnam: { label: "충청남도", short: "충남", aliases: ["충청남도", "충남"] },
  jeonbuk: {
    label: "전북특별자치도",
    short: "전북",
    aliases: ["전북특별자치도", "전라북도", "전북"],
  },
  jeonnam: { label: "전라남도", short: "전남", aliases: ["전라남도", "전남"] },
  gyeongbuk: {
    label: "경상북도",
    short: "경북",
    aliases: ["경상북도", "경북"],
  },
  gyeongnam: {
    label: "경상남도",
    short: "경남",
    aliases: ["경상남도", "경남"],
  },
  jeju: {
    label: "제주특별자치도",
    short: "제주",
    aliases: ["제주특별자치도", "제주도", "제주"],
  },
} as const;

type ProvinceCode = keyof typeof PROVINCES;

const PROVINCE_CODES = new Set<string>(Object.keys(PROVINCES));
const EDUCATION_ORDER = new Map<string, number>(
  EDUCATION_FILTER_IDS.map((value, index) => [value, index])
);
const EXPERIENCE_ORDER = new Map<string, number>(
  EXPERIENCE_FILTER_IDS.map((value, index) => [value, index])
);

export class InvalidJobFiltersError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidJobFiltersError";
  }
}

/**
 * Validates untrusted JSON and returns one deterministic representation.
 * Explicit `any` values and omitted/empty values intentionally normalize to
 * the same unrestricted representation so semantically identical searches
 * share cache and refresh-cooldown entries.
 */
export function canonicalizeJobFilters(value: unknown): CanonicalJobFilters {
  if (value == null) return emptyJobFilters();
  const input = requireRecord(value, "검색 조건");
  rejectUnknownFields(input, TOP_LEVEL_FILTER_FIELDS, "검색 조건");

  const education = canonicalizeEducation(input.education);
  const experience = canonicalizeExperience(input.experience);
  const regions = canonicalizeRegions(input.regions);

  return { education, experience, regions };
}

export function serializeJobFilters(filters: CanonicalJobFilters): string {
  return JSON.stringify(filters);
}

export function filterJobPostings(
  postings: JobPostingRecommendation[],
  filters: CanonicalJobFilters
): JobPostingRecommendation[] {
  return postings.filter(
    posting =>
      matchesEducation(posting.education, filters.education) &&
      matchesExperience(
        posting.experience,
        filters.experience.types,
        filters.experience.range
      ) &&
      matchesRegions(posting.location, filters.regions)
  );
}

export function matchesEducation(
  educationText: string | null,
  selected: CanonicalJobFilters["education"]
): boolean {
  if (selected.length === 0) return true;
  const classification = classifyEducation(educationText);
  // An explicit selection asks for a concrete requirement. A portal's
  // "학력 무관" is broader than that selection and must not leak into the
  // strict result set.
  if (classification.unrestricted) return false;
  return selected.some(value => classification.levels.has(value));
}

export function matchesExperience(
  experienceText: string | null,
  selectedTypes: CanonicalJobFilters["experience"]["types"],
  range: ExperienceRangeFilter | null
): boolean {
  if (selectedTypes.length === 0) return true;

  const classification = classifyExperience(experienceText);
  // As with education, "경력 무관" is only eligible when the request itself
  // is unrestricted (represented by an empty canonical selection).
  if (classification.unrestricted) return false;
  if (selectedTypes.includes("entry") && classification.types.has("entry"))
    return true;
  if (
    !selectedTypes.includes("experienced") ||
    !classification.types.has("experienced")
  )
    return false;
  if (!range) return true;
  if (classification.minimumYears == null) return false;

  if (range.kind === "up-to-one-year") {
    // This is an exact upper-range filter. A lower-bounded requirement such as
    // "1년 이상" points in the opposite direction and is not a match.
    return (
      classification.maximumYears != null && classification.maximumYears <= 1
    );
  }
  return classification.minimumYears >= range.years;
}

export function matchesRegions(
  locationText: string | null,
  selected: CanonicalJobFilters["regions"]
): boolean {
  if (selected.length === 0) return true;
  if (!locationText) return false;

  const compactLocation = compactRegionText(locationText);
  if (!compactLocation) return false;
  // Nationwide/unspecified locations are deliberately excluded once the user
  // has chosen a concrete region.
  if (isUnrestrictedRegionText(compactLocation)) return false;

  const locationParts = parseLocationParts(locationText);

  return selected.some(region => {
    const [provinceCode] = region.code.split("/");
    const typedProvinceCode = provinceCode as ProvinceCode;
    const province = PROVINCES[typedProvinceCode];
    if (!province) return false;

    if (!region.code.includes("/")) {
      return locationParts.some(
        part => part.provinceCode === typedProvinceCode
      );
    }

    const localName = getLocalRegionName(region.label, province);
    if (!localName) return false;
    return locationParts.some(
      part =>
        part.provinceCode === typedProvinceCode &&
        part.localText.includes(localName)
    );
  });
}

/**
 * Returns a secondary ranking score for postings which already passed the
 * strict filter. The desired-job/title score remains the primary ordering;
 * this score only distinguishes how concrete a multi-option filter match is.
 */
export function getFilterMatchSpecificity(
  posting: Pick<
    JobPostingRecommendation,
    "education" | "experience" | "location"
  >,
  filters: CanonicalJobFilters
): number {
  let score = 0;

  if (filters.education.length > 0) {
    const classification = classifyEducation(posting.education);
    const matchedLevels = filters.education.filter(level =>
      classification.levels.has(level)
    );
    if (!classification.unrestricted && matchedLevels.length > 0) {
      score += 30 + Math.min(matchedLevels.length, 2);
    }
  }

  if (filters.experience.types.length > 0) {
    const classification = classifyExperience(posting.experience);
    const matchedTypes = filters.experience.types.filter(type =>
      classification.types.has(type)
    );
    if (!classification.unrestricted && matchedTypes.length > 0) {
      score += 20 + matchedTypes.length * 2;
      if (filters.experience.range && classification.minimumYears != null) {
        const targetYears =
          filters.experience.range.kind === "up-to-one-year"
            ? 1
            : filters.experience.range.years;
        score += Math.max(
          1,
          10 - Math.abs(classification.minimumYears - targetYears)
        );
      }
    }
  }

  if (filters.regions.length > 0) {
    score += getRegionMatchSpecificity(posting.location, filters.regions);
  }

  return score;
}

function getRegionMatchSpecificity(
  locationText: string | null,
  selected: CanonicalJobFilters["regions"]
): number {
  if (!locationText) return 0;
  const compactLocation = compactRegionText(locationText);
  if (!compactLocation || isUnrestrictedRegionText(compactLocation)) return 0;

  const locationParts = parseLocationParts(locationText);
  let best = 0;
  for (const region of selected) {
    const [provinceCode] = region.code.split("/");
    const typedProvinceCode = provinceCode as ProvinceCode;
    const province = PROVINCES[typedProvinceCode];
    if (!province) continue;

    if (!region.code.includes("/")) {
      if (locationParts.some(part => part.provinceCode === typedProvinceCode)) {
        best = Math.max(best, 10);
      }
      continue;
    }

    const localName = getLocalRegionName(region.label, province);
    if (
      localName &&
      locationParts.some(
        part =>
          part.provinceCode === typedProvinceCode &&
          part.localText.includes(localName)
      )
    ) {
      best = Math.max(best, 20);
    }
  }
  return best;
}

function emptyJobFilters(): CanonicalJobFilters {
  return { education: [], experience: { types: [], range: null }, regions: [] };
}

function canonicalizeEducation(
  value: unknown
): CanonicalJobFilters["education"] {
  const values = requireStringArray(
    value,
    "학력",
    EDUCATION_FILTER_IDS.length
  ).map(item => item.trim().toLowerCase());
  for (const item of values) {
    if (!EDUCATION_FILTER_SET.has(item)) {
      throw new InvalidJobFiltersError(
        `지원하지 않는 학력 조건입니다: ${item}`
      );
    }
  }
  if (values.includes("any")) return [];
  return unique(values).sort(
    (left, right) =>
      (EDUCATION_ORDER.get(left) ?? 0) - (EDUCATION_ORDER.get(right) ?? 0)
  ) as CanonicalJobFilters["education"];
}

function canonicalizeExperience(
  value: unknown
): CanonicalJobFilters["experience"] {
  if (value == null) return { types: [], range: null };
  const input = requireRecord(value, "경력");
  rejectUnknownFields(input, EXPERIENCE_FIELDS, "경력");
  const rawTypes = requireStringArray(
    input.types,
    "경력 유형",
    EXPERIENCE_FILTER_IDS.length
  ).map(item => item.trim().toLowerCase());
  for (const item of rawTypes) {
    if (!EXPERIENCE_FILTER_SET.has(item)) {
      throw new InvalidJobFiltersError(
        `지원하지 않는 경력 조건입니다: ${item}`
      );
    }
  }

  const parsedRange = canonicalizeExperienceRange(input.range);
  if (rawTypes.includes("any")) return { types: [], range: null };

  const types = unique(rawTypes).sort(
    (left, right) =>
      (EXPERIENCE_ORDER.get(left) ?? 0) - (EXPERIENCE_ORDER.get(right) ?? 0)
  ) as CanonicalJobFilters["experience"]["types"];
  if (!types.includes("experienced")) {
    if (parsedRange) {
      throw new InvalidJobFiltersError(
        "경력 연수 조건은 경력을 선택한 경우에만 사용할 수 있습니다."
      );
    }
    return { types, range: null };
  }
  return { types, range: parsedRange };
}

function canonicalizeExperienceRange(
  value: unknown
): ExperienceRangeFilter | null {
  if (value == null) return null;
  const input = requireRecord(value, "경력 연수");
  rejectUnknownFields(input, EXPERIENCE_RANGE_FIELDS, "경력 연수");
  if (input.kind === "up-to-one-year") {
    if (input.years != null) {
      throw new InvalidJobFiltersError(
        "1년 이하 조건에는 연수를 함께 입력할 수 없습니다."
      );
    }
    return { kind: "up-to-one-year" };
  }
  if (input.kind === "minimum-years") {
    if (
      !Number.isInteger(input.years) ||
      Number(input.years) < MIN_EXPERIENCE_YEARS ||
      Number(input.years) > MAX_EXPERIENCE_YEARS
    ) {
      throw new InvalidJobFiltersError(
        "최소 경력 연수는 1부터 99까지의 정수여야 합니다."
      );
    }
    return { kind: "minimum-years", years: Number(input.years) };
  }
  throw new InvalidJobFiltersError("지원하지 않는 경력 연수 조건입니다.");
}

function canonicalizeRegions(value: unknown): RegionFilter[] {
  if (value == null) return [];
  if (!Array.isArray(value))
    throw new InvalidJobFiltersError("지역 조건은 배열이어야 합니다.");
  if (value.length > MAX_REGIONS) {
    throw new InvalidJobFiltersError(
      `지역은 최대 ${MAX_REGIONS}개까지 선택할 수 있습니다.`
    );
  }

  const regions = value.map((item, index) => canonicalizeRegion(item, index));
  if (regions.some(region => region.code === "any")) return [];

  const byCode = new Map<string, RegionFilter>();
  for (const region of regions) {
    const existing = byCode.get(region.code);
    if (existing && existing.label !== region.label) {
      throw new InvalidJobFiltersError(
        `같은 지역 코드에 서로 다른 이름이 지정되었습니다: ${region.code}`
      );
    }
    byCode.set(region.code, region);
  }
  const provinceSelections = new Set(
    Array.from(byCode.keys()).filter(code => !code.includes("/"))
  );
  return Array.from(byCode.values())
    .filter(
      region =>
        !region.code.includes("/") ||
        !provinceSelections.has(region.code.split("/")[0])
    )
    .sort((left, right) => left.code.localeCompare(right.code, "en"));
}

function canonicalizeRegion(value: unknown, index: number): RegionFilter {
  const input = requireRecord(value, `지역 ${index + 1}`);
  rejectUnknownFields(input, REGION_FIELDS, `지역 ${index + 1}`);
  if (typeof input.code !== "string" || typeof input.label !== "string") {
    throw new InvalidJobFiltersError(
      `지역 ${index + 1}의 코드와 이름이 필요합니다.`
    );
  }
  const code = input.code.trim().toLowerCase();
  const label = input.label.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!code || code.length > MAX_REGION_CODE_LENGTH) {
    throw new InvalidJobFiltersError(
      `지역 ${index + 1}의 코드가 올바르지 않습니다.`
    );
  }
  if (
    !label ||
    label.length > MAX_REGION_LABEL_LENGTH ||
    !SAFE_REGION_LABEL_PATTERN.test(label)
  ) {
    throw new InvalidJobFiltersError(
      `지역 ${index + 1}의 이름이 올바르지 않습니다.`
    );
  }
  if (code === "any") {
    if (label !== "지역 무관")
      throw new InvalidJobFiltersError(
        "지역 무관 항목의 이름이 올바르지 않습니다."
      );
    return { code, label };
  }

  const parts = code.split("/");
  if (parts.length > 2 || !PROVINCE_CODES.has(parts[0])) {
    throw new InvalidJobFiltersError(`지원하지 않는 지역 코드입니다: ${code}`);
  }
  if (parts.length === 2 && !SAFE_LOCAL_CODE_PATTERN.test(parts[1])) {
    throw new InvalidJobFiltersError(
      `시·군·구 지역 코드가 올바르지 않습니다: ${code}`
    );
  }

  const province = PROVINCES[parts[0] as ProvinceCode];
  const localName = getLocalRegionName(label, province);
  if (localName == null) {
    throw new InvalidJobFiltersError(
      `지역 코드와 이름이 일치하지 않습니다: ${code}`
    );
  }
  if (parts.length === 1 && localName !== "") {
    throw new InvalidJobFiltersError(
      `시·도 지역 이름이 올바르지 않습니다: ${label}`
    );
  }
  if (parts.length === 2 && !isValidLocalRegionName(localName, parts[1])) {
    throw new InvalidJobFiltersError(
      `시·군·구 지역 이름이 필요합니다: ${code}`
    );
  }

  return {
    code,
    label:
      parts.length === 1 ? province.label : `${province.label} ${localName}`,
  };
}

function classifyEducation(value: string | null): {
  unrestricted: boolean;
  levels: Set<CanonicalJobFilters["education"][number]>;
} {
  const text = normalizePostingCondition(value);
  const levels = new Set<CanonicalJobFilters["education"][number]>();
  if (!text) return { unrestricted: false, levels };
  if (/(?:학력무관|학력제한없음)/.test(text))
    return { unrestricted: true, levels };

  if (
    /(?:박사후|포스트닥|postdoc|post-doctor)/i.test(text) ||
    /(?:박사(?:졸업)?이상|박사(?:졸업)?↑)/.test(text)
  ) {
    levels.add("post-doctorate");
  } else if (/박사/.test(text)) {
    levels.add("doctorate");
  }
  if (/(?:석사|대학원졸)/.test(text)) levels.add("master");
  if (/(?:초대졸|전문대졸|2[,·]?3년제|2년제|3년제)/.test(text))
    levels.add("associate");
  if (/(?:고졸이하|고교졸업이하|고등학교졸업이하|중졸|초졸)/.test(text)) {
    levels.add("high-school-or-less");
  } else if (/(?:고졸|고교졸업|고등학교졸업)/.test(text)) {
    levels.add("high-school");
  }
  const bachelorText = text.replace(/(?:초대졸|전문대졸)/g, "");
  if (/(?:대졸|대학교졸업|4년제)/.test(bachelorText)) levels.add("bachelor");

  return { unrestricted: false, levels };
}

function classifyExperience(value: string | null): {
  unrestricted: boolean;
  types: Set<CanonicalJobFilters["experience"]["types"][number]>;
  minimumYears: number | null;
  maximumYears: number | null;
} {
  const text = normalizePostingCondition(value);
  const types = new Set<CanonicalJobFilters["experience"]["types"][number]>();
  if (!text)
    return {
      unrestricted: false,
      types,
      minimumYears: null,
      maximumYears: null,
    };
  if (/(?:경력무관|경력제한없음)/.test(text)) {
    return {
      unrestricted: true,
      types,
      minimumYears: null,
      maximumYears: null,
    };
  }

  if (/신입/.test(text)) types.add("entry");
  if (/경력/.test(text)) types.add("experienced");
  const yearBounds = parseExperienceYearBounds(text);
  if (yearBounds.minimum != null) types.add("experienced");
  return {
    unrestricted: false,
    types,
    minimumYears: yearBounds.minimum,
    maximumYears: yearBounds.maximum,
  };
}

function parseExperienceYearBounds(text: string): {
  minimum: number | null;
  maximum: number | null;
} {
  const rangeMatch = /(\d{1,2})(?:년)?(?:~|∼|〜|～|-|–|—)(\d{1,2})(?:년)?/.exec(
    text
  );
  if (rangeMatch) {
    const minimum = clampParsedYears(Number(rangeMatch[1]));
    const maximum = clampParsedYears(Number(rangeMatch[2]));
    return minimum != null && maximum != null && minimum <= maximum
      ? { minimum, maximum }
      : { minimum: null, maximum: null };
  }

  const explicitMatch = /(\d{1,2})(?:년)?(?:이상|이하|미만|↑|↓|\+)/.exec(text);
  if (explicitMatch) {
    const years = Number(explicitMatch[1]);
    const parsed = clampParsedYears(years);
    if (parsed == null) return { minimum: null, maximum: null };
    if (/(?:이하|↓)/.test(explicitMatch[0]))
      return { minimum: 0, maximum: parsed };
    if (/미만/.test(explicitMatch[0]))
      return { minimum: 0, maximum: Math.max(0, parsed - 1) };
    return { minimum: parsed, maximum: null };
  }

  const yearsMatch = /(\d{1,2})년/.exec(text);
  if (yearsMatch) {
    const years = clampParsedYears(Number(yearsMatch[1]));
    return { minimum: years, maximum: years };
  }
  if (/\d{1,2}개월/.test(text)) return { minimum: 0, maximum: 0 };
  return { minimum: null, maximum: null };
}

function clampParsedYears(value: number): number | null {
  return Number.isInteger(value) && value >= 0 && value <= MAX_EXPERIENCE_YEARS
    ? value
    : null;
}

function normalizePostingCondition(value: string | null): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/g, "")
    .replace(/[()\[\]]/g, "");
}

type LocationPart = { provinceCode: ProvinceCode | null; localText: string };

function parseLocationParts(value: string): LocationPart[] {
  const rawParts = value
    .normalize("NFKC")
    .replace(/\s+외(?:\s*\d+\s*(?:곳|개|건)?)?(?=\s|$)/g, ",")
    .replace(/[\r\n>|/;·ㆍ•]+/g, ",")
    .split(",")
    .map(part =>
      part.replace(/(?:\s+|^)외(?:\s*\d+\s*(?:곳|개|건)?)?\s*$/g, "").trim()
    )
    .filter(Boolean);

  const intermediate = rawParts.map(rawPart => {
    const compact = compactRegionText(rawPart.replace(/전체/g, ""));
    const provinceMatch = findProvinceMatch(compact);
    if (!provinceMatch) return { provinceCode: null, localText: compact };
    return {
      provinceCode: provinceMatch.provinceCode,
      localText: `${compact.slice(0, provinceMatch.index)}${compact.slice(
        provinceMatch.index + provinceMatch.alias.length
      )}`,
    };
  });

  const explicitProvinces = new Set(
    intermediate
      .map(part => part.provinceCode)
      .filter((code): code is ProvinceCode => code != null)
  );
  const onlyExplicitProvince =
    explicitProvinces.size === 1
      ? (explicitProvinces.values().next().value as ProvinceCode)
      : null;
  let activeProvince: ProvinceCode | null = null;

  return intermediate.map(part => {
    if (part.provinceCode) activeProvince = part.provinceCode;
    return {
      provinceCode: part.provinceCode ?? activeProvince ?? onlyExplicitProvince,
      localText: part.localText,
    };
  });
}

function findProvinceMatch(value: string): {
  provinceCode: ProvinceCode;
  alias: string;
  index: number;
} | null {
  let best: {
    provinceCode: ProvinceCode;
    alias: string;
    index: number;
  } | null = null;
  for (const [provinceCode, province] of Object.entries(PROVINCES) as [
    ProvinceCode,
    (typeof PROVINCES)[ProvinceCode],
  ][]) {
    for (const rawAlias of province.aliases) {
      const alias = compactRegionText(rawAlias);
      const index = value.indexOf(alias);
      if (index < 0) continue;
      // `경기 광주시` refers to Gyeonggi's Gwangju-si, not Gwangju Metropolitan City.
      if (
        provinceCode === "gwangju" &&
        alias === "광주" &&
        value.slice(index).startsWith("광주시")
      ) {
        continue;
      }
      if (
        !best ||
        index < best.index ||
        (index === best.index && alias.length > best.alias.length)
      ) {
        best = { provinceCode, alias, index };
      }
    }
  }
  return best;
}

function getLocalRegionName(
  value: string,
  province: (typeof PROVINCES)[ProvinceCode]
): string | null {
  const compact = compactRegionText(value);
  const alias = [...province.aliases]
    .map(compactRegionText)
    .sort((left, right) => right.length - left.length)
    .find(candidate => compact.startsWith(candidate));
  return alias ? compact.slice(alias.length) : null;
}

function isValidLocalRegionName(value: string, localCode: string): boolean {
  const suffix = localCode.endsWith("-si")
    ? "시"
    : localCode.endsWith("-gun")
      ? "군"
      : localCode.endsWith("-gu")
        ? "구"
        : null;
  return Boolean(
    suffix &&
    /^[가-힣]{2,20}(?:시|군|구)$/.test(value) &&
    value.endsWith(suffix)
  );
}

function compactRegionText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[^a-z0-9가-힣]/gi, "")
    .toLocaleLowerCase("ko-KR");
}

function isUnrestrictedRegionText(compactValue: string): boolean {
  return /^(?:전국|전지역|지역무관|근무지무관)$/.test(compactValue);
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidJobFiltersError(
      `${field} 조건이 올바른 객체 형식이 아닙니다.`
    );
  }
  return value as Record<string, unknown>;
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  field: string
): void {
  const unknown = Object.keys(value).find(key => !allowed.has(key));
  if (unknown)
    throw new InvalidJobFiltersError(
      `${field}에 지원하지 않는 항목이 있습니다: ${unknown}`
    );
}

function requireStringArray(
  value: unknown,
  field: string,
  maxItems: number
): string[] {
  if (value == null) return [];
  if (!Array.isArray(value))
    throw new InvalidJobFiltersError(`${field} 조건은 배열이어야 합니다.`);
  if (value.length > maxItems)
    throw new InvalidJobFiltersError(`${field} 조건이 너무 많습니다.`);
  if (value.some(item => typeof item !== "string")) {
    throw new InvalidJobFiltersError(
      `${field} 조건은 문자열 배열이어야 합니다.`
    );
  }
  return value as string[];
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}
