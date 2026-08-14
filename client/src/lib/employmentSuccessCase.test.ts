import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildClientEmploymentUpdateRecord,
  maskKoreanName,
  searchEmploymentSuccessCases,
  syncEmploymentSuccessCase,
  toAgeDecade,
} from './employmentSuccessCase';
import { STORAGE_KEYS } from './supabase';

beforeEach(() => {
  vi.restoreAllMocks();
  installLocalStorageMock();
  localStorage.clear();
});

function installLocalStorageMock() {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;

  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
}

describe('employmentSuccessCase helpers', () => {
  it('masks Korean names to family-name plus OO', () => {
    expect(maskKoreanName('김민수')).toBe('김OO');
    expect(maskKoreanName(' 박지영 ')).toBe('박OO');
  });

  it('falls back to 익명 for empty names', () => {
    expect(maskKoreanName('')).toBe('익명');
    expect(maskKoreanName(null)).toBe('익명');
  });

  it('converts ages to decade buckets', () => {
    expect(toAgeDecade(24)).toBe('20대');
    expect(toAgeDecade(37)).toBe('30대');
    expect(toAgeDecade(61)).toBe('60대 이상');
  });

  it('returns 연령 미상 for invalid ages', () => {
    expect(toAgeDecade(null)).toBe('연령 미상');
    expect(toAgeDecade(0)).toBe('연령 미상');
  });

  it('normalizes employment snapshot updates into client table columns', () => {
    expect(buildClientEmploymentUpdateRecord({
      participationStage: '취업완료',
      desiredJob1: '백엔드 개발자',
      desiredJob2: '웹 개발자',
      desiredJob3: '',
      employmentType: '정규직',
      employmentCompany: '  제니소프트  ',
      employmentJobType: '서버 개발',
      employmentSalary: '3200만원',
      employmentDate: '2026-03-15T09:12:00+09:00',
      hireDate: '2026/03/16',
    })).toEqual({
      participation_stage: '취업완료',
      desired_job_1: '백엔드 개발자',
      desired_job_2: '웹 개발자',
      desired_job_3: null,
      hire_type: '정규직',
      hire_place: '제니소프트',
      hire_job_type: '서버 개발',
      hire_payment: '3200만원',
      job_place_start: '2026-03-15',
      hire_date: '2026-03-16',
    });
  });

  it('keeps undefined fields out of snapshot update records', () => {
    expect(buildClientEmploymentUpdateRecord({
      employmentCompany: '오픈AI',
    })).toEqual({
      hire_place: '오픈AI',
    });
  });

  it('calls the employment search edge function with the expected payload', async () => {
    localStorage.setItem(STORAGE_KEYS.SUPABASE_URL, 'https://example.supabase.co');
    localStorage.setItem(STORAGE_KEYS.SUPABASE_ANON_KEY, 'anon-key-that-is-long-enough');
    localStorage.setItem(STORAGE_KEYS.OPENAI_API_KEY, 'sk-test-key');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ summary: 'ok', results: [], evaluatedCount: 0, reason: null }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await searchEmploymentSuccessCases(7, 4);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      clientId: 7,
      limit: 4,
      openAIKey: 'sk-test-key',
    });
  });

  it('calls the employment sync edge function with the expected payload', async () => {
    localStorage.setItem(STORAGE_KEYS.SUPABASE_URL, 'https://example.supabase.co');
    localStorage.setItem(STORAGE_KEYS.SUPABASE_ANON_KEY, 'anon-key-that-is-long-enough');
    localStorage.setItem(STORAGE_KEYS.OPENAI_API_KEY, 'sk-test-key');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ status: 'activated', sourceClientId: 7 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await syncEmploymentSuccessCase(7);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      clientId: 7,
      openAIKey: 'sk-test-key',
    });
  });
});
