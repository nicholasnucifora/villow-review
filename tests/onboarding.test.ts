import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptSecret, sha256, signValue } from "../src/crypto";
import { workerFetch } from "../src/index";
import type { Env } from "../src/types";

const zeroKey = "A".repeat(43);
const env: Env = {
  ENVIRONMENT: "production",
  REVIEW_ORIGIN: "https://review.villow.app",
  REVIEW_SUPABASE_URL: "https://review-only.supabase.co",
  REVIEW_SUPABASE_SERVICE_ROLE_KEY: "review-service-role",
  REVIEW_GOOGLE_CLIENT_ID: "review-client-id",
  REVIEW_GOOGLE_CLIENT_SECRET: "review-client-secret",
  REVIEW_TOKEN_ENCRYPTION_KEY: zeroKey,
  REVIEW_SESSION_SIGNING_KEY: zeroKey,
  REVIEW_INVITE_TOKEN: "shared-review-invitation-secret",
  ALLOWED_EXTENSION_ORIGINS: `chrome-extension://${"a".repeat(32)}`,
};
const userId = "11111111-1111-4111-8111-111111111111";

function response(body: unknown, status = 200): Response {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("invitation onboarding", () => {
  it("validates the shared secret server-side and sets an HttpOnly session cookie", async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
      if (url.endsWith("/rpc/check_review_rate_limit")) return response(true);
      throw new Error(`Unexpected fetch ${url}`);
    }));
    const result = await workerFetch(new Request("https://review.villow.app/api/invitations/validate", {
      method: "POST",
      headers: { Origin: "https://review.villow.app", "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.1" },
      body: JSON.stringify({ token: env.REVIEW_INVITE_TOKEN }),
    }), env);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ invited: true });
    const setCookie = result.headers.get("Set-Cookie") || "";
    expect(setCookie).toContain("villow_review_invited=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).not.toContain("Max-Age");
    expect(setCookie).not.toContain(env.REVIEW_INVITE_TOKEN);
    expect(calls.every((call) => !call.url.includes(env.REVIEW_INVITE_TOKEN) && !call.body?.includes(env.REVIEW_INVITE_TOKEN))).toBe(true);
  });

  it("keeps the shared invitation reusable", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/rpc/check_review_rate_limit")) return response(true);
      throw new Error(`Unexpected fetch ${String(input)}`);
    }));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await workerFetch(new Request("https://review.villow.app/api/invitations/validate", {
        method: "POST",
        headers: { Origin: "https://review.villow.app", "Content-Type": "application/json" },
        body: JSON.stringify({ token: env.REVIEW_INVITE_TOKEN }),
      }), env);
      expect(result.status).toBe(200);
    }
  });

  it("rejects validation requests from another site", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const result = await workerFetch(new Request("https://review.villow.app/api/invitations/validate", {
      method: "POST",
      headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
      body: JSON.stringify({ token: env.REVIEW_INVITE_TOKEN }),
    }), env);
    expect(result.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("invalidates the invitation cookie when the shared secret is rotated", async () => {
    const signed = await signValue("shared-invite-v1", await sha256(env.REVIEW_INVITE_TOKEN));
    const request = new Request("https://review.villow.app/api/invitations/status", {
      headers: { Cookie: `villow_review_invited=${encodeURIComponent(signed)}` },
    });
    const current = await workerFetch(request, env);
    expect(await current.json()).toEqual({ invited: true });

    const rotated = await workerFetch(request, { ...env, REVIEW_INVITE_TOKEN: "rotated-review-invitation-secret" });
    expect(await rotated.json()).toEqual({ invited: false });
  });

  it("starts Google OAuth only after the invitation cookie is present", async () => {
    const signed = await signValue("shared-invite-v1", await sha256(env.REVIEW_INVITE_TOKEN));
    let transaction: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/review_oauth_transactions")) {
        transaction = JSON.parse(String(init?.body));
        return response(null, 201);
      }
      throw new Error(`Unexpected fetch ${url}`);
    }));
    const result = await workerFetch(new Request("https://review.villow.app/api/oauth/start", {
      method: "POST",
      headers: {
        Origin: "https://review.villow.app",
        "Content-Type": "application/json",
        Cookie: `villow_review_invited=${encodeURIComponent(signed)}`,
      },
      body: "{}",
    }), env);
    expect(result.status).toBe(200);
    const body = await result.json() as { authorizeUrl: string };
    expect(new URL(body.authorizeUrl).origin).toBe("https://accounts.google.com");
    expect(transaction?.shared_invite).toBe(true);
    expect(transaction?.invite_id).toBeNull();
    expect(transaction?.expected_user_id).toBeNull();
  });

  it("rejects Google OAuth start without an invitation cookie", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const result = await workerFetch(new Request("https://review.villow.app/api/oauth/start", {
      method: "POST",
      headers: { Origin: "https://review.villow.app", "Content-Type": "application/json" },
      body: "{}",
    }), env);
    expect(result.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("consumes shared-invite OAuth state and creates a revocable user session", async () => {
    const state = "s".repeat(64);
    const encryptedVerifier = await encryptSecret("verifier", zeroKey);
    const calls: Array<{ url: string; body?: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
      if (url.endsWith("/rpc/consume_review_oauth_transaction")) return response([{ id:"tx", invite_id:null, expected_user_id:null, shared_invite:true, encrypted_code_verifier:encryptedVerifier }]);
      if (url === "https://oauth2.googleapis.com/token") return response({ access_token:"access", refresh_token:"refresh", expires_in:3600, token_type:"Bearer", scope:"openid email https://www.googleapis.com/auth/youtube.readonly" });
      if (url === "https://openidconnect.googleapis.com/v1/userinfo") return response({ sub:"google-subject", email:"reviewer@example.test" });
      if (url.endsWith("/rpc/complete_review_oauth")) return response({ user_id:userId });
      if (url.includes("review_sessions?select=id")) return response([{ id:"session-id" }], 201);
      throw new Error(`Unexpected fetch ${url}`);
    }));
    const result = await workerFetch(new Request(`https://review.villow.app/api/oauth/callback?state=${state}&code=authorization-code`), env);
    expect(result.status).toBe(303);
    expect(result.headers.get("Location")).toBe("/?connected=1");
    expect(result.headers.get("Set-Cookie")).toContain("villow_review_session=");
    expect(result.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(calls.some(({ url }) => url.endsWith("/rpc/complete_review_oauth"))).toBe(true);
    expect(calls.some(({ url }) => url.includes("review_sessions?select=id"))).toBe(true);
    const completion = calls.find(({ url }) => url.endsWith("/rpc/complete_review_oauth"));
    expect(JSON.parse(completion?.body || "{}").p_shared_invite).toBe(true);
  });
});

describe("website session revocation and CSRF", () => {
  async function sessionRequest(includeCsrf: boolean): Promise<{ result: Response; calls: string[] }> {
    const rawSession = "r".repeat(64); const csrf = "c".repeat(64); const signed = await signValue(rawSession, zeroKey);
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); calls.push(url);
      if (url.includes("review_sessions?select=id")) return response([{
        id:"session-id", csrf_token_hash:await sha256(csrf),
        review_users:{ id:userId, email:"reviewer@example.test", display_name:null, google_authorized_at:new Date().toISOString(), access_revoked_at:null },
      }]);
      if (url.includes("review_sessions?id=eq.session-id")) return response(null, 204);
      throw new Error(`Unexpected fetch ${url}`);
    }));
    const headers: Record<string, string> = {
      Origin:"https://review.villow.app", "Content-Type":"application/json",
      Cookie:`villow_review_session=${encodeURIComponent(signed)}; villow_review_csrf=${csrf}`,
    };
    if (includeCsrf) headers["X-CSRF-Token"] = csrf;
    const result = await workerFetch(new Request("https://review.villow.app/api/logout", { method:"POST", headers, body:"{}" }), env);
    return { result, calls };
  }

  it("revokes a valid server-side session and clears cookies", async () => {
    const { result, calls } = await sessionRequest(true);
    expect(result.status).toBe(200);
    expect(calls.some((url) => url.includes("review_sessions?id=eq.session-id"))).toBe(true);
    expect(result.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });

  it("rejects a state-changing website request without its CSRF token", async () => {
    const { result, calls } = await sessionRequest(false);
    expect(result.status).toBe(403);
    expect(calls.some((url) => url.includes("review_sessions?id=eq.session-id"))).toBe(false);
  });
});
