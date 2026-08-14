import { executeSupabaseRequest, getSupabaseClient, isSupabaseConfigured } from './supabase';

export type ClientChatRole = 'user' | 'assistant';

export type ClientChatMessage = {
  id: string;
  role: ClientChatRole;
  content: string;
};

type ClientChatHistoryRow = {
  client_id: number;
  messages: unknown;
  updated_at?: string | null;
};

function toNumericClientId(value: string | number): number {
  const clientId = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    throw new Error('유효한 client_id가 필요합니다.');
  }
  return clientId;
}

function normalizeMessages(value: unknown): ClientChatMessage[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item, index) => normalizeMessage(item, index))
    .filter((item): item is ClientChatMessage => Boolean(item));
}

function normalizeMessage(value: unknown, index: number): ClientChatMessage | null {
  if (!value || typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  const role = record.role;
  const content = record.content;

  if (role !== 'user' && role !== 'assistant') return null;
  if (typeof content !== 'string' || !content.trim()) return null;

  return {
    id: `history-${index}-${role}`,
    role,
    content: content.trim(),
  };
}

export async function loadClientChatHistory(clientId: string | number): Promise<ClientChatMessage[]> {
  if (!isSupabaseConfigured()) return [];

  const client = getSupabaseClient();
  if (!client) return [];

  const { data, error } = await executeSupabaseRequest<ClientChatHistoryRow | null>(
    '채팅 히스토리 조회',
    client
      .from('client_chat_history')
      .select('client_id, messages, updated_at')
      .eq('client_id', toNumericClientId(clientId))
      .maybeSingle(),
    { requireStoredSession: true },
  );

  if (error) throw error;
  return normalizeMessages(data?.messages);
}

export async function saveClientChatHistory(
  clientId: string | number,
  messages: ClientChatMessage[],
): Promise<void> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase 설정이 필요합니다.');
  }

  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase client를 초기화할 수 없습니다.');
  }

  const payload = {
    client_id: toNumericClientId(clientId),
    messages: messages.map(({ id: _id, ...message }) => ({
      role: message.role,
      content: message.content.trim(),
    })),
    last_message_at: new Date().toISOString(),
  };

  const { error } = await executeSupabaseRequest(
    '채팅 히스토리 저장',
    client
      .from('client_chat_history')
      .upsert(payload, { onConflict: 'client_id' })
      .select('client_id')
      .single(),
    { requireStoredSession: true },
  );

  if (error) throw error;
}
