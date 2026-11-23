import { describe, expect, it, vi } from "vitest";
import { decrypt, encrypt, graphqlClient, readState, refreshTokens, signState, WaveError } from "./wave";
import { needsAlert, type Connection } from "./wave-runner";

const KEY = Buffer.alloc(32, 7).toString("base64");

describe("stored tokens", () => {
  it("are encrypted and come back intact; tampering is refused", () => {
    const sealed = encrypt("secret-token", KEY);
    expect(sealed).not.toContain("secret-token");
    expect(decrypt(sealed, KEY)).toBe("secret-token");
    const parts = sealed.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decrypt(parts.join(":"), KEY)).toThrow();
    expect(() => decrypt(sealed, Buffer.alloc(32, 8).toString("base64"))).toThrow();
  });
});

describe("OAuth state", () => {
  it("only accepts a recent, untouched state", () => {
    const now = 1_700_000_000_000;
    const s = signState("user-marc", KEY, now);
    expect(readState(s, KEY, now + 60_000)).toEqual({ staffId: "user-marc" });
    expect(readState(s, KEY, now + 11 * 60_000)).toBeNull();
    expect(readState(s.replace(/.$/, (c) => (c === "A" ? "B" : "A")), KEY, now)).toBeNull();
    expect(readState("garbage", KEY, now)).toBeNull();
  });
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("Wave client", () => {
  it("never sends a mutation", async () => {
    const fetcher = vi.fn();
    await expect(graphqlClient("t", fetcher as unknown as typeof fetch)("mutation { invoiceDelete(input: {}) { didSucceed } }")).rejects.toThrow(/read-only/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("waits and retries when rate limited", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValueOnce(json(429, {}, { "retry-after": "1", "x-ratelimit-remaining": "0" })).mockResolvedValueOnce(json(200, { data: { ok: true } }));
    const stats = { calls: 0, retries: 0, rateHeaders: {} as Record<string, string> };
    const p = graphqlClient("t", fetcher as unknown as typeof fetch, stats)("query { ok }");
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toEqual({ ok: true });
    expect(stats).toMatchObject({ calls: 2, retries: 1, rateHeaders: { "retry-after": "1", "x-ratelimit-remaining": "0" } });
    vi.useRealTimers();
  });
  it("reports an expired sign-in as an auth problem (Wave answers 200 + UNAUTHENTICATED)", async () => {
    const fetcher = vi.fn().mockResolvedValue(json(200, { errors: [{ message: "Invalid request, authentication expired.", extensions: { code: "UNAUTHENTICATED" } }], data: { business: null } }));
    await expect(graphqlClient("t", fetcher as unknown as typeof fetch)("query { x }")).rejects.toMatchObject({ code: "auth" });
  });
  it("refreshes tokens", async () => {
    process.env.WAVE_CLIENT_ID = "id"; process.env.WAVE_CLIENT_SECRET = "secret";
    const fetcher = vi.fn().mockResolvedValue(json(200, { access_token: "new", refresh_token: "r2", expires_in: 7200, scope: "invoice:read" }));
    const t = await refreshTokens("r1", fetcher as unknown as typeof fetch);
    expect(t).toMatchObject({ accessToken: "new", refreshToken: "r2", scope: "invoice:read" });
    expect(String(fetcher.mock.calls[0][1].body)).toContain("grant_type=refresh_token");
    const bad = vi.fn().mockResolvedValue(json(400, { error: "invalid_grant" }));
    await expect(refreshTokens("r1", bad as unknown as typeof fetch)).rejects.toBeInstanceOf(WaveError);
  });
});

describe("alerts", () => {
  const conn = (over: Partial<Connection>): Connection => ({ business_id: "b", business_name: "", access_token_enc: "", refresh_token_enc: null, token_expires_at: null, scope: "", connected_by: null, connected_at: "", approved_at: "2026-12-01T00:00:00Z", approved_by: null, sync_from: null, csv_until: null, fee_account_id: null, fee_baseline_cents: null, status: "connected", last_sync_at: null, last_success_at: "2026-12-10T00:00:00Z", last_error: null, last_error_at: null, alert_sent_at: null, ...over });
  const now = Date.parse("2026-12-10T12:00:00Z");
  it("alerts when the connection expired or nothing synced for 24 h, at most once a day", () => {
    expect(needsAlert(conn({}), now)).toBeNull();
    expect(needsAlert(conn({ status: "expired" }), now)).toMatch(/expired/);
    expect(needsAlert(conn({ last_success_at: "2026-12-09T06:00:00Z", last_error: "boom" }), now)).toMatch(/24 hours.*boom/);
    expect(needsAlert(conn({ status: "expired", alert_sent_at: "2026-12-10T06:00:00Z" }), now)).toBeNull();
    expect(needsAlert(conn({ approved_at: null, status: "expired" }), now)).toBeNull();
  });
});
