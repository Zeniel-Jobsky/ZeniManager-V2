import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  configured: true,
  userId: 'counselor-1',
}));

vi.mock('./supabase', () => ({
  isSupabaseConfigured: () => mocks.configured,
  getSupabaseUrl: () => 'https://project.supabase.co',
  getSupabaseClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: mocks.userId } } } }) },
    functions: { invoke: mocks.invoke },
  }),
}));

import {
  clearJobRecommendationCache,
  fetchJobRecommendations,
  isAllowedJobPostingUrl,
} from './jobRecommendations';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-25T03:00:00.000Z'));
  mocks.invoke.mockReset();
  mocks.configured = true;
  mocks.userId = 'counselor-1';
  clearJobRecommendationCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('fetchJobRecommendations', () => {
  it('calls the authenticated Edge Function with only the client UUID', async () => {
    mocks.invoke.mockResolvedValue({
      data: responseFixture(),
      error: null,
    });

    await fetchJobRecommendations('329f321e-735b-4ed1-9b51-24f397abbb95', {
      expectedDesiredJob: '백엔드 개발자',
    });

    expect(mocks.invoke).toHaveBeenCalledWith('recommend-job-postings', {
      body: { clientId: '329f321e-735b-4ed1-9b51-24f397abbb95' },
    });
  });

  it('uses the short-lived cache for the same client and desired job', async () => {
    mocks.invoke.mockResolvedValue({ data: responseFixture(), error: null });

    await fetchJobRecommendations('client-1', { expectedDesiredJob: '백엔드 개발자' });
    await fetchJobRecommendations('client-1', { expectedDesiredJob: ' 백엔드   개발자 ' });

    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it('passes an explicit refresh flag when force bypasses the local cache', async () => {
    mocks.invoke.mockResolvedValue({ data: responseFixture(), error: null });

    await fetchJobRecommendations('client-1');
    await fetchJobRecommendations('client-1', { force: true });

    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.invoke).toHaveBeenLastCalledWith('recommend-job-postings', {
      body: { clientId: 'client-1', refresh: true },
    });
  });

  it('does not share cached recommendations across signed-in users', async () => {
    mocks.invoke.mockResolvedValue({ data: responseFixture(), error: null });

    await fetchJobRecommendations('client-1', { expectedDesiredJob: '백엔드 개발자' });
    mocks.userId = 'counselor-2';
    await fetchJobRecommendations('client-1', { expectedDesiredJob: '백엔드 개발자' });

    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it('removes a cached posting after its exact closing instant', async () => {
    const fixture = responseFixture();
    fixture.results[0].deadline = '2026-08-25';
    fixture.results[0].deadlineAt = '2026-08-25T03:05:00.000Z';
    mocks.invoke.mockResolvedValue({ data: fixture, error: null });

    const initial = await fetchJobRecommendations('client-1');
    expect(initial.results).toHaveLength(1);
    vi.setSystemTime(new Date('2026-08-25T03:06:00.000Z'));
    const cached = await fetchJobRecommendations('client-1');
    expect(cached.results).toEqual([]);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it('shows the Korean error returned by a non-2xx Edge response', async () => {
    const error = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response(JSON.stringify({ error: '희망직종이 입력되지 않았습니다.' }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      }),
    });
    mocks.invoke.mockResolvedValue({ data: null, error });

    await expect(fetchJobRecommendations('client-1')).rejects.toThrow('희망직종이 입력되지 않았습니다.');
  });

  it('drops links outside the three allowed recruitment domains', async () => {
    const fixture = responseFixture();
    fixture.results.push({
      ...fixture.results[0],
      id: 'bad:1',
      url: 'https://evil.example/jobs/1',
    });
    mocks.invoke.mockResolvedValue({ data: fixture, error: null });

    const response = await fetchJobRecommendations('client-2');
    expect(response.results).toHaveLength(1);
    expect(isAllowedJobPostingUrl('jobkorea', 'https://evil.example/jobs/1')).toBe(false);
  });
});

function responseFixture() {
  return {
    desiredJob: '백엔드 개발자',
    fetchedAt: '2026-08-25T03:00:00.000Z',
    partial: false,
    results: [{
      id: 'jobkorea:1',
      source: 'jobkorea',
      sourceLabel: '잡코리아',
      sourceId: '1',
      url: 'https://www.jobkorea.co.kr/Recruit/GI_Read/1',
      title: '백엔드 개발자',
      company: '제니엘',
      location: '서울',
      employmentType: '정규직',
      experience: '경력무관',
      education: '학력무관',
      postedAt: '2026-08-24',
      deadline: '2026-09-10',
      deadlineAt: '2026-09-10T15:00:00.000Z',
      deadlineLabel: 'D-16',
      deadlineKind: 'date',
      matchedDesiredJob: '백엔드 개발자',
      links: [{
        source: 'jobkorea',
        sourceLabel: '잡코리아',
        url: 'https://www.jobkorea.co.kr/Recruit/GI_Read/1',
      }],
    }],
    sources: [{
      source: 'jobkorea',
      sourceLabel: '잡코리아',
      status: 'success',
      fetched: 1,
      returned: 1,
      excludedExpired: 0,
      excludedDuplicate: 0,
    }],
  };
}
