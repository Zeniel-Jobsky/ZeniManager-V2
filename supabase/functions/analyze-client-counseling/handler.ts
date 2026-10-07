import type { createClient as ClientFactory } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import {
  buildSources,
  sourceHash,
  validateAnalysis,
  SYSTEM_PROMPT,
  UUID_PATTERN,
  type Source,
} from "../_shared/counseling-analysis.ts";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
class RequestError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
  }
}
export function createHandler(
  createClient: typeof ClientFactory,
  env: (key: string) => string | undefined,
  fetcher: typeof fetch = fetch
) {
  const inflight = new Map<string, Promise<unknown>>();
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST")
      return json({ error: "POST 요청만 지원합니다." }, 405);
    try {
      const authorization = req.headers.get("authorization") || "";
      if (!/^Bearer /i.test(authorization))
        throw new RequestError("로그인이 필요합니다.", 401);
      const url = env("SUPABASE_URL")!;
      const db = createClient(url, env("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false },
      });
      const { data: auth, error: authError } = await db.auth.getUser(
        authorization.replace(/^Bearer\s+/i, "")
      );
      if (authError || !auth.user)
        throw new RequestError("로그인 세션을 확인해주세요.", 401);
      const raw = await req.text();
      if (raw.length > 1024) throw new RequestError("요청이 너무 큽니다.", 413);
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new RequestError("올바른 JSON 요청이 필요합니다.");
      }
      if (
        !body ||
        typeof body.clientId !== "string" ||
        !UUID_PATTERN.test(body.clientId) ||
        (body.refresh !== undefined && typeof body.refresh !== "boolean")
      )
        throw new RequestError("요청 형식이 올바르지 않습니다.");
      const id = body.clientId;
      const model = env("COUNSELING_ANALYSIS_MODEL") || "gpt-4o-mini";
      async function readSources(): Promise<Source[]> {
        const { data: client, error } = await db
          .from("clients")
          .select(
            "id,name,desired_job,education_level,major,participation_stage,counsel_notes,work_exp_type,work_exp_company,work_exp_period,training_name,employment_date,job_title"
          )
          .eq("id", id)
          .maybeSingle();
        if (error)
          throw new RequestError("대상자 정보를 조회하지 못했습니다.", 500);
        if (!client)
          throw new RequestError("대상자가 없거나 접근 권한이 없습니다.", 403);
        // Separate explicit ownership check; do not depend on permissive legacy RLS alone.
        const { data: owner, error: ownerError } = await db
          .from("clients")
          .select("counselor_id")
          .eq("id", id)
          .single();
        const { data: me, error: meError } = await db
          .from("counselors")
          .select("id")
          .eq("auth_user_id", auth.user!.id);
        const { data: isAdmin, error: adminError } = await db.rpc(
          "is_current_user_admin"
        );
        if (
          ownerError ||
          meError ||
          adminError ||
          (!isAdmin && !me?.some(c => c.id === owner?.counselor_id))
        )
          throw new RequestError("접근 권한이 없습니다.", 403);
        async function allRows(table: string, fields: string, order: string) {
          const rows: Record<string, unknown>[] = [];
          for (let offset = 0; offset <= 2000; offset += 500) {
            const { data, error } = await db
              .from(table)
              .select(fields)
              .eq("client_id", id)
              .order(order)
              .order("id")
              .range(offset, offset + 499);
            if (error)
              throw new RequestError(
                "상담·설문 자료를 불러오지 못했습니다.",
                500
              );
            rows.push(
              ...((data as unknown as Record<string, unknown>[]) || [])
            );
            if (rows.length > 2000)
              throw new RequestError(
                "분석할 기록이 너무 많습니다. 관리자에게 문의해주세요.",
                413
              );
            if ((data?.length || 0) < 500) break;
          }
          return rows;
        }
        const [sessions, surveys, doc] = await Promise.all([
          allRows("sessions", "id,date,type,content,next_action", "date"),
          allRows("survey_responses", "*", "survey_date"),
          db
            .from("client_summary_analysis")
            .select("structured_json")
            .eq("client_id", id)
            .maybeSingle(),
        ]);
        if (doc.error)
          throw new RequestError(
            "저장된 문서 정보를 조회하지 못했습니다.",
            500
          );
        return buildSources(
          client,
          sessions,
          surveys,
          doc.data?.structured_json || null
        );
      }
      const sources = await readSources();
      const hash = await sourceHash(sources, model);
      const { data: cached, error: cacheError } = await db
        .from("client_counseling_analysis")
        .select("*")
        .eq("client_id", id)
        .maybeSingle();
      if (cacheError)
        throw new RequestError("분석 저장소를 조회하지 못했습니다.", 500);
      if (cached?.source_hash === hash && !body.refresh)
        return json({ snapshot: cached, cached: true });
      if (
        body.refresh &&
        cached &&
        Date.now() - Date.parse(cached.generated_at) < 30000
      )
        throw new RequestError("재분석은 30초 후 다시 요청해주세요.", 429);
      const key = env("OPENAI_API_KEY");
      if (!key)
        throw new RequestError("서버의 AI API 키가 설정되지 않았습니다.", 503);
      if (JSON.stringify(sources).length > 120000)
        throw new RequestError(
          "분석 자료가 너무 큽니다. 자료를 나누어 검토해주세요.",
          413
        );
      const requestKey = `${auth.user.id}:${id}:${hash}`;
      let task = inflight.get(requestKey);
      if (!task) {
        task = (async () => {
          const response = await fetcher(
            "https://api.openai.com/v1/chat/completions",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${key}`,
              },
              signal: AbortSignal.timeout(45000),
              body: JSON.stringify({
                model,
                temperature: 0,
                response_format: { type: "json_object" },
                max_tokens: 2600,
                messages: [
                  { role: "system", content: SYSTEM_PROMPT },
                  { role: "user", content: JSON.stringify({ sources }) },
                ],
              }),
            }
          );
          if (!response.ok)
            throw new RequestError(
              `AI 분석 요청이 실패했습니다. (${response.status})`,
              502
            );
          const payload = await response.json();
          if (payload.choices?.[0]?.finish_reason !== "stop")
            throw new RequestError(
              "분석 응답이 완료되지 않았습니다. 다시 시도해주세요.",
              502
            );
          const result = validateAnalysis(
            JSON.parse(payload.choices[0].message.content),
            sources
          );
          if ((await sourceHash(await readSources(), model)) !== hash)
            throw new RequestError(
              "분석 중 자료가 변경됐습니다. 다시 분석해주세요.",
              409
            );
          const snapshot = {
            client_id: id,
            source_hash: hash,
            result,
            sources: sources.map(({ ref, label }) => ({ ref, label })),
            model,
            generated_at: new Date().toISOString(),
          };
          const writer = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY")!, {
            auth: { persistSession: false },
          });
          const { error } = await writer
            .from("client_counseling_analysis")
            .upsert(snapshot, { onConflict: "client_id" });
          if (error)
            throw new RequestError("분석 결과 저장에 실패했습니다.", 500);
          return { snapshot, cached: false };
        })().finally(() => inflight.delete(requestKey));
        inflight.set(requestKey, task);
      }
      return json(await task);
    } catch (e) {
      return json(
        {
          error:
            e instanceof RequestError
              ? e.message
              : e instanceof Error && e.name === "TimeoutError"
                ? "AI 분석 시간이 초과되었습니다. 다시 시도해주세요."
                : "분석 응답을 처리하지 못했습니다. 다시 시도해주세요.",
        },
        e instanceof RequestError ? e.status : 502
      );
    }
  };
}
