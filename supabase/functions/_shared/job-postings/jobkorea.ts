import { cleanText, extractClassText } from './normalize.ts';
import type { RawJobPosting } from './types.ts';

const SEARCH_BASE_URL = 'https://m.jobkorea.co.kr/Search/Adv';

export function buildJobKoreaSearchUrl(desiredJob: string): string {
  const url = new URL(SEARCH_BASE_URL);
  url.searchParams.set('Keyword', desiredJob);
  return url.toString();
}

export function parseJobKoreaSearch(html: string): RawJobPosting[] {
  if (looksBlocked(html)) {
    throw new Error('잡코리아가 자동 조회 요청을 제한했습니다.');
  }

  const parts = html.split(/<div\s+class=["']section-item\b/i).slice(1);
  const postings: RawJobPosting[] = [];

  for (const part of parts) {
    if (postings.length >= 60) break;
    const fragment = part.slice(0, 12_000);
    const sourceId = /\bdata-gno=["'](\d+)["']/i.exec(fragment)?.[1]
      ?? /\/Recruit\/GI_Read\/(\d+)/i.exec(fragment)?.[1];
    const title = extractClassText(fragment, 'item-title');
    const company = extractClassText(fragment, 'item-corp_name');
    if (!sourceId || !title || !company) continue;

    postings.push({
      source: 'jobkorea',
      sourceId,
      url: `https://www.jobkorea.co.kr/Recruit/GI_Read/${sourceId}`,
      title,
      company,
      location: extractFirstClassText(fragment, ['item-condition_location', 'item-condition-location']),
      experience: extractFirstClassText(fragment, ['item-condition_applicants', 'item-condition-applicants']),
      deadlineText: extractFirstClassText(fragment, ['item-condition_dday', 'item-condition-dday']),
    });
  }

  if (postings.length === 0 && !looksEmpty(html)) {
    throw new Error('잡코리아 검색 결과 구조가 변경되어 공고를 읽지 못했습니다.');
  }

  return uniqueBySourceId(postings);
}

function extractFirstClassText(fragment: string, classNames: string[]): string {
  for (const className of classNames) {
    const value = extractClassText(fragment, className);
    if (value) return value;
  }
  return '';
}

function uniqueBySourceId(postings: RawJobPosting[]): RawJobPosting[] {
  const seen = new Set<string>();
  return postings.filter(posting => {
    if (seen.has(posting.sourceId)) return false;
    seen.add(posting.sourceId);
    return true;
  });
}

function looksEmpty(html: string): boolean {
  return /data-has-search-list=["']false["']/i.test(html)
    || /검색\s*결과가\s*(?:없|부족)/i.test(cleanText(html));
}

function looksBlocked(html: string): boolean {
  return /captcha|비정상적인\s*접근|접근이\s*제한|robot\s*check/i.test(html);
}
