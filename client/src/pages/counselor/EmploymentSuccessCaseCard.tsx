import { useEffect, useState } from 'react';
import { BriefcaseBusiness, Loader2, Search, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import {
  searchEmploymentSuccessCases,
  type EmploymentSuccessCaseMatch,
  type EmploymentSuccessCaseSearchResponse,
} from '@/lib/employmentSuccessCase';

const PRIMARY = '#009C64';

export function EmploymentSuccessCaseCard({ clientId }: { clientId: string }) {
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<EmploymentSuccessCaseSearchResponse | null>(null);

  useEffect(() => {
    setResponse(null);
  }, [clientId]);

  const handleSearch = async () => {
    setLoading(true);
    try {
      const next = await searchEmploymentSuccessCases(clientId, 3);
      setResponse(next);

      if (next.results.length === 0) {
        toast.info(next.summary);
      } else {
        toast.success('유사 취업사례를 불러왔습니다.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '유사 취업사례 검색에 실패했습니다.';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="mb-6 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Sparkles size={16} style={{ color: PRIMARY }} />
            유사 취업사례 검색
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            현재 상담자와 유사한 배경의 취업 성공사례를 마스킹된 형태로 찾아 상담 중 참고할 수 있습니다.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSearch}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          style={{ backgroundColor: PRIMARY }}
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          {loading ? '검색 중...' : '유사 취업사례 검색'}
        </button>
      </div>

      {response && (
        <div className="mt-5 space-y-4">
          <div className="rounded-lg bg-muted/20 p-4 text-sm leading-6 text-foreground">
            {response.summary}
          </div>

          {response.results.length > 0 ? (
            <div className="grid gap-3">
              {response.results.map(item => (
                <EmploymentSuccessCaseResultCard key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-muted/10 p-4 text-sm text-muted-foreground">
              아직 표시할 유사 취업사례가 없습니다.
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function EmploymentSuccessCaseResultCard({ item }: { item: EmploymentSuccessCaseMatch }) {
  return (
    <div className="rounded-lg border border-border bg-muted/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <BriefcaseBusiness size={15} />
            {item.maskedClientName} · {item.ageDecade}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {[item.educationLevel, item.major].filter(Boolean).join(' / ') || '학력·전공 정보 일부 없음'}
          </div>
        </div>
        <div className="rounded-full bg-white px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
          적합도 {Math.round(item.rerankScore)}점
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-sm text-foreground sm:grid-cols-2">
        <div>취업처: <span className="font-medium">{item.employmentCompany}</span></div>
        <div>취업구분: <span className="font-medium">{item.employmentType || '-'}</span></div>
        <div>직무: <span className="font-medium">{item.employmentJobType || '-'}</span></div>
        <div>취업일: <span className="font-medium">{item.employmentDate || '-'}</span></div>
      </div>

      <div className="mt-3 text-xs leading-5 text-muted-foreground">
        {item.matchReason}
      </div>
    </div>
  );
}
