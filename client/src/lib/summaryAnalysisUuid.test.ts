import { expect, it, vi } from "vitest";
const { eq, upsert } = vi.hoisted(() => ({
  eq: vi.fn(() => ({ maybeSingle: async () => ({ data: null, error: null }) })),
  upsert: vi.fn(async () => ({ error: null })),
}));
vi.mock("./supabase", () => ({
  isSupabaseConfigured: () => true,
  getOpenAIKey: () => "",
  getSupabaseClient: () => ({
    from: () => ({ select: () => ({ eq }), upsert }),
  }),
}));
import {
  fetchClientSummaryAnalysis,
  upsertClientSummaryAnalysis,
} from "./summaryAnalysisStore";
it("preserves UUIDs across document analysis read and write", async () => {
  const id = "02e285cd-3443-4636-8d08-0154d9f7c4e7";
  await fetchClientSummaryAnalysis(id);
  await upsertClientSummaryAnalysis({ clientId: id, promptSnapshot: {} });
  expect(eq).toHaveBeenCalledWith("client_id", id);
  expect(upsert.mock.calls[0][0]).toMatchObject({ client_id: id });
});
