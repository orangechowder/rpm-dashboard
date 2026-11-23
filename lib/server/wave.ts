// Wave's public API (gql.waveapps.com), read-only. Server-only: tokens never reach the browser.
//   • OAuth 2 on Wave's own page; tokens are encrypted (AES-256-GCM, key MONEY_TOKEN_KEY) before they're stored.
//   • Only queries are ever sent; this module contains no Wave mutation.
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const WAVE_GRAPHQL = "https://gql.waveapps.com/graphql/public";
export const WAVE_AUTHORIZE = "https://api.waveapps.com/oauth2/authorize/";
export const WAVE_TOKEN = "https://api.waveapps.com/oauth2/token/";
export const DEFAULT_SCOPES = "business:read account:read customer:read invoice:read product:read sales_tax:read vendor:read user:read";

export class WaveError extends Error {
  constructor(public code: "not_configured" | "auth" | "forbidden" | "rate_limited" | "graphql" | "http", message: string) { super(message); }
}

export function waveConfig() {
  // Pasted values often carry a space, a line break or quotes: ignore them.
  const clean = (v: string | undefined) => String(v ?? "").trim().replace(/^["']|["']$/g, "").trim();
  const clientId = clean(process.env.WAVE_CLIENT_ID);
  const clientSecret = clean(process.env.WAVE_CLIENT_SECRET);
  const key = clean(process.env.MONEY_TOKEN_KEY);
  let problem: string | null = null;
  if (!clientId || !clientSecret) problem = "WAVE_CLIENT_ID / WAVE_CLIENT_SECRET missing";
  else if (!key) problem = "MONEY_TOKEN_KEY missing";
  else if (Buffer.from(key, "base64").length !== 32) problem = `MONEY_TOKEN_KEY must be 32 bytes in base64 (it is ${Buffer.from(key, "base64").length}); paste it without quotes or spaces`;
  return { clientId, clientSecret, key, scopes: process.env.WAVE_SCOPES || DEFAULT_SCOPES, ready: problem === null, problem };
}

// ---- encryption of stored tokens ----------------------------------------------------------------------
function keyBytes(key: string): Buffer {
  const k = Buffer.from(key, "base64");
  if (k.length !== 32) throw new WaveError("not_configured", "MONEY_TOKEN_KEY must be 32 bytes, base64");
  return k;
}
export function encrypt(plain: string, key = waveConfig().key): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(key), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(":");
}
export function decrypt(sealed: string, key = waveConfig().key): string {
  const [v, iv, tag, body] = sealed.split(":");
  if (v !== "v1" || !iv || !tag || !body) throw new WaveError("auth", "token unreadable");
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(key), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
}

// ---- OAuth "state": proves the callback was started by an Admin in the last 10 minutes ------------------
export function signState(staffId: string, key = waveConfig().key, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ s: staffId, e: now + 10 * 60_000, n: randomBytes(8).toString("hex") })).toString("base64url");
  const mac = createHmac("sha256", keyBytes(key)).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}
export function readState(state: string, key = waveConfig().key, now = Date.now()): { staffId: string } | null {
  const [payload, mac] = String(state ?? "").split(".");
  if (!payload || !mac) return null;
  const expected = createHmac("sha256", keyBytes(key)).update(payload).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof data.s !== "string" || typeof data.e !== "number" || data.e < now) return null;
    return { staffId: data.s };
  } catch { return null; }
}

export function authorizeUrl(redirectUri: string, state: string) {
  const c = waveConfig();
  const q = new URLSearchParams({ client_id: c.clientId, response_type: "code", scope: c.scopes, redirect_uri: redirectUri, state });
  return `${WAVE_AUTHORIZE}?${q}`;
}

export type Tokens = { accessToken: string; refreshToken: string | null; expiresAt: string | null; scope: string; businessId: string | null };

async function tokenRequest(form: Record<string, string>, fetcher: typeof fetch): Promise<Tokens> {
  const c = waveConfig();
  const send = (basic: boolean) => fetcher(WAVE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", ...(basic ? { Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}` } : {}) },
    body: new URLSearchParams(basic ? { client_id: c.clientId, ...form } : { client_id: c.clientId, client_secret: c.clientSecret, ...form }),
  });
  // OAuth servers accept the app's secret either in the form or as HTTP Basic: try the form, then Basic.
  let response = await send(false);
  let body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok && body.error === "invalid_client") {
    response = await send(true);
    body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  }
  if (!response.ok || typeof body.access_token !== "string") throw new WaveError("auth", String(body.error_description ?? body.error ?? body.message ?? `token ${response.status}`));
  const expiresIn = Number(body.expires_in);
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    scope: String(body.scope ?? ""),
    businessId: typeof body.businessId === "string" ? body.businessId : null,
  };
}
export const exchangeCode = (code: string, redirectUri: string, fetcher: typeof fetch = fetch) => tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri }, fetcher);
export const refreshTokens = (refreshToken: string, fetcher: typeof fetch = fetch) => tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }, fetcher);

// ---- GraphQL (queries only) ---------------------------------------------------------------------------
export type GraphQL = (query: string, variables?: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** A query runner that waits and retries when Wave says "too many requests", and reports what it saw. */
export function graphqlClient(token: string, fetcher: typeof fetch = fetch, stats: { calls: number; retries: number; rateHeaders: Record<string, string> } = { calls: 0, retries: 0, rateHeaders: {} }): GraphQL {
  return async (query, variables = {}) => {
    if (/^\s*mutation\b/i.test(query)) throw new WaveError("graphql", "read-only: mutations are never sent");
    for (let attempt = 0; ; attempt += 1) {
      stats.calls += 1;
      const response = await fetcher(WAVE_GRAPHQL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ query, variables }) });
      response.headers.forEach((value, name) => { if (/rate|limit|retry/i.test(name)) stats.rateHeaders[name] = value; });
      if (response.status === 429 && attempt < 4) {
        stats.retries += 1;
        const wait = Number(response.headers.get("retry-after")) || 2 ** attempt;
        await new Promise((r) => setTimeout(r, Math.min(30, wait) * 1000));
        continue;
      }
      if (response.status === 401 || response.status === 403) throw new WaveError("auth", `Wave refused the token (${response.status})`);
      const body = (await response.json().catch(() => ({}))) as { data?: Record<string, unknown>; errors?: Array<{ message?: string; extensions?: { code?: string } }> };
      if (body.errors?.length) {
        // UNAUTHENTICATED = the sign-in expired; FORBIDDEN = this app wasn't given permission for that part (not an expiry).
        const unauth = body.errors.some((e) => /UNAUTHENTICATED/i.test(e.extensions?.code ?? "") || /authentication expired|unauthenticated/i.test(e.message ?? ""));
        const forbidden = body.errors.some((e) => /FORBIDDEN/i.test(e.extensions?.code ?? "") || /not authorized/i.test(e.message ?? ""));
        throw new WaveError(unauth ? "auth" : forbidden ? "forbidden" : "graphql", body.errors.map((e) => e.message).join("; "));
      }
      if (!response.ok || !body.data) throw new WaveError("http", `Wave answered ${response.status}`);
      return body.data;
    }
  };
}

export const Q_BUSINESSES = `query { businesses(page: 1, pageSize: 20) { edges { node { id name isPersonal isArchived } } } }`;
export const Q_ACCOUNTS = `query($b: ID!, $page: Int!) { business(id: $b) { accounts(page: $page, pageSize: 100) { pageInfo { currentPage totalPages } edges { node { id name isArchived balance balanceInBusinessCurrency subtype { value } type { value } } } } } }`;
const LINES = `items { description subtotal { minorUnitValue value } product { id name } account { id name } taxes { amount { minorUnitValue value } salesTax { id name abbreviation } } }`;
export const Q_INVOICES = `query($b: ID!, $page: Int!) { business(id: $b) { invoices(page: $page, pageSize: 50) { pageInfo { currentPage totalPages totalCount } edges { node { id invoiceNumber invoiceDate status modifiedAt customer { id name } subtotal { minorUnitValue value } discountTotal { minorUnitValue value } total { minorUnitValue value } ${LINES} payments { id paymentDate amount paymentMethod active state transactionType modifiedAt account { id name } originInvoicePayment { id } } } } } } }`;
export const Q_ESTIMATES = `query($b: ID!, $page: Int!) { business(id: $b) { estimates(page: $page, pageSize: 50) { pageInfo { currentPage totalPages totalCount } edges { node { id estimateNumber estimateDate modifiedAt customer { id name } subtotal { minorUnitValue value } discountTotal { minorUnitValue value } ${LINES} payments { id paymentDate amount paymentAccountId paymentMethod active state transactionType originPaymentId modifiedAt } } } } } }`;

type Conn = { edges?: Array<{ node: Record<string, unknown> }>; pageInfo?: { totalPages?: number } };
export async function allPages(gql: GraphQL, query: string, businessId: string, field: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let page = 1; page <= 200; page += 1) {
    const data = await gql(query, { b: businessId, page });
    const conn = ((data.business as Record<string, unknown> | null)?.[field] ?? {}) as Conn;
    out.push(...(conn.edges ?? []).map((e) => e.node));
    if (page >= (conn.pageInfo?.totalPages ?? 1)) break;
  }
  return out;
}
