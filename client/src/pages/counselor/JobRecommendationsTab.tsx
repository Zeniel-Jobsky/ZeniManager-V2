import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ExternalLink,
  GraduationCap,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  UserRoundSearch,
} from 'lucide-react';
import type { ClientRow } from '@/lib/supabase';
import {
  fetchJobRecommendations,
  JOB_SOURCES,
  type JobPostingRecommendation,
  type JobRecommendationResponse,
  type JobSource,
} from '@/lib/jobRecommendations';

const PRIMARY = '#009C64';

const SOURCE_STYLES: Record<JobSource, string> = {
  jobkorea: 'border-blue-200 bg-blue-50 text-blue-700',
  saramin: 'border-violet-200 bg-violet-50 text-violet-700',
  incruit: 'border-orange-200 bg-orange-50 text-orange-700',
};

type SourceFilter = 'all' | JobSource;

export function JobRecommendationsTab({ client }: { client: ClientRow }) {
  const desiredJob = client.desired_job?.trim() ?? '';
  const [response, setResponse] = useState<JobRecommendationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const requestVersion = useRef(0);
  const displayedDesiredJob = response?.desiredJob || desiredJob;

  const loadRecommendations = useCallback(async (force = false) => {
    if (!desiredJob) return;
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);

    try {
      const next = await fetchJobRecommendations(client.id, {
        expectedDesiredJob: desiredJob,
        force,
      });
      if (requestVersion.current === version) {
        setResponse(next);
        setSourceFilter('all');
      }
    } catch (loadError) {
      if (requestVersion.current === version) {
        setError(loadError instanceof Error ? loadError.message : '채용공고 추천 조회에 실패했습니다.');
      }
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  }, [client.id, desiredJob]);

  useEffect(() => {
    setResponse(null);
    setError(null);
    setSourceFilter('all');
    if (desiredJob) void loadRecommendations(false);

    return () => {
      requestVersion.current += 1;
    };
  }, [client.id, desiredJob, loadRecommendations]);

  const filteredResults = useMemo(() => {
    const results = response?.results ?? [];
    if (sourceFilter === 'all') return results;
    return results.filter(item => item.links.some(link => link.source === sourceFilter));
  }, [response, sourceFilter]);

  if (!desiredJob) {
    return (
      <section className="flex min-h-[420px] items-center justify-center animate-in fade-in duration-300">
        <div className="max-w-lg rounded-xl border border-dashed border-border bg-muted/10 px-8 py-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <AlertCircle size={23} />
          </div>
          <h3 className="mt-4 text-base font-semibold text-foreground">희망직종을 먼저 입력해주세요</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            대시보드 탭의 희망직종을 입력하면 잡코리아, 사람인, 인크루트에서 현재 지원 가능한 공고를 추천합니다.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-5 animate-in fade-in slide-in-from-right-2 duration-300">
      <header className="rounded-xl border border-border bg-muted/10 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-base font-semibold text-foreground">
              <BriefcaseBusiness size={18} style={{ color: PRIMARY }} />
              채용공고 추천
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Supabase에 저장된 희망직종을 기준으로 3개 채용사이트의 공개 공고를 검색합니다.
              중복 공고와 이미 마감된 공고는 결과에서 제외됩니다.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">희망직종</span>
              <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                {displayedDesiredJob}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadRecommendations(true)}
            disabled={loading}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
            style={{ backgroundColor: PRIMARY }}
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            {loading ? '검색 중...' : response ? '새로고침' : '공고 검색'}
          </button>
        </div>
      </header>

      {loading && !response && <JobRecommendationSkeleton />}

      {error && !response && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-600" />
            <div className="flex-1">
              <div className="text-sm font-semibold text-red-800">채용공고를 불러오지 못했습니다</div>
              <p className="mt-1 text-sm leading-6 text-red-700">{error}</p>
            </div>
            <button
              type="button"
              onClick={() => void loadRecommendations(true)}
              className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700"
            >
              다시 시도
            </button>
          </div>
        </div>
      )}

      {response && (
        <>
          {response.partial && (
            <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              일부 사이트의 응답이 없어 조회된 사이트의 공고만 표시합니다.
            </div>
          )}

          {error && (
            <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              새로고침에 실패해 직전에 조회한 결과를 표시합니다. {error}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2" role="group" aria-label="채용사이트 필터">
              <SourceFilterButton
                active={sourceFilter === 'all'}
                label="전체"
                count={response.results.length}
                onClick={() => setSourceFilter('all')}
              />
              {JOB_SOURCES.map(source => {
                const diagnostic = response.sources.find(item => item.source === source);
                return (
                  <SourceFilterButton
                    key={source}
                    active={sourceFilter === source}
                    label={diagnostic?.sourceLabel ?? source}
                    count={diagnostic?.returned ?? 0}
                    failed={diagnostic?.status === 'error'}
                    title={diagnostic?.message}
                    onClick={() => setSourceFilter(source)}
                  />
                );
              })}
            </div>
            <div className="text-xs text-muted-foreground">
              {formatFetchedAt(response.fetchedAt)} 기준
            </div>
          </div>

          {filteredResults.length > 0 ? (
            <div className="grid gap-3 xl:grid-cols-2" aria-live="polite">
              {filteredResults.map(item => (
                <JobRecommendationCard key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-muted/10 px-6 py-14 text-center">
              <Search size={28} className="mx-auto text-muted-foreground/50" />
              <h3 className="mt-3 text-sm font-semibold text-foreground">현재 추천할 수 있는 공고가 없습니다</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                선택한 사이트에서 마감 전 공고를 찾지 못했습니다. 잠시 후 새로고침해 주세요.
              </p>
            </div>
          )}

          <p className="text-center text-xs leading-5 text-muted-foreground">
            공개 검색 결과는 각 채용사이트에서 변경될 수 있으므로 지원 전에 원문 공고의 접수 상태를 다시 확인해주세요.
          </p>
        </>
      )}
    </section>
  );
}

function JobRecommendationCard({ item }: { item: JobPostingRecommendation }) {
  const metadata = [
    item.location ? { icon: MapPin, label: item.location } : null,
    item.experience ? { icon: UserRoundSearch, label: item.experience } : null,
    item.education ? { icon: GraduationCap, label: item.education } : null,
    item.employmentType ? { icon: BriefcaseBusiness, label: item.employmentType } : null,
  ].filter((value): value is { icon: typeof MapPin; label: string } => Boolean(value));

  return (
    <article className="flex h-full flex-col rounded-xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-primary/30">
      <div className="flex items-start justify-between gap-3">
        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${SOURCE_STYLES[item.source]}`}>
          {item.sourceLabel}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
          <CalendarDays size={12} />
          {formatDeadline(item)}
        </span>
      </div>

      <h3 className="mt-4 text-[15px] font-semibold leading-6 text-foreground">{item.title}</h3>
      <div className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
        <Building2 size={14} className="shrink-0" />
        <span className="truncate">{item.company}</span>
      </div>

      {metadata.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-border/60 pt-4">
          {metadata.map(({ icon: Icon, label }, index) => (
            <span key={`${label}-${index}`} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon size={13} />
              {label}
            </span>
          ))}
        </div>
      )}

      {item.matchedDesiredJob && (
        <div className="mt-3 text-[11px] text-muted-foreground">
          검색 희망직종: <span className="font-medium text-foreground">{item.matchedDesiredJob}</span>
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
        {item.links.map(link => (
          <a
            key={`${link.source}-${link.url}`}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:border-primary/40 hover:text-primary"
            aria-label={`${link.sourceLabel}에서 ${item.title} 공고 보기`}
          >
            {link.sourceLabel}에서 보기
            <ExternalLink size={12} />
          </a>
        ))}
      </div>
    </article>
  );
}

function SourceFilterButton({
  active,
  label,
  count,
  failed = false,
  title,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  failed?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={failed}
      aria-pressed={active}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        active
          ? 'border-primary bg-primary text-white'
          : 'border-border bg-background text-muted-foreground hover:border-primary/30 hover:text-foreground'
      }`}
    >
      {label}
      {failed ? (
        <AlertCircle size={12} className={active ? 'text-white' : 'text-amber-500'} />
      ) : (
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${active ? 'bg-white/20' : 'bg-muted'}`}>{count}</span>
      )}
    </button>
  );
}

function JobRecommendationSkeleton() {
  return (
    <div className="grid gap-3 xl:grid-cols-2" role="status" aria-live="polite" aria-label="채용공고를 불러오는 중">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="h-52 animate-pulse rounded-xl border border-border bg-muted/20" />
      ))}
    </div>
  );
}

function formatDeadline(item: JobPostingRecommendation): string {
  if (item.deadlineKind === 'always') return '상시채용';
  if (item.deadlineKind === 'until-hired') return '채용시 마감';
  if (/\d{1,2}\s*시\s*마감/.test(item.deadlineLabel)) return item.deadlineLabel;
  if (item.deadline) return `~ ${item.deadline.replaceAll('-', '.')}`;
  return item.deadlineLabel || '마감일 확인';
}

function formatFetchedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '최근 조회';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
