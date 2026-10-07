import { beforeEach, describe, expect, it, vi } from "vitest";
const { invoke, getSession } = vi.hoisted(() => ({
  invoke: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("./supabase", () => ({
  getSupabaseClient: () => ({ auth: { getSession }, functions: { invoke } }),
}));
import { analyzeCounseling } from "./counselingAnalysis";
describe("analysis request lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({
      data: { session: { user: { id: "u1" }, access_token: "token" } },
    });
  });
  it("rejects unsigned users before calling analysis", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    await expect(analyzeCounseling("c1")).rejects.toThrow("로그인");
    expect(invoke).not.toHaveBeenCalled();
  });
  it("coalesces concurrent requests and passes UUID unchanged", async () => {
    let finish!: (v: unknown) => void;
    invoke.mockReturnValue(new Promise(r => (finish = r)));
    const a = analyzeCounseling("02e285cd-3443-4636-8d08-0154d9f7c4e7");
    const b = analyzeCounseling("02e285cd-3443-4636-8d08-0154d9f7c4e7");
    await Promise.resolve();
    finish({ data: { snapshot: { result: { summary: "ok" } } }, error: null });
    await Promise.all([a, b]);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][1].body.clientId).toBe(
      "02e285cd-3443-4636-8d08-0154d9f7c4e7"
    );
  });
  it("surfaces server failures instead of a fabricated success result", async () => {
    invoke.mockResolvedValue({
      error: {
        context: new Response(JSON.stringify({ error: "AI API 키 없음" }), {
          status: 503,
        }),
      },
    });
    await expect(analyzeCounseling("c1")).rejects.toThrow("AI API 키 없음");
  });
  it("clears failed pending requests so retry can succeed", async () => {
    invoke
      .mockResolvedValueOnce({ error: {} })
      .mockResolvedValueOnce({
        data: { snapshot: { result: { summary: "ok" } } },
      });
    await expect(analyzeCounseling("retry")).rejects.toThrow();
    await expect(analyzeCounseling("retry")).resolves.toHaveProperty("result");
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
