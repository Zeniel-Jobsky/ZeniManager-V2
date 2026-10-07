import { describe, it, expect, vi } from "vitest";
import { createHandler } from "./handler";
const id = "02e285cd-3443-4636-8d08-0154d9f7c4e7";
function setup({ owned = true, key = true, failAI = false } = {}) {
  let saved: any = null;
  const upsert = vi.fn(async (row: any) => {
    saved = row;
    return { error: null };
  });
  const rows: Record<string, any> = {
    clients: { id, name: "가상인물", counselor_id: "co1", desired_job: "회계" },
    counselors: owned ? [{ id: "co1" }] : [],
    sessions: [{ id: "s1", date: "2026-09-01", content: "회계직 지원 희망" }],
    survey_responses: [],
    client_summary_analysis: null,
  };
  const db = {
    auth: {
      getUser: async () => ({ data: { user: { id: "u1" } }, error: null }),
    },
    rpc: async () => ({ data: false, error: null }),
    from: (table: string) => {
      const q: any = {
        select: () => q,
        eq: () => q,
        order: () => q,
        range: () => q,
        maybeSingle: () => q,
        single: () => q,
        upsert,
        then: (resolve: any) =>
          Promise.resolve({
            data: table === "client_counseling_analysis" ? saved : rows[table],
            error: null,
          }).then(resolve),
      };
      return q;
    },
  };
  const ai = vi.fn(
    async () =>
      new Response(
        JSON.stringify(
          failAI
            ? {}
            : {
                choices: [
                  {
                    finish_reason: "stop",
                    message: {
                      content: JSON.stringify({
                        summary: {
                          text: "회계직 지원을 희망한다.",
                          sources: ["profile", "session:s1"],
                        },
                        strengths: [],
                        barriers: [],
                        progress: [],
                        nextActions: [
                          {
                            text: "지원 직무를 확인한다.",
                            sources: ["profile"],
                          },
                        ],
                        missingInformation: [],
                      }),
                    },
                  },
                ],
              }
        ),
        { status: failAI ? 503 : 200 }
      )
  );
  const factory = (() => db) as unknown as Parameters<typeof createHandler>[0];
  const handler = createHandler(
    factory,
    k => (k === "OPENAI_API_KEY" && !key ? undefined : "test"),
    ai as typeof fetch
  );
  const request = (body: any = { clientId: id }, auth = true) =>
    handler(
      new Request("http://localhost", {
        method: "POST",
        headers: auth ? { Authorization: "Bearer test" } : {},
        body: JSON.stringify(body),
      })
    );
  return { request, ai, upsert, rows };
}
describe("server analysis flow with mocked provider", () => {
  it("rejects unauthenticated, malformed and other-counselor requests before AI", async () => {
    const a = setup();
    expect((await a.request({}, false)).status).toBe(401);
    expect((await a.request({ clientId: "NaN" })).status).toBe(400);
    expect(a.ai).not.toHaveBeenCalled();
    const b = setup({ owned: false });
    expect((await b.request()).status).toBe(403);
    expect(b.ai).not.toHaveBeenCalled();
  });
  it("stores valid analysis and reuses unchanged source hash without another AI request", async () => {
    const x = setup();
    expect((await x.request()).status).toBe(200);
    const second = await (await x.request()).json();
    expect(second.cached).toBe(true);
    expect(x.ai).toHaveBeenCalledTimes(1);
    expect(x.upsert).toHaveBeenCalledTimes(1);
    x.rows.sessions[0].content = "면접 준비 완료";
    expect((await x.request()).status).toBe(200);
    expect(x.ai).toHaveBeenCalledTimes(2);
  });
  it("returns missing-key and provider errors without saving fallback text", async () => {
    const a = setup({ key: false });
    expect((await a.request()).status).toBe(503);
    expect(a.upsert).not.toHaveBeenCalled();
    const b = setup({ failAI: true });
    expect((await b.request()).status).toBe(502);
    expect(b.upsert).not.toHaveBeenCalled();
  });
  it("does not save incomplete model output", async () => {
    const x = setup();
    x.ai.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ finish_reason: "length" }] }))
    );
    expect((await x.request()).status).toBe(502);
    expect(x.upsert).not.toHaveBeenCalled();
  });
});
