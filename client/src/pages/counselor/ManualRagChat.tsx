import { useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Bot,
  FileText,
  Loader2,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  User,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  askManualChat,
  makeManualChatMessageId,
  type ManualChatCitation,
  type ManualChatConfidence,
  type ManualChatMessage,
} from '@/lib/manualRag';

const SUGGESTED_QUESTIONS = [
  '구직촉진수당 지급 요건은 무엇인가요?',
  '취업활동계획 수립 절차는 어떻게 되나요?',
  '1유형과 2유형의 지원 내용 차이를 비교해줘',
  '구직촉진수당 부정수급이 확인되면 어떻게 처리하나요?',
];

const CONFIDENCE_LABEL: Record<ManualChatConfidence, string> = {
  high: '근거 높음',
  medium: '근거 보통',
  low: '근거 낮음',
  insufficient: '근거 부족',
};

const CONFIDENCE_CLASS: Record<ManualChatConfidence, string> = {
  high: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  medium: 'border-sky-200 bg-sky-50 text-sky-700',
  low: 'border-amber-200 bg-amber-50 text-amber-700',
  insufficient: 'border-rose-200 bg-rose-50 text-rose-700',
};

export default function ManualRagChatPage() {
  const [messages, setMessages] = useState<ManualChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const latestCitations = useMemo(() => {
    return messages
      .filter(message => message.role === 'assistant' && message.citations?.length)
      .at(-1)?.citations ?? [];
  }, [messages]);

  async function sendQuestion(nextQuestion?: string) {
    const question = (nextQuestion ?? input).trim();
    if (!question || isLoading) return;

    const userMessage: ManualChatMessage = {
      id: makeManualChatMessageId('user'),
      role: 'user',
      content: question,
      createdAt: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await askManualChat({
        question,
        limit: 5,
        minSimilarity: 0.15,
      });

      setMessages(prev => [
        ...prev,
        {
          id: makeManualChatMessageId('assistant'),
          role: 'assistant',
          content: response.answer,
          confidence: response.confidence,
          citations: response.citations,
          reason: response.reason,
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : '답변을 불러오지 못했습니다.';
      toast.error(message);
      setMessages(prev => [
        ...prev,
        {
          id: makeManualChatMessageId('assistant'),
          role: 'assistant',
          content: message,
          confidence: 'insufficient',
          citations: [],
          reason: 'CLIENT_ERROR',
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }

  function resetChat() {
    setMessages([]);
    setInput('');
    inputRef.current?.focus();
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-card px-5 py-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <BookOpen size={20} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">국취제 매뉴얼 도우미</h1>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                국민취업지원제도 업무매뉴얼 PDF를 근거로 답변하고, 사용한 출처를 함께 표시합니다.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={resetChat}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            <RotateCcw size={14} />
            대화 초기화
          </button>
        </div>
      </section>

      <div className="grid min-h-[680px] gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.85fr)]">
        <section className="flex min-h-[680px] flex-col rounded-lg border border-border bg-card shadow-sm">
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {messages.length === 0 ? (
              <div className="flex min-h-[440px] flex-col items-center justify-center gap-5 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Search size={22} />
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-foreground">매뉴얼 질문을 입력하세요</div>
                  <div className="text-xs text-muted-foreground">
                    근거가 부족하면 답변하지 않도록 설계되어 있습니다.
                  </div>
                </div>
                <div className="grid w-full max-w-2xl gap-2 sm:grid-cols-2">
                  {SUGGESTED_QUESTIONS.map(question => (
                    <button
                      key={question}
                      type="button"
                      onClick={() => void sendQuestion(question)}
                      disabled={isLoading}
                      className="min-h-11 rounded-md border border-border bg-background px-3 py-2 text-left text-xs leading-relaxed text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map(message => (
                  <ChatMessage key={message.id} message={message} />
                ))}
                {isLoading && (
                  <div className="flex items-start gap-3">
                    <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Loader2 size={15} className="animate-spin" />
                    </div>
                    <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                      매뉴얼에서 근거를 찾고 답변을 생성하는 중입니다.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <form
            className="border-t border-border p-4"
            onSubmit={event => {
              event.preventDefault();
              void sendQuestion();
            }}
          >
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={event => setInput(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void sendQuestion();
                  }
                }}
                placeholder="예: 구직촉진수당 지급이 중단되는 경우는 무엇인가요?"
                className="min-h-24 flex-1 resize-none rounded-md border border-input bg-background px-4 py-3 text-sm leading-relaxed outline-none transition-shadow focus:ring-2 focus:ring-primary/20"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="inline-flex h-24 w-14 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="질문 보내기"
              >
                {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              </button>
            </div>
          </form>
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              <FileText size={15} className="text-primary" />
              최근 답변 출처
            </div>
            {latestCitations.length === 0 ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                답변이 생성되면 참고한 매뉴얼 청크와 페이지 정보가 표시됩니다.
              </p>
            ) : (
              <div className="space-y-3">
                {latestCitations.map(citation => (
                  <CitationItem key={citation.chunkId} citation={citation} />
                ))}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              <ShieldCheck size={15} className="text-primary" />
              답변 기준
            </div>
            <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
              <p>검색된 매뉴얼 청크 안에 근거가 있을 때만 답변합니다.</p>
              <p>질문과 관련도가 낮은 근거는 답변에서 제외합니다.</p>
              <p>최종 행정 판단에는 원문 확인이 필요합니다.</p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function ChatMessage({ message }: { message: ManualChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex items-start gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Bot size={15} />
        </div>
      )}

      <div className={`max-w-[84%] space-y-2 ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={
            isUser
              ? 'rounded-lg bg-primary px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-primary-foreground'
              : 'rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm leading-relaxed text-foreground'
          }
        >
          {isUser ? message.content : <FormattedAnswer content={message.content} />}
        </div>

        {!isUser && (
          <div className="flex flex-wrap items-center gap-1.5">
            {message.confidence && (
              <div className={`inline-flex rounded-md border px-2 py-1 text-[11px] font-medium ${CONFIDENCE_CLASS[message.confidence]}`}>
                {CONFIDENCE_LABEL[message.confidence]}
              </div>
            )}
            {message.citations?.slice(0, 3).map((citation, index) => (
              <span
                key={citation.chunkId}
                className="inline-flex rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground"
                title={citation.sectionTitle ?? citation.documentTitle}
              >
                근거 {index + 1}{formatPageRange(citation) ? ` · ${formatPageRange(citation)}` : ''}
              </span>
            ))}
          </div>
        )}
      </div>

      {isUser && (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <User size={15} />
        </div>
      )}
    </div>
  );
}

function FormattedAnswer({ content }: { content: string }) {
  const lines = content.split('\n');

  return (
    <div className="space-y-2 whitespace-pre-wrap">
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={index} className="h-1" />;

        const isHeading = /^\*\*.+\*\*:?$/.test(trimmed) || /^[가-힣A-Za-z0-9\s]+:$/.test(trimmed);
        const isList = /^(\d+\.|-|•)\s+/.test(trimmed);

        return (
          <p
            key={index}
            className={
              isHeading
                ? 'font-semibold text-foreground'
                : isList
                  ? 'pl-2'
                  : undefined
            }
          >
            {line}
          </p>
        );
      })}
    </div>
  );
}

function CitationItem({ citation }: { citation: ManualChatCitation }) {
  return (
    <article className="rounded-md border border-border/80 bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-foreground">{citation.documentTitle}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {citation.documentVersion}
            {formatPageRange(citation) ? ` · ${formatPageRange(citation)}` : ''}
          </div>
        </div>
        {citation.finalScore != null && (
          <span className="shrink-0 rounded-md bg-background px-2 py-1 text-[11px] text-muted-foreground">
            {Math.round(citation.finalScore * 100)}%
          </span>
        )}
      </div>
      {citation.sectionTitle && (
        <div className="mt-2 text-[11px] font-medium text-foreground">{citation.sectionTitle}</div>
      )}
      {citation.matchedKeywords && citation.matchedKeywords.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {citation.matchedKeywords.slice(0, 5).map(keyword => (
            <span key={keyword} className="rounded-sm bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {keyword}
            </span>
          ))}
        </div>
      )}
      <p className="mt-2 line-clamp-4 text-xs leading-relaxed text-muted-foreground">
        {citation.excerpt}
      </p>
    </article>
  );
}

function formatPageRange(citation: ManualChatCitation): string | null {
  if (!citation.pageStart && !citation.pageEnd) return null;
  if (citation.pageStart && citation.pageEnd && citation.pageStart !== citation.pageEnd) {
    return `${citation.pageStart}-${citation.pageEnd}쪽`;
  }
  return `${citation.pageStart ?? citation.pageEnd}쪽`;
}
