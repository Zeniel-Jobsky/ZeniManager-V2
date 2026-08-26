import { cleanText, extractClassText, extractSpanTexts } from './normalize.ts';
import type { RawJobPosting } from './types.ts';

const SEARCH_BASE_URL = 'https://www.saramin.co.kr/zf_user/search/recruit';

export function buildSaraminSearchUrl(desiredJob: string): string {
  const url = new URL(SEARCH_BASE_URL);
  url.searchParams.set('searchType', 'search');
  url.searchParams.set('searchword', desiredJob);
  url.searchParams.set('recruitPage', '1');
  url.searchParams.set('recruitSort', 'relation');
  return url.toString();
}

export function parseSaraminSearch(html: string): RawJobPosting[] {
  if (looksBlocked(html)) {
    throw new Error('사람인이 자동 조회 요청을 제한했습니다.');
  }

  const parts = html.split(/<div\s+class=["']item_recruit["']/i).slice(1);
  const postings: RawJobPosting[] = [];

  for (const part of parts) {
    if (postings.length >= 60) break;
    const fragment = part.slice(0, 15_000);
    const sourceId = /\bvalue=["'](\d+)["']/i.exec(fragment)?.[1]
      ?? /\brec_idx=(\d+)/i.exec(fragment)?.[1];
    const titleMatch = /class=["'][^"']*\bjob_tit\b[^"']*["'][\s\S]{0,1800}?<a\b[^>]*\btitle=["']([^"']+)["']/i.exec(fragment);
    const title = cleanText(titleMatch?.[1] ?? extractClassText(fragment, 'job_tit'));
    const company = extractClassText(fragment, 'corp_name');
    if (!sourceId || !title || !company) continue;

    const conditionBlock = /class=["'][^"']*\bjob_condition\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(fragment)?.[1] ?? '';
    const conditions = extractSpanTexts(conditionBlock);

    postings.push({
      source: 'saramin',
      sourceId,
      url: `https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=${sourceId}`,
      title,
      company,
      location: conditions[0] ?? null,
      experience: conditions[1] ?? null,
      education: conditions[2] ?? null,
      employmentType: conditions[3] ?? null,
      postedAtText: extractClassText(fragment, 'job_day'),
      deadlineText: extractClassText(fragment, 'date'),
    });
  }

  if (postings.length === 0 && !looksEmpty(html)) {
    throw new Error('사람인 검색 결과 구조가 변경되어 공고를 읽지 못했습니다.');
  }

  return uniqueBySourceId(postings);
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
  return /class=["'][^"']*\bno_result\b/i.test(html)
    || /검색\s*결과가\s*없|조건에\s*맞는\s*채용정보가\s*없/i.test(cleanText(html));
}

function looksBlocked(html: string): boolean {
  return /captcha|비정상적인\s*접근|접근이\s*제한|robot\s*check/i.test(html);
}
