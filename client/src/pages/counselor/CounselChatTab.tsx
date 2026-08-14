import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Loader2, RefreshCw, Send, ShieldAlert, Sparkles, User } from 'lucide-react';
import { toast } from 'sonner';
import { getOpenAIKey, isSupabaseConfigured } from '@/lib/supabase';
import {
  loadClientChatHistory,
  saveClientChatHistory,
  type ClientChatMessage,
} from '@/lib/clientChatHistory';
import {
  searchEmploymentSuccessCases,
  type EmploymentSuccessCaseMatch,
  type EmploymentSuccessCaseSearchResponse,
} from '@/lib/employmentSuccessCase';
import type { ClientRow } from '@/lib/supabase';

const CHAT_MODEL = 'gpt-4o-mini';

const OUT_OF_SCOPE_PATTERNS = [
  '날씨',
  '주식',
  '코드',
  '프로그래밍',
  '번역',
  '요리',
  '뉴스',
  '정치',
  '종교',
  '소설',
  '게임',
  '운세',
  '연예',
  '스포츠',
  '수학 문제',
];

function makeId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeQuestion(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isClearlyOutOfScope(question: string): boolean {
  const normalized = question.toLowerCase();
  return OUT_OF_SCOPE_PATTERNS.some(pattern => normalized.includes(pattern.toLowerCase()));
}

function formatEmploymentCase(result: EmploymentSuccessCaseMatch, index: number): string {
  return [
    `${index + 1}. ${result.maskedClientName} · ${result.ageDecade}`,
    `학력: ${result.educationLevel ?? '미상'} / 전공: ${result.major ?? '미상'}`,
    `취업처: ${result.employmentCompany}${result.employmentJobType ? ` / 직무: ${result.employmentJobType}` : ''}${result.employmentType ? ` / 형태: ${result.employmentType}` : ''}`,
    `근거: ${result.matchReason}`,
  ].join('\n');
}

function buildClientProfileSummary(client: ClientRow): string {
  const lines = [
    `연령: ${client.age ?? '미상'}`,
    `성별: ${client.gender ?? '미상'}`,
    `최종학력: ${client.education_level ?? '미상'}`,
    `학교명: ${client.school_name ?? '미상'}`,
    `전공: ${client.major ?? '미상'}`,
    `사업유형: ${client.business_type ?? '미상'}`,
    `참여유형: ${client.participation_type ?? '미상'}`,
    `참여단계: ${client.participation_stage ?? '미상'}`,
    `희망직종: ${[client.desired_job_1, client.desired_job_2, client.desired_job_3].filter(Boolean).join(', ') || '미상'}`,
    `희망지역: ${[client.desired_area_1, client.desired_area_2, client.desired_area_3].filter(Boolean).join(', ') || '미상'}`,
    `희망금액: ${client.desired_payment ?? '미상'}`,
    `자차/운전: ${client.has_car ? '자차 있음' : '자차 없음'} / ${client.can_drive ? '운전 가능' : '운전 정보 없음'}`,
    `내일배움카드: ${client.future_card_stat ? '있음' : '없음'}`,
    `이메일: ${client.email ?? '미상'}`,
    `주소: ${[client.address_1, client.address_2].filter(Boolean).join(' ') || '미상'}`,
    `자격증: ${client.certifications ?? '미상'}`,
    `상담 메모: ${client.counsel_notes ?? '미상'}`,
  ];

  return lines.join('\n');
}

function buildSystemPrompt(): string {
  return [
    'You are a Korean counseling retrieval assistant inside a counselor dashboard.',
    'Answer only about the current client profile, job-search/counseling guidance, and retrieved employment-success-case evidence.',
    'Never reveal, repeat, infer, or request resident registration numbers, legal names, or phone numbers.',
    'If a question is unrelated to counseling or the client profile, refuse briefly and redirect to supported questions.',
    'If the retrieved context does not support the answer, say so instead of guessing.',
    'Keep the answer concise, factual, and practical in Korean.',
    'Do not invent sources or pretend to have searched beyond the supplied context.',
  ].join(' ');
}

function buildUserPrompt(
  question: string,
  client: ClientRow,
  searchResponse: EmploymentSuccessCaseSearchResponse | null,
): string {
  const similarCases = searchResponse?.results.length
    ? searchResponse.results.map((result, index) => formatEmploymentCase(result, index)).join('\n\n')
    : '유사 취업 성공사례 검색 결과가 없습니다.';

  return [
    JSON.stringify({
      task: 'Answer the counselor question using only the supplied profile and retrieved case context.',
      question,
      allowedTopics: [
        'client profile summary',
        'employment guidance',
        'career counseling',
        'similar success cases',
        'profile-based search and recommendation',
      ],
      blockedTopics: [
        'resident registration number',
        'full name',
        'phone number',
        'unrelated general chat',
      ],
    }, null, 2),
    '',
    'Client profile (non-sensitive summary):',
    buildClientProfileSummary(client),
    '',
    'Similarity search summary:',
    searchResponse?.summary ?? '검색 요약 없음',
    '',
    'Similar employment success cases:',
    similarCases,
  ].join('\n');
}

const WELCOME_MESSAGE = [
  '이 탭에서는 내담자 비식별 프로필과 유사 취업 성공사례를 바탕으로만 답변합니다.',
  '예: "이 내담자의 핵심 강점", "유사 성공사례", "다음 상담 포인트"',
].join(' ');

function toAssistantMessage(content: string): ClientChatMessage {
  return {
    id: makeId('assistant'),
    role: 'assistant',
    content: content.trim(),
  };
}

function toUserMessage(content: string): ClientChatMessage {
  return {
    id: makeId('user'),
    role: 'user',
    content: content.trim(),
  };
}

export function CounselChatTab({ client }: { client: ClientRow }) {
  const [messages, setMessages] = useState<ClientChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historySaving, setHistorySaving] = useState(false);
  const [searchResponse, setSearchResponse] = useState<EmploymentSuccessCaseSearchResponse | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const openAIKey = getOpenAIKey();

  const canChat = Boolean(openAIKey);

  const persistHistory = useCallback(async (nextMessages: ClientChatMessage[]) => {
    if (!isSupabaseConfigured()) return;

    setHistorySaving(true);
    try {
      await saveClientChatHistory(client.id, nextMessages);
      setLastSavedAt(new Date().toISOString());
    } catch (error: any) {
      toast.error(error?.message || '대화 기록 저장에 실패했습니다.');
    } finally {
      setHistorySaving(false);
    }
  }, [client.id]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setHistoryLoading(true);
      try {
        const savedMessages = await loadClientChatHistory(client.id);
        if (cancelled) return;
        setMessages(savedMessages);
      } catch (error: any) {
        if (!cancelled) {
          toast.error(error?.message || '대화 기록을 불러오지 못했습니다.');
        }
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [client.id]);

  const refreshContext = useCallback(async (showToast = true) => {
    if (!isSupabaseConfigured()) {
      setSearchResponse({
        summary: 'Supabase가 설정되지 않아 성공사례 검색을 건너뜁니다.',
        results: [],
        evaluatedCount: 0,
        reason: 'SUPABASE_NOT_CONFIGURED',
      });
      return;
    }

    if (!canChat) {
      setSearchResponse({
        summary: 'OpenAI API Key가 설정되어야 유사 취업사례를 검색할 수 있습니다.',
        results: [],
        evaluatedCount: 0,
        reason: 'OPENAI_KEY_MISSING',
      });
      return;
    }

    setIsRefreshing(true);
    try {
      const response = await searchEmploymentSuccessCases(client.id, 5);
      setSearchResponse(response);
      setLastSyncedAt(new Date().toISOString());
      if (showToast) {
        toast.success('성공사례 검색 컨텍스트를 갱신했습니다.');
      }
    } catch (error: any) {
      const message = error?.message || '챗봇 컨텍스트 갱신에 실패했습니다.';
      if (showToast) {
        toast.error(message);
      }
      setSearchResponse(prev => prev ?? {
        summary: message,
        results: [],
        evaluatedCount: 0,
        reason: 'SYNC_FAILED',
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [canChat, client.id]);

  useEffect(() => {
    if (!canChat) return;
    void refreshContext(false);
  }, [canChat, refreshContext]);

  const assistantNotice = useMemo(() => {
    if (canChat) return null;
    return '설정에서 OpenAI API Key를 등록해야 챗봇을 사용할 수 있습니다.';
  }, [canChat]);

  const sendMessage = useCallback(async (rawInput?: string) => {
    const text = normalizeQuestion(rawInput ?? input);
    if (!text || isLoading || historyLoading) return;

    if (!canChat || !openAIKey) {
      toast.error('OpenAI API Key가 설정되지 않아 답변할 수 없습니다.');
      return;
    }

    const nextAfterUser = [...messages, toUserMessage(text)];
    setMessages(nextAfterUser);
    setInput('');
    await persistHistory(nextAfterUser);

    if (isClearlyOutOfScope(text)) {
      const nextAfterAssistant = [
        ...nextAfterUser,
        toAssistantMessage('이 챗봇은 내담자 상담 정보와 유사 취업 성공사례 검색만 지원합니다. 주민등록번호, 이름, 전화번호 문의나 다른 주제는 답변하지 않습니다.'),
      ];
      setMessages(nextAfterAssistant);
      await persistHistory(nextAfterAssistant);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openAIKey}`,
        },
        body: JSON.stringify({
          model: CHAT_MODEL,
          temperature: 0.2,
          top_p: 1,
          messages: [
            { role: 'system', content: buildSystemPrompt() },
            { role: 'user', content: buildUserPrompt(text, client, searchResponse) },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI 요청 실패 (${response.status})`);
      }

      const data = await response.json();
      const reply = data?.choices?.[0]?.message?.content;
      if (!reply) {
        throw new Error('OpenAI 응답이 비어 있습니다.');
      }

      const nextAfterAssistant = [
        ...nextAfterUser,
        toAssistantMessage(String(reply)),
      ];
      setMessages(nextAfterAssistant);
      await persistHistory(nextAfterAssistant);
    } catch (error: any) {
      const message = error?.message || '챗봇 응답 생성에 실패했습니다.';
      const nextAfterAssistant = [...nextAfterUser, toAssistantMessage(message)];
      setMessages(nextAfterAssistant);
      await persistHistory(nextAfterAssistant);
    } finally {
      setIsLoading(false);
    }
  }, [canChat, client, historyLoading, input, isLoading, messages, openAIKey, persistHistory, searchResponse]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-gradient-to-br from-white to-emerald-50/40 p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Bot size={16} className="text-primary" />
              상담 챗봇
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              이름, 주민등록번호, 전화번호를 제외한 내담자 정보를 기반으로 상담 질문에 답하고,
              유사 취업 성공사례를 함께 참고합니다.
            </p>
            {assistantNotice && (
              <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-medium text-amber-800">
                <ShieldAlert size={12} />
                {assistantNotice}
              </div>
            )}
            <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
              {lastSavedAt && <span>저장됨: {new Date(lastSavedAt).toLocaleString('ko-KR')}</span>}
              {lastSyncedAt && <span>갱신됨: {new Date(lastSyncedAt).toLocaleString('ko-KR')}</span>}
              {historySaving && <span>저장 중...</span>}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshContext()}
              disabled={isRefreshing || historyLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRefreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              성공사례 갱신
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)]">
        <div className="rounded-xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-4 py-3">
            <div className="text-sm font-semibold text-foreground">대화 기록</div>
            <div className="text-xs text-muted-foreground">
              상담 질문을 입력하면 관련 프로필과 유사 사례를 바탕으로 답변합니다.
            </div>
          </div>

          <div className="max-h-[560px] space-y-4 overflow-y-auto p-4">
            {historyLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={18} className="animate-spin text-muted-foreground" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex min-h-[260px] flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Sparkles size={18} />
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-foreground">아직 대화 기록이 없습니다</div>
                  <div className="text-xs leading-relaxed text-muted-foreground">{WELCOME_MESSAGE}</div>
                </div>
              </div>
            ) : (
              messages.map(message => (
                <div
                  key={message.id}
                  className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {message.role === 'assistant' && (
                    <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Sparkles size={14} />
                    </div>
                  )}
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                      message.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'border border-border bg-muted/40 text-foreground'
                    }`}
                  >
                    {message.content}
                  </div>
                  {message.role === 'user' && (
                    <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <User size={14} />
                    </div>
                  )}
                </div>
              ))
            )}

            {isLoading && (
              <div className="flex gap-3">
                <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Loader2 size={14} className="animate-spin" />
                </div>
                <div className="rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                  답변 생성 중...
                </div>
              </div>
            )}
          </div>

          <form
            className="border-t border-border p-4"
            onSubmit={e => {
              e.preventDefault();
              void sendMessage();
            }}
          >
            <div className="flex gap-2">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder="예: 이 내담자의 핵심 강점과 다음 상담 포인트를 알려줘"
                className="min-h-[96px] flex-1 resize-none rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-primary/20"
                disabled={historyLoading}
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim() || historyLoading}
                className="inline-flex h-[96px] min-w-[56px] items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              </button>
            </div>
          </form>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Bot size={15} className="text-primary" />
              비식별 프로필 요약
            </div>
            <div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
              {buildClientProfileSummary(client).split('\n').map(line => (
                <div key={line}>{line}</div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Sparkles size={15} className="text-primary" />
                유사 성공사례
              </div>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                {searchResponse?.results.length ?? 0}건
              </span>
            </div>
            <div className="text-xs leading-relaxed text-muted-foreground">
              {searchResponse?.summary ?? '성공사례 검색을 아직 실행하지 않았습니다.'}
            </div>
            <div className="mt-4 space-y-3">
              {(searchResponse?.results ?? []).map((result, index) => (
                <div key={result.id} className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  <div className="text-xs font-semibold text-foreground">
                    {index + 1}. {result.maskedClientName} · {result.ageDecade}
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    학력: {result.educationLevel ?? '미상'} / 전공: {result.major ?? '미상'}
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    취업처: {result.employmentCompany}
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {result.matchReason}
                  </div>
                </div>
              ))}
              {(searchResponse?.results.length ?? 0) === 0 && (
                <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                  아직 보여줄 유사 사례가 없습니다.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
