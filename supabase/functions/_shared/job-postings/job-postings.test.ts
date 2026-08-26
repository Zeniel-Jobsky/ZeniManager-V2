import { describe, expect, it } from 'vitest';
import { assertAllowedSearchUrl } from './fetch-source.ts';
import { parseIncruitSearch } from './incruit.ts';
import { parseJobKoreaSearch } from './jobkorea.ts';
import {
  deduplicateJobPostings,
  normalizeRawPosting,
  parseKoreanDeadline,
  sanitizeDesiredJob,
  splitDesiredJobs,
} from './normalize.ts';
import { parseSaraminSearch } from './saramin.ts';

const NOW = new Date('2026-08-25T03:00:00.000Z');

describe('job posting source parsers', () => {
  it('parses the public JobKorea mobile search card', () => {
    const html = `
      <div class="section-item bg-white" role="listitem" data-gno="49844375">
        <div class="item-corp_name">㈜범우정보기술</div>
        <div class="item-title">백엔드 &amp; API 개발자</div>
        <span class="item-condition-location">대전 유성구</span>
        <span class="item-condition-applicants">경력2년↑</span>
        <span class="item-condition-dday">D-17</span>
        <a href="/Recruit/GI_Read/49844375?sc=554"></a>
      </div>
    `;

    expect(parseJobKoreaSearch(html)).toEqual([expect.objectContaining({
      source: 'jobkorea',
      sourceId: '49844375',
      title: '백엔드 & API 개발자',
      company: '㈜범우정보기술',
      location: '대전 유성구',
      experience: '경력2년↑',
      deadlineText: 'D-17',
    })]);
  });

  it('parses the underscore classes used by regular JobKorea cards', () => {
    const html = `
      <div class="section-item recruit-item" role="listitem" data-gno="49844376">
        <div class="item-corp_name">일반공고회사</div>
        <div class="item-title">서버 개발자</div>
        <span class="item-condition_location">서울 강남구</span>
        <span class="item-condition_applicants">신입</span>
        <span class="item-condition_dday">D-9</span>
      </div>
    `;

    expect(parseJobKoreaSearch(html)).toEqual([expect.objectContaining({
      sourceId: '49844376',
      location: '서울 강남구',
      experience: '신입',
      deadlineText: 'D-9',
    })]);
  });

  it('parses a Saramin search card', () => {
    const html = `
      <div class="item_recruit" value="54813669">
        <h2 class="job_tit"><a title="백엔드 개발자 (신입)" href="/zf_user/jobs/relay/view?rec_idx=54813669">공고</a></h2>
        <div class="job_date"><span class="date">~ 09/19(토)</span></div>
        <div class="job_condition">
          <span><a>경기</a> <a>성남시 분당구</a></span><span>신입</span><span>대졸↑</span><span>정규직</span>
        </div>
        <span class="job_day">수정일 26/08/21</span>
        <strong class="corp_name"><a>티엔에이치(주)</a></strong>
      </div>
    `;

    expect(parseSaraminSearch(html)).toEqual([expect.objectContaining({
      source: 'saramin',
      sourceId: '54813669',
      title: '백엔드 개발자 (신입)',
      company: '티엔에이치(주)',
      location: '경기 성남시 분당구',
      experience: '신입',
      education: '대졸↑',
      employmentType: '정규직',
      deadlineText: '~ 09/19(토)',
    })]);
  });

  it('parses an EUC-KR-decoded Incruit search card', () => {
    const html = `
      <ul class="c_row" jobno="2608130000457">
        <div class="cell_first"><a class="cpname">주식회사 젠</a></div>
        <div class="cell_mid">
          <div class="cl_top"><a href="https://job.incruit.com/jobdb_info/jobpost.asp?job=2608130000457&amp;src=gsw">PHP 백엔드 개발자 채용</a></div>
          <div class="cl_md"><span>경기 화성시</span><span>신입</span><span>초대졸↑</span><span>정규직</span></div>
          <div class="cl_btm"><span>백엔드개발</span></div>
        </div>
        <div class="cell_last"><div class="cl_btm"><span>~09.12 (토)</span><span>(12일전 등록)</span></div></div>
      </ul>
    `;

    expect(parseIncruitSearch(html)).toEqual([expect.objectContaining({
      source: 'incruit',
      sourceId: '2608130000457',
      title: 'PHP 백엔드 개발자 채용',
      company: '주식회사 젠',
      location: '경기 화성시',
      deadlineText: '~09.12 (토)',
    })]);
  });

  it('treats each portal\'s explicit empty-result marker as a valid empty result', () => {
    expect(parseJobKoreaSearch('<main data-has-search-list="false"></main>')).toEqual([]);
    expect(parseSaraminSearch('<div class="no_result"></div>')).toEqual([]);
    expect(parseIncruitSearch('<p>조건에 맞는 채용정보가 없습니다.</p>')).toEqual([]);
  });
});

describe('deadline filtering', () => {
  it('keeps today and future deadlines while rejecting expired and closed postings', () => {
    expect(parseKoreanDeadline('D-0', NOW).deadline).toBe('2026-08-25');
    expect(parseKoreanDeadline('~ 08/25(화)', NOW).deadline).toBe('2026-08-25');
    expect(parseKoreanDeadline('상시채용', NOW).kind).toBe('always');
    expect(parseKoreanDeadline('채용시', NOW).kind).toBe('until-hired');
    expect(parseKoreanDeadline('접수마감', NOW).closed).toBe(true);
    expect(parseKoreanDeadline('17시 마감', NOW)).toEqual(expect.objectContaining({
      deadline: '2026-08-25',
      closed: false,
    }));
    expect(parseKoreanDeadline('11시 마감', NOW).closed).toBe(true);
    expect(parseKoreanDeadline('09/01 17시 마감', NOW)).toEqual(expect.objectContaining({
      deadline: '2026-09-01',
      deadlineAt: '2026-09-01T08:00:00.000Z',
      closed: false,
    }));

    const base = {
      source: 'saramin' as const,
      sourceId: '1',
      url: 'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=1',
      title: '백엔드 개발자',
      company: '제니엘',
    };

    expect(normalizeRawPosting({ ...base, deadlineText: '~ 08/24' }, '백엔드 개발자', NOW)).toBeNull();
    expect(normalizeRawPosting({ ...base, deadlineText: '~ 08/25' }, '백엔드 개발자', NOW)).not.toBeNull();
    expect(normalizeRawPosting({ ...base, deadlineText: '마감' }, '백엔드 개발자', NOW)).toBeNull();
    expect(normalizeRawPosting({ ...base, deadlineText: null }, '백엔드 개발자', NOW)).toBeNull();
  });

  it('infers the next year only across a distant year boundary', () => {
    const december = new Date('2026-12-31T03:00:00.000Z');
    expect(parseKoreanDeadline('~ 01/02', december).deadline).toBe('2027-01-02');
  });
});

describe('normalization and de-duplication', () => {
  it('merges cross-site duplicates and retains both original links', () => {
    const first = normalizeRawPosting({
      source: 'jobkorea',
      sourceId: '100',
      url: 'https://www.jobkorea.co.kr/Recruit/GI_Read/100',
      title: '백엔드 개발자 채용',
      company: '(주)제니엘',
      location: '서울 강남구',
      deadlineText: 'D-5',
    }, '백엔드 개발자', NOW)!;
    const second = normalizeRawPosting({
      source: 'saramin',
      sourceId: '200',
      url: 'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=200',
      title: '[백엔드 개발자] 모집 (신입)',
      company: '㈜제니엘',
      location: '서울특별시 강남구',
      employmentType: '정규직',
      deadlineText: '~ 08/30',
    }, '백엔드 개발자', NOW)!;

    const result = deduplicateJobPostings([first, second]);
    expect(result).toHaveLength(1);
    expect(result[0].links.map(link => link.source)).toEqual(['saramin', 'jobkorea']);
    expect(result[0].employmentType).toBe('정규직');
  });

  it('does not merge otherwise identical postings in different locations', () => {
    const makePosting = (sourceId: string, location: string) => normalizeRawPosting({
      source: 'jobkorea',
      sourceId,
      url: `https://www.jobkorea.co.kr/Recruit/GI_Read/${sourceId}`,
      title: '물류 관리자 채용',
      company: '제니엘',
      location,
      deadlineText: 'D-3',
    }, '물류 관리자', NOW)!;

    expect(deduplicateJobPostings([
      makePosting('301', '서울 강남구'),
      makePosting('302', '부산 해운대구'),
    ])).toHaveLength(2);
  });

  it('does not fingerprint-merge same-site IDs or cross-site postings with missing locations', () => {
    const makePosting = (
      source: 'jobkorea' | 'saramin',
      sourceId: string,
      location: string | null,
    ) => normalizeRawPosting({
      source,
      sourceId,
      url: source === 'jobkorea'
        ? `https://www.jobkorea.co.kr/Recruit/GI_Read/${sourceId}`
        : `https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=${sourceId}`,
      title: '데이터 엔지니어 채용',
      company: '제니엘',
      location,
      deadlineText: 'D-3',
    }, '데이터 엔지니어', NOW)!;

    expect(deduplicateJobPostings([
      makePosting('saramin', '501', '서울 강남구'),
      makePosting('saramin', '502', '서울 강남구'),
    ])).toHaveLength(2);
    expect(deduplicateJobPostings([
      makePosting('jobkorea', '503', null),
      makePosting('saramin', '504', '서울 강남구'),
    ])).toHaveLength(2);
    expect(deduplicateJobPostings([
      makePosting('jobkorea', '505', '서울 강남구'),
      makePosting('saramin', '506', '부산 해운대구'),
    ])).toHaveLength(2);
  });

  it('keeps deadline fields as one consistent tuple when exact IDs merge', () => {
    const always = normalizeRawPosting({
      source: 'saramin',
      sourceId: '601',
      url: 'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=601',
      title: '플랫폼 개발자',
      company: '제니엘',
      location: '서울 강남구',
      employmentType: '정규직',
      deadlineText: '상시채용',
    }, '플랫폼 개발자', NOW)!;
    const dated = normalizeRawPosting({
      source: 'saramin',
      sourceId: '601',
      url: 'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=601',
      title: '플랫폼 개발자',
      company: '제니엘',
      deadlineText: 'D-3',
    }, '플랫폼 개발자', NOW)!;

    const [merged] = deduplicateJobPostings([always, dated]);
    expect(merged).toEqual(expect.objectContaining({
      deadline: '2026-08-28',
      deadlineAt: '2026-08-28T15:00:00.000Z',
      deadlineKind: 'date',
      deadlineLabel: 'D-3',
    }));
  });

  it('uses the earlier exact closing instant when duplicate dates match', () => {
    const makePosting = (deadlineText: string, withLocation: boolean) => normalizeRawPosting({
      source: 'incruit',
      sourceId: '701',
      url: 'https://job.incruit.com/jobdb_info/jobpost.asp?job=701',
      title: '서비스 개발자',
      company: '제니엘',
      location: withLocation ? '서울 강남구' : null,
      deadlineText,
    }, '서비스 개발자', NOW)!;

    const [merged] = deduplicateJobPostings([
      makePosting('08/25', true),
      makePosting('08/25 17시 마감', false),
    ]);
    expect(merged.deadlineAt).toBe('2026-08-25T08:00:00.000Z');
    expect(merged.deadlineLabel).toBe('08/25 17시 마감');
  });

  it('indexes the richer fingerprint after an exact-ID merge', () => {
    const original = normalizeRawPosting({
      source: 'jobkorea',
      sourceId: '801',
      url: 'https://www.jobkorea.co.kr/Recruit/GI_Read/801',
      title: '서버 개발자',
      company: '제니엘',
      deadlineText: 'D-3',
    }, '개발자', NOW)!;
    const richer = normalizeRawPosting({
      source: 'jobkorea',
      sourceId: '801',
      url: 'https://www.jobkorea.co.kr/Recruit/GI_Read/801',
      title: '백엔드 개발자',
      company: '제니엘',
      location: '서울 강남구',
      employmentType: '정규직',
      deadlineText: 'D-3',
    }, '개발자', NOW)!;
    const otherPortal = normalizeRawPosting({
      source: 'saramin',
      sourceId: '802',
      url: 'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=802',
      title: '백엔드 개발자',
      company: '㈜제니엘',
      location: '서울특별시 강남구',
      deadlineText: 'D-3',
    }, '개발자', NOW)!;

    const result = deduplicateJobPostings([original, richer, otherPortal]);
    expect(result).toHaveLength(1);
    expect(result[0].links.map(link => link.source)).toEqual(['jobkorea', 'saramin']);
  });

  it('does not add a second posting from a source already represented by a merged result', () => {
    const makePosting = (
      source: 'jobkorea' | 'saramin',
      sourceId: string,
      richer = false,
    ) => normalizeRawPosting({
      source,
      sourceId,
      url: source === 'jobkorea'
        ? `https://www.jobkorea.co.kr/Recruit/GI_Read/${sourceId}`
        : `https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=${sourceId}`,
      title: '클라우드 엔지니어',
      company: '제니엘',
      location: '서울 강남구',
      employmentType: richer ? '정규직' : null,
      deadlineText: 'D-3',
    }, '클라우드 엔지니어', NOW)!;

    const result = deduplicateJobPostings([
      makePosting('jobkorea', '901'),
      makePosting('saramin', '902', true),
      makePosting('jobkorea', '903'),
    ]);
    expect(result).toHaveLength(2);
  });

  it('keeps distinct Saramin posting URLs that differ by rec_idx', () => {
    const first = normalizeRawPosting({
      source: 'saramin',
      sourceId: '401',
      url: 'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=401&utm_source=search',
      title: '백엔드 개발자',
      company: '첫번째회사',
      deadlineText: 'D-3',
    }, '개발자', NOW)!;
    const second = normalizeRawPosting({
      source: 'saramin',
      sourceId: '402',
      url: 'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=402&utm_source=search',
      title: '프론트엔드 개발자',
      company: '두번째회사',
      deadlineText: 'D-4',
    }, '개발자', NOW)!;

    expect(deduplicateJobPostings([first, second])).toHaveLength(2);
  });

  it('normalizes and bounds the desired-job query', () => {
    expect(sanitizeDesiredJob('  백엔드\n 개발자  ')).toBe('백엔드 개발자');
    expect(sanitizeDesiredJob('가'.repeat(100))).toHaveLength(80);
    expect(sanitizeDesiredJob('010-1234-5678')).toBe('');
    expect(sanitizeDesiredJob('person@example.com')).toBe('');
    expect(splitDesiredJobs('백엔드 개발자, 데이터 엔지니어, 백엔드 개발자')).toEqual([
      '백엔드 개발자',
      '데이터 엔지니어',
    ]);
    expect(splitDesiredJobs('가'.repeat(513))).toEqual([]);
  });
});

describe('outbound search URL allowlist', () => {
  it('accepts only the exact HTTPS host and standard port for each source', () => {
    expect(() => assertAllowedSearchUrl(
      'saramin',
      new URL('https://www.saramin.co.kr/zf_user/search/recruit?searchword=개발자'),
    )).not.toThrow();
    expect(() => assertAllowedSearchUrl(
      'saramin',
      new URL('https://www.saramin.co.kr.evil.example/search'),
    )).toThrow();
    expect(() => assertAllowedSearchUrl(
      'saramin',
      new URL('https://www.saramin.co.kr:444/search'),
    )).toThrow();
    expect(() => assertAllowedSearchUrl(
      'saramin',
      new URL('https://user:secret@www.saramin.co.kr/search'),
    )).toThrow();
  });
});
