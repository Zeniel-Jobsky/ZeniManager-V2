import { cleanText, extractClassText, extractSpanTexts } from './normalize.ts';
import type { RawJobPosting } from './types.ts';

const SEARCH_BASE_URL = 'https://job.incruit.com/jobdb_list/searchjob.asp';

export function buildIncruitSearchUrl(desiredJob: string): string {
  const url = new URL(SEARCH_BASE_URL);
  url.searchParams.set('kw', desiredJob);
  return url.toString();
}

export function parseIncruitSearch(html: string): RawJobPosting[] {
  if (looksBlocked(html)) {
    throw new Error('인크루트가 자동 조회 요청을 제한했습니다.');
  }

  const parts = html.split(/<ul\s+class=["']c_row["']/i).slice(1);
  const postings: RawJobPosting[] = [];

  for (const part of parts) {
    if (postings.length >= 60) break;
    const fragment = part.slice(0, 16_000);
    const sourceId = /\bjobno=["'](\d+)["']/i.exec(fragment)?.[1]
      ?? /\bjob=(\d+)/i.exec(fragment)?.[1];
    if (!sourceId) continue;

    const middle = /class=["'][^"']*\bcell_mid\b[^"']*["'][^>]*>([\s\S]*?)class=["'][^"']*\bcell_last\b/i.exec(fragment)?.[1] ?? fragment;
    const title = cleanText(
      /<a\b[^>]*href=["'][^"']*jobpost\.asp\?[^"']*\bjob=\d+[^"']*["'][^>]*>([\s\S]*?)<\/a>/i.exec(middle)?.[1],
    );
    const company = extractClassText(fragment, 'cpname');
    if (!title || !company) continue;

    const conditionBlock = /class=["'][^"']*\bcl_md\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(middle)?.[1] ?? '';
    const conditions = extractSpanTexts(conditionBlock);
    const lastCell = /class=["'][^"']*\bcell_last\b[^"']*["'][^>]*>([\s\S]*)/i.exec(fragment)?.[1] ?? '';
    const deadlineBlock = /class=["'][^"']*\bcl_btm\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(lastCell)?.[1] ?? '';
    const deadlineTexts = extractSpanTexts(deadlineBlock);

    postings.push({
      source: 'incruit',
      sourceId,
      url: `https://job.incruit.com/jobdb_info/jobpost.asp?job=${sourceId}`,
      title,
      company,
      location: conditions[0] ?? null,
      experience: conditions[1] ?? null,
      education: conditions[2] ?? null,
      employmentType: conditions[3] ?? null,
      deadlineText: deadlineTexts[0] ?? null,
    });
  }

  if (postings.length === 0 && !looksEmpty(html)) {
    throw new Error('인크루트 검색 결과 구조가 변경되어 공고를 읽지 못했습니다.');
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
  return /검색\s*결과가\s*없|조건에\s*맞는\s*채용정보가\s*없|등록된\s*채용공고가\s*없/i.test(cleanText(html));
}

function looksBlocked(html: string): boolean {
  return /captcha|비정상적인\s*접근|접근이\s*제한|robot\s*check/i.test(html);
}
