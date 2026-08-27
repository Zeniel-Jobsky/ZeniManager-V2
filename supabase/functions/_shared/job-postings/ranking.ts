import {
  getFilterMatchSpecificity,
  type CanonicalJobFilters,
} from "./filters.ts";
import { JOB_SOURCES, type JobPostingRecommendation } from "./types.ts";

const TITLE_NOISE_WORDS = new Set([
  "공고",
  "구인",
  "급구",
  "모집",
  "상시",
  "신입",
  "경력",
  "인재",
  "정규직",
  "계약직",
  "인턴",
  "직원",
  "사원",
  "채용",
]);

interface NormalizedRankingText {
  compact: string;
  tokens: string[];
}

interface PostingRank {
  desiredJob: number;
  matchedDesiredJob: number;
  desiredJobPriority: number;
  filterSpecificity: number;
  postedAt: number;
  stableKey: string;
}

/**
 * Sorts a copy of the list by title-centred desired-job relevance. Filter
 * specificity is intentionally a tie-breaker so a looser wording can never
 * outrank a clearly more relevant job title merely because of metadata.
 */
export function rankJobPostings(
  postings: JobPostingRecommendation[],
  desiredJobs: string[],
  filters: CanonicalJobFilters
): JobPostingRecommendation[] {
  const normalizedDesiredJobs = desiredJobs.map(normalizeRankingText);
  const ranks = new Map<JobPostingRecommendation, PostingRank>();
  for (const posting of postings) {
    ranks.set(
      posting,
      calculatePostingRank(posting, normalizedDesiredJobs, filters)
    );
  }

  return [...postings].sort((left, right) =>
    comparePostingRanks(ranks.get(left)!, ranks.get(right)!)
  );
}

/** Exposed separately to keep relevance behavior directly testable. */
export function calculateDesiredJobRelevance(
  title: string,
  desiredJobs: string[]
): number {
  const normalizedTitle = normalizeRankingText(title);
  return desiredJobs.reduce(
    (best, desiredJob) =>
      Math.max(
        best,
        scoreTitleAgainstDesiredJob(
          normalizedTitle,
          normalizeRankingText(desiredJob)
        )
      ),
    0
  );
}

function calculatePostingRank(
  posting: JobPostingRecommendation,
  desiredJobs: NormalizedRankingText[],
  filters: CanonicalJobFilters
): PostingRank {
  const normalizedTitle = normalizeRankingText(posting.title);
  const normalizedMatchedDesiredJob = normalizeRankingText(
    posting.matchedDesiredJob
  );
  let desiredJob = 0;
  let desiredJobPriority = Number.MAX_SAFE_INTEGER;

  desiredJobs.forEach((candidate, index) => {
    const score = scoreTitleAgainstDesiredJob(normalizedTitle, candidate);
    if (
      score > desiredJob ||
      (score === desiredJob && index < desiredJobPriority)
    ) {
      desiredJob = score;
      desiredJobPriority = index;
    }
  });

  const postedAt = posting.postedAt
    ? Date.parse(`${posting.postedAt}T00:00:00Z`)
    : Number.NEGATIVE_INFINITY;
  const sourcePriority = JOB_SOURCES.indexOf(posting.source);
  return {
    desiredJob,
    matchedDesiredJob: scoreTitleAgainstDesiredJob(
      normalizedTitle,
      normalizedMatchedDesiredJob
    ),
    desiredJobPriority,
    filterSpecificity: getFilterMatchSpecificity(posting, filters),
    postedAt: Number.isFinite(postedAt) ? postedAt : Number.NEGATIVE_INFINITY,
    stableKey: [
      normalizeStableText(posting.title),
      normalizeStableText(posting.company),
      String(sourcePriority < 0 ? JOB_SOURCES.length : sourcePriority),
      posting.sourceId,
      posting.url,
    ].join("\u0000"),
  };
}

function comparePostingRanks(left: PostingRank, right: PostingRank): number {
  if (left.desiredJob !== right.desiredJob)
    return right.desiredJob - left.desiredJob;
  if (left.matchedDesiredJob !== right.matchedDesiredJob) {
    return right.matchedDesiredJob - left.matchedDesiredJob;
  }
  if (left.filterSpecificity !== right.filterSpecificity) {
    return right.filterSpecificity - left.filterSpecificity;
  }
  if (left.desiredJobPriority !== right.desiredJobPriority) {
    return left.desiredJobPriority - right.desiredJobPriority;
  }
  if (left.postedAt !== right.postedAt) return right.postedAt - left.postedAt;
  return compareStableText(left.stableKey, right.stableKey);
}

function scoreTitleAgainstDesiredJob(
  title: NormalizedRankingText,
  desiredJob: NormalizedRankingText
): number {
  if (!title.compact || !desiredJob.compact) return 0;
  if (title.compact === desiredJob.compact) return 10_000;

  if (title.compact.includes(desiredJob.compact)) {
    const compactness = Math.round(
      (desiredJob.compact.length / title.compact.length) * 500
    );
    return 8_000 + compactness;
  }

  if (desiredJob.compact.includes(title.compact) && title.compact.length >= 2) {
    const compactness = Math.round(
      (title.compact.length / desiredJob.compact.length) * 400
    );
    return 7_000 + compactness;
  }

  let matchedCharacters = 0;
  let exactTokens = 0;
  for (const desiredToken of desiredJob.tokens) {
    const exact = title.tokens.includes(desiredToken);
    const partial =
      exact ||
      title.tokens.some(
        titleToken =>
          desiredToken.length >= 2 &&
          titleToken.length >= 2 &&
          (titleToken.includes(desiredToken) ||
            desiredToken.includes(titleToken))
      );
    if (!partial) continue;
    matchedCharacters += desiredToken.length;
    if (exact) exactTokens += 1;
  }

  if (matchedCharacters === 0) return 0;
  const totalCharacters =
    desiredJob.tokens.reduce((sum, token) => sum + token.length, 0) || 1;
  const coverage = matchedCharacters / totalCharacters;
  const exactCoverage = exactTokens / Math.max(1, desiredJob.tokens.length);
  return Math.min(
    6_999,
    Math.round(2_000 + coverage * 3_500 + exactCoverage * 1_000)
  );
}

function normalizeRankingText(value: string): NormalizedRankingText {
  const tokens = value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^a-z0-9가-힣+#]+/gi, " ")
    .trim()
    .split(/\s+/)
    .filter(token => token && !TITLE_NOISE_WORDS.has(token));
  return { tokens, compact: tokens.join("") };
}

function normalizeStableText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR");
}

function compareStableText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
