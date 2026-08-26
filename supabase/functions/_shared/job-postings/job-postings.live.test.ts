import { describe, expect, it } from 'vitest';
import { fetchSourceHtml } from './fetch-source.ts';
import { buildIncruitSearchUrl, parseIncruitSearch } from './incruit.ts';
import { buildJobKoreaSearchUrl, parseJobKoreaSearch } from './jobkorea.ts';
import { normalizeRawPosting } from './normalize.ts';
import { buildSaraminSearchUrl, parseSaraminSearch } from './saramin.ts';
import type { JobSource, RawJobPosting } from './types.ts';

const liveIt = process.env.LIVE_SCRAPE === '1' ? it : it.skip;
const keyword = '백엔드 개발자';

const sources: Array<{
  source: JobSource;
  buildUrl: (value: string) => string;
  parse: (html: string) => RawJobPosting[];
}> = [
  { source: 'jobkorea', buildUrl: buildJobKoreaSearchUrl, parse: parseJobKoreaSearch },
  { source: 'saramin', buildUrl: buildSaraminSearchUrl, parse: parseSaraminSearch },
  { source: 'incruit', buildUrl: buildIncruitSearchUrl, parse: parseIncruitSearch },
];

describe('live public recruitment search smoke tests', () => {
  for (const adapter of sources) {
    liveIt(`${adapter.source} still exposes parseable, active postings`, async () => {
      const html = await fetchSourceHtml(adapter.source, adapter.buildUrl(keyword));
      const raw = adapter.parse(html);
      const active = raw
        .map(posting => normalizeRawPosting(posting, keyword))
        .filter(Boolean);

      expect(raw.length).toBeGreaterThan(0);
      expect(active.length).toBeGreaterThan(0);
    }, 15_000);
  }
});
