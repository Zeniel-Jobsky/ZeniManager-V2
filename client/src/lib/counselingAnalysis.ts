import { getSupabaseClient } from "./supabase";
import type { AnalysisSnapshot } from "../../../supabase/functions/_shared/counseling-analysis";
export type { AnalysisSnapshot };
export async function fetchCounselingAnalysis(
  clientId: string
): Promise<AnalysisSnapshot | null> {
  const db = getSupabaseClient();
  if (!db) throw new Error("Supabase 설정이 필요합니다.");
  const { data, error } = await db
    .from("client_counseling_analysis")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw new Error("저장된 종합 분석을 불러오지 못했습니다.");
  return data as AnalysisSnapshot | null;
}
// Coalesce StrictMode/focus calls without retaining completed results on the client.
const pending = new Map<string, Promise<AnalysisSnapshot>>();
export async function analyzeCounseling(
  clientId: string,
  refresh = false
): Promise<AnalysisSnapshot> {
  const db = getSupabaseClient();
  if (!db) throw new Error("Supabase 설정이 필요합니다.");
  const {
    data: { session },
  } = await db.auth.getSession();
  if (!session) throw new Error("로그인이 필요합니다.");
  const key = `${session.user.id}:${clientId}:${refresh}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const request = (async () => {
    const { data, error } = await db.functions.invoke(
      "analyze-client-counseling",
      {
        body: { clientId, refresh },
        headers: { Authorization: `Bearer ${session.access_token}` },
      }
    );
    if (error) {
      let message = "종합 분석에 실패했습니다. 다시 시도해주세요.";
      if (error.context instanceof Response) {
        try {
          const body = await error.context.json();
          if (typeof body.error === "string") message = body.error;
        } catch {
          /* Preserve readable error. */
        }
      }
      throw new Error(message);
    }
    if (!data?.snapshot?.result) throw new Error("분석 응답이 비어 있습니다.");
    return data.snapshot as AnalysisSnapshot;
  })().finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}
