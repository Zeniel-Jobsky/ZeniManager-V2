import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from './supabase';

export type ManualChatConfidence = 'high' | 'medium' | 'low' | 'insufficient';

export type ManualChatCitation = {
  chunkId: number;
  documentTitle: string;
  documentVersion: string;
  pageStart: number | null;
  pageEnd: number | null;
  sectionTitle: string | null;
  similarity: number | null;
  keywordScore?: number | null;
  keywordHits?: number | null;
  matchedKeywords?: string[];
  finalScore?: number | null;
  excerpt: string;
};

export type ManualChatResponse = {
  answer: string;
  confidence: ManualChatConfidence;
  citations: ManualChatCitation[];
  reason: string | null;
};

export type ManualChatRequest = {
  question: string;
  documentId?: number | null;
  limit?: number;
  minSimilarity?: number;
};

export type ManualChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  confidence?: ManualChatConfidence;
  citations?: ManualChatCitation[];
  reason?: string | null;
};

export function makeManualChatMessageId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function askManualChat(request: ManualChatRequest): Promise<ManualChatResponse> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('Supabase URL과 anon key를 먼저 설정해주세요.');
  }

  return invokeManualChat(supabase, request);
}

async function invokeManualChat(
  supabase: SupabaseClient,
  request: ManualChatRequest,
): Promise<ManualChatResponse> {
  const { data, error } = await supabase.functions.invoke<ManualChatResponse>('manual-chat', {
    body: request,
  });

  if (error) {
    throw new Error(error.message || '국취제 매뉴얼 도우미 호출에 실패했습니다.');
  }

  if (!data?.answer) {
    throw new Error('국취제 매뉴얼 도우미 응답 형식이 올바르지 않습니다.');
  }

  return data;
}
