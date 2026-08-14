import { getSupabaseClient, isSupabaseConfigured } from './supabase';
import type { MergedDocumentProfile } from './summaryAnalysis';

export interface SummaryMatchScoreResult {
  score: number | null;
  reason: string;
  matchedPeerCount: number;
  percentile: number | null;
  comparedJobs: string[];
}

export async function fetchSummaryMatchScore(
  profile: MergedDocumentProfile,
): Promise<SummaryMatchScoreResult> {
  if (!isSupabaseConfigured()) {
    return {
      score: null,
      reason: 'Supabase가 설정되지 않아 DB 비교 점수를 계산할 수 없습니다.',
      matchedPeerCount: 0,
      percentile: null,
      comparedJobs: profile.desiredJobs,
    };
  }

  if (profile.desiredJobs.length === 0) {
    return {
      score: null,
      reason: '희망 직업 정보가 없어 동일 직군 비교를 수행할 수 없습니다.',
      matchedPeerCount: 0,
      percentile: null,
      comparedJobs: [],
    };
  }

  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase client를 초기화할 수 없습니다.');
  }

  const { data, error } = await client.functions.invoke('summary-match-score', {
    body: {
      desiredJobs: profile.desiredJobs,
      certifications: profile.certifications,
      extraSpecs: profile.extraSpecs,
      gender: profile.gender,
    },
  });

  if (error) {
    throw new Error(error.message || 'AI 매칭 점수 계산에 실패했습니다.');
  }

  return {
    score: typeof data?.score === 'number' ? data.score : null,
    reason: typeof data?.reason === 'string' ? data.reason : '점수 설명이 제공되지 않았습니다.',
    matchedPeerCount: typeof data?.matchedPeerCount === 'number' ? data.matchedPeerCount : 0,
    percentile: typeof data?.percentile === 'number' ? data.percentile : null,
    comparedJobs: Array.isArray(data?.comparedJobs)
      ? data.comparedJobs.filter((item: unknown): item is string => typeof item === 'string')
      : profile.desiredJobs,
  };
}
