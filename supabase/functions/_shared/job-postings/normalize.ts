import {
  JOB_SOURCE_LABELS,
  type JobDeadlineKind,
  type JobPostingRecommendation,
  type JobSource,
  type RawJobPosting,
} from './types.ts';

const KOREA_TIME_ZONE = 'Asia/Seoul';

const ALLOWED_JOB_HOSTS: Record<JobSource, Set<string>> = {
  jobkorea: new Set(['www.jobkorea.co.kr', 'm.jobkorea.co.kr']),
  saramin: new Set(['www.saramin.co.kr', 'www2.saramin.co.kr']),
  incruit: new Set(['job.incruit.com', 'www.incruit.com']),
};

const CLOSED_PATTERN = /(?:마감되었습니다|접수\s*마감|채용\s*마감|모집\s*마감|접수\s*종료|채용\s*종료|모집\s*종료|공고\s*마감|^\s*마감\s*$)/i;

export interface ParsedDeadline {
  deadline: string | null;
  deadlineAt: string | null;
  deadlineLabel: string;
  kind: JobDeadlineKind | 'unknown';
  closed: boolean;
}

export function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

export function cleanText(value: string | null | undefined): string {
  if (!value) return '';
  return decodeHtml(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractClassText(fragment: string, className: string): string {
  const escapedClass = escapeRegExp(className);
  const pattern = new RegExp(
    `<(?:a|div|span|strong|h[1-6])\\b[^>]*class=["'][^"']*\\b${escapedClass}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/(?:a|div|span|strong|h[1-6])>`,
    'i',
  );
  return cleanText(pattern.exec(fragment)?.[1]);
}

export function extractSpanTexts(fragment: string): string[] {
  return Array.from(fragment.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi))
    .map(match => cleanText(match[1]))
    .filter(Boolean);
}

export function getKoreanDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: KOREA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;

  if (!year || !month || !day) {
    throw new Error('한국 표준시 날짜를 계산할 수 없습니다.');
  }

  return `${year}-${month}-${day}`;
}

export function parseKoreanDeadline(
  value: string | null | undefined,
  now = new Date(),
): ParsedDeadline {
  const label = cleanText(value);
  if (!label) {
    return { deadline: null, deadlineAt: null, deadlineLabel: '', kind: 'unknown', closed: false };
  }

  if (CLOSED_PATTERN.test(label)) {
    return { deadline: null, deadlineAt: null, deadlineLabel: label, kind: 'unknown', closed: true };
  }

  if (/(?:상시\s*채용|상시\s*모집|상시$)/i.test(label)) {
    return { deadline: null, deadlineAt: null, deadlineLabel: label, kind: 'always', closed: false };
  }

  if (/(?:채용\s*시|채용시까지|충원\s*시)/i.test(label)) {
    return { deadline: null, deadlineAt: null, deadlineLabel: label, kind: 'until-hired', closed: false };
  }

  const today = getKoreanDate(now);
  const hourDeadline = /(?:^|\s)([01]?\d|2[0-3])\s*시\s*마감(?:\s|$)/i.exec(label);
  const deadlineHour = hourDeadline ? Number(hourDeadline[1]) : null;

  if (/(?:오늘\s*마감|D\s*-\s*0\b)/i.test(label)) {
    return createDateDeadline(today, label, deadlineHour, now);
  }

  const dayOffset = /D\s*-\s*(\d+)/i.exec(label);
  if (dayOffset) {
    const deadline = addDays(today, Number.parseInt(dayOffset[1], 10));
    return createDateDeadline(deadline, label, deadlineHour, now);
  }

  const isoDate = /\b(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\b/.exec(label);
  if (isoDate) {
    const deadline = toIsoDate(Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3]));
    if (!deadline) return { deadline: null, deadlineAt: null, deadlineLabel: label, kind: 'unknown', closed: false };
    return createDateDeadline(deadline, label, deadlineHour, now);
  }

  const shortDate = /(?:^|[~\s])(\d{1,2})[./-](\d{1,2})(?:\D|$)/.exec(label);
  if (shortDate) {
    const [, currentMonth] = today.split('-').map(Number);
    const month = Number(shortDate[1]);
    const day = Number(shortDate[2]);
    let year = Number(today.slice(0, 4));

    // Search pages usually omit the year. Only roll over when the current date
    // is near year-end and the displayed deadline is in January or February;
    // otherwise an earlier month is treated as expired in the current year.
    if (currentMonth >= 11 && month <= 2) year += 1;

    const deadline = toIsoDate(year, month, day);
    if (!deadline) return { deadline: null, deadlineAt: null, deadlineLabel: label, kind: 'unknown', closed: false };
    return createDateDeadline(deadline, label, deadlineHour, now);
  }

  if (deadlineHour != null) return createDateDeadline(today, label, deadlineHour, now);
  return { deadline: null, deadlineAt: null, deadlineLabel: label, kind: 'unknown', closed: false };
}

export function normalizeRawPosting(
  posting: RawJobPosting,
  desiredJob: string,
  now = new Date(),
): JobPostingRecommendation | null {
  const title = cleanText(posting.title).slice(0, 240);
  const company = cleanText(posting.company).slice(0, 160);
  const sourceId = cleanText(posting.sourceId).slice(0, 128);
  if (!title || !company || !sourceId) return null;

  const url = sanitizeJobUrl(posting.source, posting.url);
  if (!url) return null;

  const parsedDeadline = parseKoreanDeadline(posting.deadlineText, now);
  if (parsedDeadline.closed || parsedDeadline.kind === 'unknown') return null;

  const today = getKoreanDate(now);
  if (parsedDeadline.deadline && parsedDeadline.deadline < today) return null;

  return {
    id: `${posting.source}:${sourceId}`,
    source: posting.source,
    sourceLabel: JOB_SOURCE_LABELS[posting.source],
    sourceId,
    url,
    title,
    company,
    location: nullableText(posting.location, 160),
    employmentType: nullableText(posting.employmentType, 100),
    experience: nullableText(posting.experience, 100),
    education: nullableText(posting.education, 100),
    postedAt: normalizePostedAt(posting.postedAtText, now),
    deadline: parsedDeadline.deadline,
    deadlineAt: parsedDeadline.deadlineAt,
    deadlineLabel: parsedDeadline.deadlineLabel.slice(0, 100),
    deadlineKind: parsedDeadline.kind,
    matchedDesiredJob: cleanText(desiredJob),
    links: [{
      source: posting.source,
      sourceLabel: JOB_SOURCE_LABELS[posting.source],
      url,
    }],
  };
}

export function deduplicateJobPostings(
  postings: JobPostingRecommendation[],
): JobPostingRecommendation[] {
  const results: JobPostingRecommendation[] = [];
  const sourceIdIndex = new Map<string, number>();
  const urlIndex = new Map<string, number>();
  const fingerprintIndex = new Map<string, number[]>();

  for (const posting of postings) {
    const sourceIdKey = `${posting.source}:${posting.sourceId}`;
    const urlKey = canonicalUrlKey(posting.url);
    const fingerprint = `${normalizeCompany(posting.company)}|${normalizeTitle(posting.title)}`;
    const candidateIndexes = fingerprintIndex.get(fingerprint) ?? [];

    let duplicateIndex = sourceIdIndex.get(sourceIdKey) ?? urlIndex.get(urlKey);
    if (duplicateIndex == null && fingerprint !== '|') {
      duplicateIndex = candidateIndexes.find(index => {
        const existing = results[index];
        return !existing.links.some(link => link.source === posting.source)
          && locationsCompatible(existing.location, posting.location)
          && deadlinesCompatible(existing, posting);
      });
    }

    if (duplicateIndex == null) {
      const nextIndex = results.length;
      results.push(posting);
      sourceIdIndex.set(sourceIdKey, nextIndex);
      urlIndex.set(urlKey, nextIndex);
      fingerprintIndex.set(fingerprint, [...candidateIndexes, nextIndex]);
      continue;
    }

    const existing = results[duplicateIndex];
    const merged = mergePosting(existing, posting);
    results[duplicateIndex] = merged;
    sourceIdIndex.set(sourceIdKey, duplicateIndex);
    urlIndex.set(urlKey, duplicateIndex);
    const mergedFingerprint = `${normalizeCompany(merged.company)}|${normalizeTitle(merged.title)}`;
    const mergedCandidates = fingerprintIndex.get(mergedFingerprint) ?? [];
    if (!mergedCandidates.includes(duplicateIndex)) {
      fingerprintIndex.set(mergedFingerprint, [...mergedCandidates, duplicateIndex]);
    }
  }

  return results;
}

export function sanitizeDesiredJob(value: unknown): string {
  if (typeof value !== 'string') return '';
  const normalized = cleanText(value.normalize('NFKC'))
    .replace(/[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return containsSensitiveIdentifier(normalized) ? '' : normalized;
}

export function splitDesiredJobs(value: string | null | undefined, maxItems = 3): string[] {
  if (!value || value.length > 512 || maxItems < 1) return [];
  const unique = new Map<string, string>();
  for (const part of value.split(/[,;|\n]+/)) {
    if (!part.trim()) continue;
    const sanitized = sanitizeDesiredJob(part);
    if (!sanitized) return [];
    const key = sanitized.normalize('NFKC').toLocaleLowerCase('ko-KR');
    if (!unique.has(key)) unique.set(key, sanitized);
    if (unique.size === maxItems) break;
  }
  return Array.from(unique.values());
}

export function sanitizeJobUrl(source: JobSource, value: string): string | null {
  try {
    const url = new URL(decodeHtml(value));
    if (url.protocol !== 'https:' || !ALLOWED_JOB_HOSTS[source].has(url.hostname.toLowerCase())) {
      return null;
    }

    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function mergePosting(
  current: JobPostingRecommendation,
  candidate: JobPostingRecommendation,
): JobPostingRecommendation {
  const currentScore = completenessScore(current);
  const candidateScore = completenessScore(candidate);
  const primary = candidateScore > currentScore ? candidate : current;
  const secondary = primary === current ? candidate : current;
  const deadlineSource = selectDeadlineSource(primary, secondary);
  const links = [...primary.links];

  for (const link of secondary.links) {
    if (!links.some(existing => existing.source === link.source && existing.url === link.url)) {
      links.push(link);
    }
  }

  return {
    ...primary,
    location: primary.location ?? secondary.location,
    employmentType: primary.employmentType ?? secondary.employmentType,
    experience: primary.experience ?? secondary.experience,
    education: primary.education ?? secondary.education,
    postedAt: primary.postedAt ?? secondary.postedAt,
    deadline: deadlineSource.deadline,
    deadlineAt: deadlineSource.deadlineAt,
    deadlineLabel: deadlineSource.deadlineLabel,
    deadlineKind: deadlineSource.deadlineKind,
    links,
  };
}

function selectDeadlineSource(
  primary: JobPostingRecommendation,
  secondary: JobPostingRecommendation,
): JobPostingRecommendation {
  if (primary.deadline && secondary.deadline) {
    const primaryInstant = primary.deadlineAt ? new Date(primary.deadlineAt).valueOf() : Number.POSITIVE_INFINITY;
    const secondaryInstant = secondary.deadlineAt ? new Date(secondary.deadlineAt).valueOf() : Number.POSITIVE_INFINITY;
    if (primaryInstant !== secondaryInstant) {
      return primaryInstant < secondaryInstant ? primary : secondary;
    }
    return primary.deadline <= secondary.deadline ? primary : secondary;
  }
  if (primary.deadline) return primary;
  if (secondary.deadline) return secondary;
  return primary;
}

function completenessScore(posting: JobPostingRecommendation): number {
  return [
    posting.location,
    posting.employmentType,
    posting.experience,
    posting.education,
    posting.postedAt,
    posting.deadline,
  ].filter(Boolean).length;
}

function normalizePostedAt(value: string | null | undefined, now: Date): string | null {
  const text = cleanText(value);
  if (!text) return null;

  const iso = /\b(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\b/.exec(text);
  if (iso) return toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const short = /\b(\d{2})[./-](\d{1,2})[./-](\d{1,2})\b/.exec(text);
  if (short) return toIsoDate(2000 + Number(short[1]), Number(short[2]), Number(short[3]));

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.valueOf())) return getKoreanDate(parsed);

  return null;
}

function normalizeCompany(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/^\s*(?:주식회사|유한책임회사|유한회사|\(주\)|㈜|㈔)\s*/g, '')
    .replace(/\s*(?:주식회사|유한책임회사|유한회사|\(주\)|㈜|㈔)\s*$/g, '')
    .replace(/[^a-z0-9가-힣ㄱ-ㅎㅏ-ㅣ]/gi, '');
}

function normalizeTitle(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/[\[\](){}]/g, ' ')
    .replace(/(?:^|\s)(?:신입|경력|신입경력)(?=\s|$)/g, ' ')
    .replace(/(?:채용|모집|공고)\s*$/g, ' ')
    .replace(/[^a-z0-9가-힣ㄱ-ㅎㅏ-ㅣ+#]/gi, '');
}

function locationsCompatible(left: string | null, right: string | null): boolean {
  if (!left || !right) return false;
  const normalizedLeft = normalizeLocation(left);
  const normalizedRight = normalizeLocation(right);
  return normalizedLeft === normalizedRight
    || normalizedLeft.startsWith(normalizedRight)
    || normalizedRight.startsWith(normalizedLeft);
}

function deadlinesCompatible(
  left: JobPostingRecommendation,
  right: JobPostingRecommendation,
): boolean {
  if (left.deadline || right.deadline) {
    return Boolean(left.deadline && right.deadline && left.deadline === right.deadline);
  }
  return left.deadlineKind === right.deadlineKind;
}

function containsSensitiveIdentifier(value: string): boolean {
  return /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(value)
    || /(?:^|\D)01[016789][ -]?\d{3,4}[ -]?\d{4}(?:\D|$)/.test(value)
    || /(?:^|\D)\d{6}[ -]?[1-4]\d{6}(?:\D|$)/.test(value);
}

function createDateDeadline(
  deadline: string,
  label: string,
  deadlineHour: number | null,
  now: Date,
): ParsedDeadline {
  const deadlineAt = toKoreanDeadlineInstant(deadline, deadlineHour);
  return {
    deadline,
    deadlineAt,
    deadlineLabel: label,
    kind: 'date',
    closed: new Date(deadlineAt).valueOf() <= now.valueOf(),
  };
}

function toKoreanDeadlineInstant(deadline: string, deadlineHour: number | null): string {
  const [year, month, day] = deadline.split('-').map(Number);
  const utcMillis = deadlineHour == null
    ? Date.UTC(year, month - 1, day, 15)
    : Date.UTC(year, month - 1, day, deadlineHour - 9);
  return new Date(utcMillis).toISOString();
}

function normalizeLocation(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/서울특별시/g, '서울')
    .replace(/(부산|대구|인천|광주|대전|울산)광역시/g, '$1')
    .replace(/세종특별자치시/g, '세종')
    .replace(/제주특별자치도/g, '제주')
    .replace(/(경기|강원|충청북|충청남|전라북|전라남|경상북|경상남)도/g, '$1')
    .replace(/[^a-z0-9가-힣ㄱ-ㅎㅏ-ㅣ]/gi, '')
    .toLocaleLowerCase('ko-KR');
}

function canonicalUrlKey(value: string): string {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname.replace(/\/+$/, '').toLowerCase();

    if (hostname.endsWith('saramin.co.kr')) {
      const recruitmentId = url.searchParams.get('rec_idx');
      return recruitmentId
        ? `${hostname}${pathname}?rec_idx=${encodeURIComponent(recruitmentId)}`
        : `${hostname}${pathname}`;
    }

    if (hostname.endsWith('incruit.com')) {
      const job = url.searchParams.get('job');
      return job
        ? `${hostname}${pathname}?job=${encodeURIComponent(job)}`
        : `${hostname}${pathname}`;
    }

    return `${hostname}${pathname}`;
  } catch {
    return value;
  }
}

function nullableText(value: string | null | undefined, maxLength: number): string | null {
  const text = cleanText(value).slice(0, maxLength);
  return text || null;
}

function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return toIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function toIsoDate(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() + 1 !== month
    || date.getUTCDate() !== day
  ) {
    return '';
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
