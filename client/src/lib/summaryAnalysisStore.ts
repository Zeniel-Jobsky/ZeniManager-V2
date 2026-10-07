import { getSupabaseClient, isSupabaseConfigured } from "./supabase";
import type {
  CompetencyScoring,
  RecommendationResult,
  StructuredSummaryJson,
} from "./summaryAnalysisPipeline";
import { calculateCompetencyScoring } from "./summaryAnalysisPipeline";

const SUMMARY_ANALYSIS_TIMEOUT_MS = 15000;
const SUMMARY_ANALYSIS_TABLE = "client_summary_analysis";

function buildSafeStorageFileName(originalName: string): string {
  const trimmed = originalName.trim();
  const extensionMatch = trimmed.match(/(\.[A-Za-z0-9]+)$/);
  const extension = extensionMatch?.[1]?.toLowerCase() ?? "";
  const baseName = extension ? trimmed.slice(0, -extension.length) : trimmed;

  const asciiBase = baseName
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

  return `${asciiBase || "document"}${extension}`;
}

export interface StoredSummaryAnalysis {
  client_id: number;
  structured_json: StructuredSummaryJson;
  competency_scoring: CompetencyScoring;
  recommendation: RecommendationResult;
  prompt_snapshot: Record<string, unknown>;
  file_refs?: Array<{
    name: string;
    path: string;
    url: string;
    uploaded_at: string;
  }> | null;
  updated_at: string;
}

export function normalizeStoredSummaryAnalysis(
  saved: StoredSummaryAnalysis
): StoredSummaryAnalysis {
  return {
    ...saved,
    competency_scoring: calculateCompetencyScoring(saved.structured_json),
  };
}

export function hasDifferentCompetencyScoring(
  left: CompetencyScoring,
  right: CompetencyScoring
): boolean {
  return JSON.stringify(left) !== JSON.stringify(right);
}

function isMissingSchemaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? error.code : undefined;
  return code === "PGRST202" || code === "PGRST205";
}

async function withTimeout<T>(
  promise: PromiseLike<T>,
  message: string,
  timeoutMs = SUMMARY_ANALYSIS_TIMEOUT_MS
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function fetchClientSummaryAnalysis(
  clientId: string
): Promise<StoredSummaryAnalysis | null> {
  console.log("[summaryAnalysisStore] fetch:start", {
    clientId,
    table: SUMMARY_ANALYSIS_TABLE,
    isSupabaseConfigured: isSupabaseConfigured(),
  });
  if (!isSupabaseConfigured()) return null;

  const client = getSupabaseClient();
  if (!client) {
    console.warn("[summaryAnalysisStore] fetch:no-client", {
      clientId,
      table: SUMMARY_ANALYSIS_TABLE,
    });
    return null;
  }

  const { data, error } = await withTimeout(
    client
      .from(SUMMARY_ANALYSIS_TABLE)
      .select(
        "client_id, structured_json, competency_scoring, recommendation, prompt_snapshot, file_refs, updated_at"
      )
      .eq("client_id", Number(clientId))
      .maybeSingle(),
    "요약/분석 데이터를 불러오는 응답이 지연되고 있습니다."
  );

  if (error) {
    console.error("[summaryAnalysisStore] fetch:error", {
      clientId,
      table: SUMMARY_ANALYSIS_TABLE,
      error,
    });
    if (isMissingSchemaError(error)) return null;
    throw error;
  }

  console.log("[summaryAnalysisStore] fetch:success", {
    clientId,
    table: SUMMARY_ANALYSIS_TABLE,
    hasData: Boolean(data),
  });
  return data as StoredSummaryAnalysis | null;
}

export async function upsertClientSummaryAnalysis(input: {
  clientId: string;
  structuredJson?: StructuredSummaryJson;
  competencyScoring?: CompetencyScoring;
  recommendation?: RecommendationResult;
  promptSnapshot?: Record<string, unknown>;
  fileRefs?: Array<{
    name: string;
    path: string;
    url: string;
    uploaded_at: string;
  }>;
}): Promise<void> {
  console.log("[summaryAnalysisStore] upsert:start", {
    clientId: input.clientId,
    table: SUMMARY_ANALYSIS_TABLE,
    hasStructuredJson: Boolean(input.structuredJson),
    hasCompetencyScoring: Boolean(input.competencyScoring),
    hasRecommendation: Boolean(input.recommendation),
    hasPromptSnapshot: Boolean(input.promptSnapshot),
    fileRefCount: input.fileRefs?.length ?? 0,
  });

  if (!isSupabaseConfigured()) {
    throw new Error("Supabase가 설정되지 않아 저장할 수 없습니다.");
  }

  const client = getSupabaseClient();
  if (!client) {
    throw new Error("Supabase client를 초기화할 수 없습니다.");
  }

  const payload: Record<string, unknown> = {
    client_id: Number(input.clientId),
    updated_at: new Date().toISOString(),
  };

  if (input.structuredJson) payload.structured_json = input.structuredJson;
  if (input.competencyScoring) {
    payload.competency_scoring = input.competencyScoring;
  }
  if (input.recommendation) payload.recommendation = input.recommendation;
  if (input.promptSnapshot) payload.prompt_snapshot = input.promptSnapshot;
  if (input.fileRefs) payload.file_refs = input.fileRefs;

  const { error } = await withTimeout(
    client.from(SUMMARY_ANALYSIS_TABLE).upsert(payload, {
      onConflict: "client_id",
    }),
    "분석 결과 저장 응답이 지연되고 있습니다."
  );

  if (error) {
    if (isMissingSchemaError(error)) {
      throw new Error(
        `${SUMMARY_ANALYSIS_TABLE} 테이블이 없어 저장할 수 없습니다. SQL 스키마를 먼저 적용해 주세요.`
      );
    }
    throw error;
  }

  console.log("[summaryAnalysisStore] upsert:success", {
    clientId: input.clientId,
    table: SUMMARY_ANALYSIS_TABLE,
    mode: "upsert",
  });
}

export async function uploadSummaryAnalysisFiles(input: {
  clientId: string;
  files: File[];
}): Promise<
  Array<{ name: string; path: string; url: string; uploaded_at: string }>
> {
  console.log("[summaryAnalysisStore] upload:start", {
    clientId: input.clientId,
    fileCount: input.files.length,
  });

  if (!isSupabaseConfigured()) {
    throw new Error("Supabase가 설정되지 않아 파일을 업로드할 수 없습니다.");
  }

  const client = getSupabaseClient();
  if (!client) {
    throw new Error("Supabase client를 초기화할 수 없습니다.");
  }

  const bucket = "summary-analysis-files";
  const uploadedAt = new Date().toISOString();
  const refs: Array<{
    name: string;
    path: string;
    url: string;
    uploaded_at: string;
  }> = [];

  for (const file of input.files) {
    const safeName = buildSafeStorageFileName(file.name);
    const path = `${input.clientId}/${Date.now()}-${safeName}`;
    console.log("[summaryAnalysisStore] upload:file:start", {
      clientId: input.clientId,
      bucket,
      name: file.name,
      path,
      size: file.size,
      type: file.type,
    });

    const { error } = await withTimeout(
      client.storage.from(bucket).upload(path, file, {
        upsert: true,
      }),
      "분석 파일 업로드 응답이 지연되고 있습니다."
    );

    if (error) {
      console.error("[summaryAnalysisStore] upload:file:error", {
        clientId: input.clientId,
        bucket,
        name: file.name,
        path,
        error,
      });
      throw error;
    }

    const { data } = client.storage.from(bucket).getPublicUrl(path);
    console.log("[summaryAnalysisStore] upload:file:success", {
      clientId: input.clientId,
      bucket,
      name: file.name,
      path,
      publicUrl: data.publicUrl,
    });
    refs.push({
      name: file.name,
      path,
      url: data.publicUrl,
      uploaded_at: uploadedAt,
    });
  }

  console.log("[summaryAnalysisStore] upload:success", {
    clientId: input.clientId,
    fileCount: refs.length,
  });
  return refs;
}

export async function deleteSummaryAnalysisFile(input: {
  clientId: string;
  path: string;
}): Promise<void> {
  console.log("[summaryAnalysisStore] delete:start", {
    clientId: input.clientId,
    path: input.path,
  });

  if (!isSupabaseConfigured()) {
    throw new Error("Supabase가 설정되지 않아 파일을 삭제할 수 없습니다.");
  }

  const client = getSupabaseClient();
  if (!client) {
    throw new Error("Supabase client를 초기화할 수 없습니다.");
  }

  const bucket = "summary-analysis-files";
  const { error } = await withTimeout(
    client.storage.from(bucket).remove([input.path]),
    "분석 파일 삭제 응답이 지연되고 있습니다."
  );

  if (error) {
    console.error("[summaryAnalysisStore] delete:error", {
      clientId: input.clientId,
      path: input.path,
      error,
    });
    throw error;
  }

  console.log("[summaryAnalysisStore] delete:success", {
    clientId: input.clientId,
    path: input.path,
  });
}
