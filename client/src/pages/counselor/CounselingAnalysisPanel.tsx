import { useCallback, useEffect, useRef, useState } from "react";
import {
  analyzeCounseling,
  fetchCounselingAnalysis,
  type AnalysisSnapshot,
} from "@/lib/counselingAnalysis";
import type { Evidence } from "../../../../supabase/functions/_shared/counseling-analysis";
export function CounselingAnalysisPanel({
  clientId,
  revision,
}: {
  clientId: string;
  revision: number;
}) {
  const [snapshot, setSnapshot] = useState<AnalysisSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const load = useCallback(
    async (refresh = false) => {
      const current = ++generation.current;
      setBusy(true);
      setError("");
      try {
        const result = await analyzeCounseling(clientId, refresh);
        if (current === generation.current) setSnapshot(result);
      } catch (e) {
        if (current === generation.current)
          setError(e instanceof Error ? e.message : "분석에 실패했습니다.");
      } finally {
        if (current === generation.current) setBusy(false);
      }
    },
    [clientId]
  );
  useEffect(() => {
    let active = true;
    setSnapshot(null);
    void fetchCounselingAnalysis(clientId)
      .then(saved => {
        if (active) setSnapshot(saved);
      })
      .catch(() => {})
      .finally(() => {
        if (active) void load();
      });
    return () => {
      active = false;
      generation.current++;
    };
  }, [clientId, revision, load]);
  useEffect(() => {
    const focus = () => {
      void load();
    };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [load]);
  const labels = new Map(snapshot?.sources.map(s => [s.ref, s.label]));
  const renderEvidence = (item: Evidence, index: number) => (
    <div key={index} className="space-y-1">
      <p className="text-sm whitespace-pre-line leading-6">{item.text}</p>
      <p className="text-xs text-muted-foreground">
        근거: {item.sources.map(ref => labels.get(ref) || ref).join(" · ")}
      </p>
    </div>
  );
  const sections = snapshot
    ? ([
        ["확인된 강점", snapshot.result.strengths],
        ["취업 장애요인", snapshot.result.barriers],
        ["상담 진행 변화", snapshot.result.progress],
        ["다음 상담 과제", snapshot.result.nextActions],
        ["추가 확인 사항", snapshot.result.missingInformation],
      ] as const)
    : [];
  return (
    <section
      className="rounded-xl border border-border bg-card p-5 space-y-4"
      aria-label="상담 종합 분석"
      aria-busy={busy}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">상담 종합 분석</h3>
          <p className="text-xs text-muted-foreground mt-1">
            상담이력·설문·등록정보와 저장된 문서 정보를 함께 분석합니다.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary disabled:opacity-50"
          disabled={busy}
          onClick={() => void load(true)}
        >
          {busy ? "분석 확인 중…" : "재분석"}
        </button>
      </div>
      <div role="status" className="text-xs text-muted-foreground">
        {busy
          ? "최신 자료를 확인하고 있습니다. 변경된 자료가 있으면 새로 분석합니다."
          : snapshot
            ? `마지막 분석: ${new Date(snapshot.generated_at).toLocaleString("ko-KR")} · 근거 ${snapshot.sources.length}건`
            : "분석 결과가 없습니다."}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
          {snapshot ? " 아래는 이전 분석 결과입니다." : ""}
        </p>
      )}
      {snapshot && (
        <>
          <div className="rounded-lg bg-muted/30 p-4">
            {renderEvidence(snapshot.result.summary, 0)}
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            {sections.map(([title, items]) => (
              <div key={title} className="space-y-3">
                <h4 className="font-medium text-sm">{title}</h4>
                {items.length ? (
                  items.map(renderEvidence)
                ) : (
                  <p className="text-sm text-muted-foreground">
                    기록에서 확인된 항목이 없습니다.
                  </p>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            AI가 작성한 상담 보조 의견입니다. 표시된 근거와 대조한 뒤
            활용해주세요.
          </p>
        </>
      )}
    </section>
  );
}
