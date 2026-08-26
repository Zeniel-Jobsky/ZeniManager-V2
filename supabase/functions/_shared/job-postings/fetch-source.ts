import type { JobSource } from './types.ts';

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const SOURCE_TIMEOUT_MS = 9_000;
const MAX_REDIRECTS = 3;

const ALLOWED_SEARCH_HOSTS: Record<JobSource, Set<string>> = {
  jobkorea: new Set(['m.jobkorea.co.kr']),
  saramin: new Set(['www.saramin.co.kr', 'www2.saramin.co.kr']),
  incruit: new Set(['job.incruit.com']),
};

export async function fetchSourceHtml(source: JobSource, initialUrl: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);

  try {
    let currentUrl = new URL(initialUrl);

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      assertAllowedSearchUrl(source, currentUrl);
      const response = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'ko-KR,ko;q=0.9',
          'User-Agent': 'Mozilla/5.0 (compatible; ZeniManager/1.0; +https://www.zeniel.com)',
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => undefined);
        if (!location || redirectCount === MAX_REDIRECTS) {
          throw new Error(`${source} 검색 요청의 리디렉션을 완료하지 못했습니다.`);
        }
        currentUrl = new URL(location, currentUrl);
        continue;
      }

      if (response.status === 403 || response.status === 429) {
        throw new Error(`${source}가 자동 조회 요청을 일시적으로 제한했습니다.`);
      }

      if (!response.ok) {
        throw new Error(`${source} 검색 요청이 HTTP ${response.status}로 실패했습니다.`);
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        throw new Error(`${source}에서 HTML이 아닌 응답을 반환했습니다.`);
      }

      const bytes = await readLimitedBody(response, MAX_RESPONSE_BYTES);
      return decodeBytes(bytes, contentType, source);
    }

    throw new Error(`${source} 검색 요청을 완료하지 못했습니다.`);
  } catch (error) {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
      throw new Error(`${source} 검색 요청 시간이 초과되었습니다.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function assertAllowedSearchUrl(source: JobSource, url: URL): void {
  if (
    url.protocol !== 'https:'
    || (url.port !== '' && url.port !== '443')
    || Boolean(url.username || url.password)
    || !ALLOWED_SEARCH_HOSTS[source].has(url.hostname.toLowerCase())
  ) {
    throw new Error(`${source} 검색 요청 URL이 허용된 도메인이 아닙니다.`);
  }
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error('채용 검색 응답이 허용 크기를 초과했습니다.');
  }

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error('채용 검색 응답이 허용 크기를 초과했습니다.');
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error('채용 검색 응답이 허용 크기를 초과했습니다.');
    }
    chunks.push(value);
  }

  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function decodeBytes(bytes: Uint8Array, contentType: string, source: JobSource): string {
  const declaredCharset = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(contentType)?.[1]?.toLowerCase();
  const charset = declaredCharset || (source === 'incruit' ? 'euc-kr' : 'utf-8');

  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}
