import { afterEach, describe, expect, it, vi } from "vitest";
import { constantTimeEqual, decryptSecret, encryptSecret, sha256, signValue, verifySignedValue } from "../src/crypto";
import { ReviewDatabase, supabaseRequestHeaders, supabaseRestUrl } from "../src/db";
import { createOAuthTransaction, GOOGLE_SCOPES, GoogleReauthRequired, hasRequiredScopes, synchronizeSubscriptions } from "../src/google";
import { workerFetch } from "../src/index";
import { reviewHtml, reviewJs } from "../src/ui";
import type { Env, GoogleChannel, QueuePayload } from "../src/types";
import { validateExtensionDay, validateQueuePayload } from "../src/validation";

const extensionOrigin = `chrome-extension://${"a".repeat(32)}`;
const token = "t".repeat(64);
const tokenHash = await sha256(token);
const zeroKey = "A".repeat(43);
const userId = "11111111-1111-4111-8111-111111111111";
const extensionTokenId = "22222222-2222-4222-8222-222222222222";

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
};

const validQueue: QueuePayload = {
  videoId: "dQw4w9WgXcQ",
  title: "A harmless test video",
  channel: "Example Channel",
  channelUrl: "https://www.youtube.com/@example",
  duration: "12:34",
  isLive: false,
  viewCountText: "1.2M views",
  publishedText: "3 days ago",
  metadataText: "Example Channel - 1.2M views - 3 days ago",
  thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  source: "33333333-3333-4333-8333-333333333333",
  client: "Chrome",
};

function response(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function extensionRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`https://review.villow.app${path}`, {
    ...init,
    headers: { Origin: extensionOrigin, Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
}

function supabaseExtensionAuthMock(extra: (url: string, init?: RequestInit) => Response | undefined = () => undefined) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const custom = extra(url, init);
    if (custom) return custom;
    if (url.includes("review_extension_tokens?") && url.includes(tokenHash)) return response([{ id: extensionTokenId, user_id: userId }]);
    if (url.includes("review_extension_tokens?id=eq.")) return response(null, 204);
    if (url.endsWith("/rpc/check_review_rate_limit")) return response(true);
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("Supabase server credentials", () => {
  it("sends modern sb_secret keys only as an apikey", () => {
    const headers = supabaseRequestHeaders("sb_secret_example");
    expect(headers.get("apikey")).toBe("sb_secret_example");
    expect(headers.get("Authorization")).toBeNull();
  });

  it("keeps legacy service-role JWT compatibility", () => {
    const headers = supabaseRequestHeaders("legacy-service-role-jwt");
    expect(headers.get("Authorization")).toBe("Bearer legacy-service-role-jwt");
  });

  it("normalizes either Supabase project or REST API URLs", () => {
    expect(supabaseRestUrl("https://project.supabase.co", "example")).toBe("https://project.supabase.co/rest/v1/example");
    expect(supabaseRestUrl(" https://project.supabase.co/rest/v1/ ", "example")).toBe("https://project.supabase.co/rest/v1/example");
  });

  it("invokes an injected fetcher without rebinding its this value", async () => {
    let receiver: unknown = "not-called";
    const fetcher = function (this: unknown) {
      receiver = this;
      return Promise.resolve(response(null, 201));
    } as typeof fetch;
    const db = new ReviewDatabase(env, { fetch: fetcher });
    await db.createOAuthTransaction({
      stateHash: "s".repeat(43),
      sharedInvite: true,
      encryptedVerifier: "encrypted",
      expiresAt: new Date().toISOString(),
    });
    expect(receiver).toBeUndefined();
  });
});

describe("credential cryptography", () => {
  it("encrypts token material with authenticated encryption", async () => {
    const encrypted = await encryptSecret("refresh-token", zeroKey);
    expect(encrypted).not.toContain("refresh-token");
    expect(await decryptSecret(encrypted, zeroKey)).toBe("refresh-token");
  });

  it("signs sessions and rejects tampering", async () => {
    const signed = await signValue("session-token", zeroKey);
    expect(await verifySignedValue(signed, zeroKey)).toBe("session-token");
    expect(await verifySignedValue(`${signed}x`, zeroKey)).toBeNull();
  });

  it("compares invitation secrets without an early-return string comparison", async () => {
    expect(await constantTimeEqual("shared-secret", "shared-secret")).toBe(true);
    expect(await constantTimeEqual("shared-secret", "different")).toBe(false);
  });
});

describe("queue metadata validation", () => {
  it("accepts the extension v0.8.2 payload", () => expect(validateQueuePayload(validQueue)).toEqual(validQueue));

  it.each([
    ["malformed video id", { ...validQueue, videoId: "short" }],
    ["hostile control character", { ...validQueue, title: "bad\u0000title" }],
    ["thumbnail for another video", { ...validQueue, thumbnail: "https://i.ytimg.com/vi/abc12345678/hqdefault.jpg" }],
    ["arbitrary thumbnail origin", { ...validQueue, thumbnail: "https://attacker.example/vi/dQw4w9WgXcQ/a.jpg" }],
    ["invalid duration", { ...validQueue, duration: "twelve minutes" }],
    ["unexpected metadata field", { ...validQueue, metadataVersion: 2 }],
  ])("rejects %s", (_label, payload) => expect(() => validateQueuePayload(payload)).toThrow());

  it("preserves zero versus null limit semantics", () => {
    const payload = validateExtensionDay({
      date: "2026-09-07", timezone: "Australia/Brisbane", source: validQueue.source, client: "Chrome",
      contributed: { recommendationsSeen: 0, activeSeconds: 0, externalSaves: 0 },
      config: { recommendationLimitPerDay: 0, saveLimitPerDay: null, timeLimitSecondsPerDay: 0, youTubeBlocked: false },
    });
    expect(payload.config.recommendationLimitPerDay).toBe(0);
    expect(payload.config.saveLimitPerDay).toBeNull();
  });
});

describe("CORS and bearer authentication", () => {
  it.each([extensionOrigin, "moz-extension://8c861621-7117-4eb8-b9d1-1475157284c0", "moz-extension://165a11ac-170f-4f1e-a41c-d75abecf969d", "https://client.example"])("answers preflight from %s without bearer authentication", async (origin) => {
    const result = await workerFetch(new Request("https://review.villow.app/api/queue", {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" },
    }), env);
    expect(result.status).toBe(204);
    expect(result.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(result.headers.get("Access-Control-Allow-Headers")).toBe("Authorization, Content-Type");
    expect(result.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, DELETE, OPTIONS");
    expect(result.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    expect(result.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
    expect(result.headers.get("Vary")).toContain("Origin");
    expect(result.headers.get("Access-Control-Expose-Headers")).toContain("Retry-After");
  });

  it("rejects a preflight that omits Origin", async () => {
    const result = await workerFetch(new Request("https://review.villow.app/api/ping", {
      method: "OPTIONS",
      headers: { "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" },
    }), env);
    expect(result.status).toBe(403);
    expect(result.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("authenticates an originless privileged extension request by bearer token", async () => {
    vi.stubGlobal("fetch", supabaseExtensionAuthMock());
    const result = await workerFetch(new Request("https://review.villow.app/api/ping", {
      headers: { Authorization: `Bearer ${token}` },
    }), env);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({});
    expect(result.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(result.headers.get("Vary")).toContain("Origin");
  });

  it("reserves 401 for an invalid Villow bearer token", async () => {
    vi.stubGlobal("fetch", supabaseExtensionAuthMock((url) => url.includes("review_extension_tokens?") ? response([]) : undefined));
    const result = await workerFetch(extensionRequest("/api/ping"), env);
    expect(result.status).toBe(401);
  });

  it("implements the required ping route", async () => {
    vi.stubGlobal("fetch", supabaseExtensionAuthMock());
    const result = await workerFetch(extensionRequest("/api/ping"), env);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({});
  });
});

describe("queue delivery", () => {
  it("saves while Google authorization is stale and makes no Google request", async () => {
    const mock = supabaseExtensionAuthMock((url) => {
      if (url.endsWith("/rpc/save_review_queue_video")) return response({ inserted: true });
      return undefined;
    });
    vi.stubGlobal("fetch", mock);
    const result = await workerFetch(extensionRequest("/api/queue", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(validQueue),
    }), env);
    expect(result.status).toBe(201);
    expect(mock.mock.calls.some(([url]) => /googleapis|youtube\/v3|oembed/i.test(String(url)))).toBe(false);
    expect(mock.mock.calls.some(([url]) => String(url).includes("review_users"))).toBe(false);
  });

  it("returns 409 for a duplicate save", async () => {
    vi.stubGlobal("fetch", supabaseExtensionAuthMock((url) => url.endsWith("/rpc/save_review_queue_video") ? response({ inserted: false }) : undefined));
    const result = await workerFetch(extensionRequest("/api/queue", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(validQueue),
    }), env);
    expect(result.status).toBe(409);
  });

  it("rejects malformed queue metadata before inserting", async () => {
    const mock = supabaseExtensionAuthMock();
    vi.stubGlobal("fetch", mock);
    const result = await workerFetch(extensionRequest("/api/queue", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...validQueue, title: "x".repeat(301) }),
    }), env);
    expect(result.status).toBe(400);
    expect(mock.mock.calls.some(([url]) => String(url).endsWith("/rpc/save_review_queue_video"))).toBe(false);
  });

  it("renders submitted strings as text instead of HTML", () => {
    expect(reviewJs).toContain("link.textContent = cleanText(video.title)");
    expect(reviewJs).not.toContain("innerHTML");
  });

  it("ships a valid fragment-gate script and the required Connect Extension label", () => {
    expect(() => new Function(reviewJs)).not.toThrow();
    expect(reviewJs).toContain('fragment.get("villow_invite")');
    expect(reviewJs).toContain('api("/api/invitations/validate"');
    expect(reviewJs).toContain("history.replaceState");
    expect(reviewJs).not.toContain("REVIEW_INVITE_TOKEN");
    expect(reviewHtml).toContain('<h2 id="connect-title">Connect Extension</h2>');
  });
});

describe("Google OAuth and subscriptions", () => {
  it("creates a short-lived OAuth transaction with state, PKCE, exact redirect, and minimum scopes", async () => {
    let saved: Record<string, unknown> | undefined;
    const db = { createOAuthTransaction: vi.fn(async (value) => { saved = value; }) } as unknown as ReviewDatabase;
    const authorizeUrl = new URL(await createOAuthTransaction(db, env, { inviteId: "invite-id" }));
    const state = authorizeUrl.searchParams.get("state")!;
    expect(authorizeUrl.origin).toBe("https://accounts.google.com");
    expect(authorizeUrl.searchParams.get("redirect_uri")).toBe("https://review.villow.app/api/oauth/callback");
    expect(authorizeUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizeUrl.searchParams.get("scope")?.split(" ")).toEqual(GOOGLE_SCOPES);
    expect(saved?.stateHash).toBe(await sha256(state));
    expect(saved?.stateHash).not.toBe(state);
  });

  it("detects partial scope consent", () => {
    expect(hasRequiredScopes(["openid", "email"])).toBe(false);
    expect(hasRequiredScopes([...GOOGLE_SCOPES])).toBe(true);
    expect(hasRequiredScopes([
      "openid",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/youtube.readonly",
    ])).toBe(true);
  });

  it("paginates subscriptions and returns id, handle, and title", async () => {
    const firstId = `UC${"a".repeat(22)}`;
    const secondId = `UC${"b".repeat(22)}`;
    const encryptedAccess = await encryptSecret("access-token", zeroKey);
    let completed: GoogleChannel[] | undefined;
    const db = {
      beginSubscriptionSync: vi.fn(async () => ({ action: "refresh", sync_id: "sync-id" })),
      getGoogleAuthorization: vi.fn(async () => ({
        encrypted_access_token: encryptedAccess, encrypted_refresh_token: "present", access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
        granted_scopes: [...GOOGLE_SCOPES], access_revoked_at: null,
      })),
      completeSubscriptionSync: vi.fn(async (_sync, _user, channels) => { completed = channels; }),
      failSubscriptionSync: vi.fn(), markGoogleAuthorizationStale: vi.fn(),
    } as unknown as ReviewDatabase;
    const googleFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/subscriptions") && !url.searchParams.has("pageToken")) return response({ nextPageToken:"next", items:[{ snippet:{ title:"First", resourceId:{ channelId:firstId } } }] });
      if (url.pathname.endsWith("/subscriptions")) return response({ items:[{ snippet:{ title:"Second", resourceId:{ channelId:secondId } } }] });
      if (url.pathname.endsWith("/channels")) return response({ items:[
        { id:firstId, snippet:{ title:"First Channel", customUrl:"@first" } },
        { id:secondId, snippet:{ title:"Second Channel", customUrl:"second" } },
      ] });
      throw new Error(`Unexpected Google URL ${url}`);
    });
    const channels = await synchronizeSubscriptions(db, env, userId, googleFetch);
    expect(channels).toEqual([
      { channelId:firstId, handle:"first", title:"First Channel" },
      { channelId:secondId, handle:"second", title:"Second Channel" },
    ]);
    expect(completed).toEqual(channels);
    expect(googleFetch.mock.calls.filter(([url]) => String(url).includes("/subscriptions?")).length).toBe(2);
  });

  it("preserves last-known-good rows when a refresh fails", async () => {
    const encryptedAccess = await encryptSecret("access-token", zeroKey);
    const complete = vi.fn(); const fail = vi.fn();
    const db = {
      beginSubscriptionSync: vi.fn(async () => ({ action:"refresh", sync_id:"sync-id" })),
      getGoogleAuthorization: vi.fn(async () => ({
        encrypted_access_token:encryptedAccess, encrypted_refresh_token:"present", access_token_expires_at:new Date(Date.now()+3600_000).toISOString(),
        granted_scopes:[...GOOGLE_SCOPES], access_revoked_at:null,
      })),
      completeSubscriptionSync: complete, failSubscriptionSync: fail, markGoogleAuthorizationStale: vi.fn(),
    } as unknown as ReviewDatabase;
    const googleFetch = vi.fn(async () => response({ error:"quota" }, 500));
    await expect(synchronizeSubscriptions(db, env, userId, googleFetch)).rejects.toThrow();
    expect(complete).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith("sync-id", "google_unavailable");
  });

  it("accepts a genuine empty subscription list as a successful refresh", async () => {
    const encryptedAccess = await encryptSecret("access-token", zeroKey);
    const complete = vi.fn();
    const db = {
      beginSubscriptionSync: vi.fn(async () => ({ action:"refresh", sync_id:"sync-id" })),
      getGoogleAuthorization: vi.fn(async () => ({ encrypted_access_token:encryptedAccess, encrypted_refresh_token:"present", access_token_expires_at:new Date(Date.now()+3600_000).toISOString(), granted_scopes:[...GOOGLE_SCOPES], access_revoked_at:null })),
      completeSubscriptionSync: complete, failSubscriptionSync: vi.fn(), markGoogleAuthorizationStale: vi.fn(),
    } as unknown as ReviewDatabase;
    expect(await synchronizeSubscriptions(db, env, userId, async () => response({ items:[] }))).toEqual([]);
    expect(complete).toHaveBeenCalledWith("sync-id", userId, []);
  });

  it("returns the addendum's exact 503 body for expired Google authorization", async () => {
    const mock = supabaseExtensionAuthMock((url) => {
      if (url.endsWith("/rpc/begin_review_subscription_sync")) return response({ action:"refresh", sync_id:"sync-id" });
      if (url.includes("review_users?select=encrypted_access_token")) return response([{
        encrypted_access_token:"unused", encrypted_refresh_token:null, access_token_expires_at:new Date(0).toISOString(), granted_scopes:[...GOOGLE_SCOPES], access_revoked_at:new Date().toISOString(),
      }]);
      if (url.endsWith("/rpc/fail_review_subscription_sync")) return response(null);
      if (url.includes("review_users?id=eq.")) return response(null, 204);
      return undefined;
    });
    vi.stubGlobal("fetch", mock);
    const result = await workerFetch(extensionRequest("/api/subscriptions"), env);
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ message:"Reconnect Google in Villow to refresh your subscriptions." });
  });

  it("classifies an invalid refresh grant as reauthorization, not an empty list", async () => {
    const encryptedAccess = await encryptSecret("expired", zeroKey);
    const encryptedRefresh = await encryptSecret("revoked-refresh", zeroKey);
    const db = {
      beginSubscriptionSync: vi.fn(async () => ({ action:"refresh", sync_id:"sync-id" })),
      getGoogleAuthorization: vi.fn(async () => ({ encrypted_access_token:encryptedAccess, encrypted_refresh_token:encryptedRefresh, access_token_expires_at:new Date(0).toISOString(), granted_scopes:[...GOOGLE_SCOPES], access_revoked_at:null })),
      completeSubscriptionSync: vi.fn(), failSubscriptionSync: vi.fn(async () => undefined), markGoogleAuthorizationStale: vi.fn(async () => undefined),
    } as unknown as ReviewDatabase;
    const googleFetch = vi.fn(async () => response({ error:"invalid_grant" }, 400));
    await expect(synchronizeSubscriptions(db, env, userId, googleFetch)).rejects.toBeInstanceOf(GoogleReauthRequired);
    expect(db.completeSubscriptionSync).not.toHaveBeenCalled();
    expect(db.markGoogleAuthorizationStale).toHaveBeenCalledWith(userId);
  });
});

describe("cross-user isolation and optional routes", () => {
  it("scopes queue reads and deletes to the authenticated user id", async () => {
    const calls: string[] = [];
    const db = new ReviewDatabase(env, { fetch: vi.fn(async (input) => { calls.push(String(input)); return response([]); }) });
    await db.listQueue(userId);
    await db.deleteQueueVideo(userId, validQueue.videoId);
    expect(calls).toHaveLength(2);
    expect(calls.every((url) => url.includes(`user_id=eq.${userId}`))).toBe(true);
  });

  it("returns honest 404s for unsupported extension features", async () => {
    const result = await workerFetch(extensionRequest("/api/extension-settings"), env);
    expect(result.status).toBe(404);
  });

  it("does not serve the Worker on the main Villow host", async () => {
    const result = await workerFetch(new Request("https://villow.app/"), env);
    expect(result.status).toBe(404);
  });
});

const transportOrigins = [
  { label: "Chrome without Origin", origin: null },
  { label: "Chrome with Origin", origin: extensionOrigin },
  { label: "another Chrome installation", origin: `chrome-extension://${"b".repeat(32)}` },
  { label: "Firefox installation one", origin: "moz-extension://8c861621-7117-4eb8-b9d1-1475157284c0" },
  { label: "Firefox installation two", origin: "moz-extension://165a11ac-170f-4f1e-a41c-d75abecf969d" },
  { label: "web origin holding a bearer token", origin: "https://client.example" },
];
const validDay = {
  date: "2026-09-07", timezone: "Australia/Sydney", source: validQueue.source, client: "Chrome",
  contributed: { recommendationsSeen: 128, activeSeconds: 3600, externalSaves: 2 },
  config: { recommendationLimitPerDay: 40, saveLimitPerDay: 5, timeLimitSecondsPerDay: 1800, youTubeBlocked: false },
};
const daySnapshot = {
  totals: { recommendationsSeen: 210, activeSeconds: 5400, saves: 4 },
  saves: { [validQueue.videoId]: {
    source: validQueue.source, savedAt: "2026-09-07T05:42:00+00:00",
    present: true, played: false, title: validQueue.title, channel: validQueue.channel,
  } },
};
const extensionRoutes = [
  { path: "/api/ping", method: "GET", status: 200, result: {} },
  { path: "/api/subscriptions", method: "GET", status: 200, result: { channels: [] } },
  { path: "/api/queue", method: "POST", body: validQueue, status: 201, result: { saved: true, videoId: validQueue.videoId } },
  { path: "/api/extension-day", method: "POST", body: validDay, status: 200, result: { ...daySnapshot, date: validDay.date } },
  { path: "/api/queue/status", method: "GET", status: 200, result: { videos: {} } },
  { path: `/api/queue/${validQueue.videoId}`, method: "DELETE", status: 200, result: { removed: true } },
];

describe.each(transportOrigins)("$label transport compatibility", ({ origin }) => {
  it.each(extensionRoutes)("$method $path keeps its success contract", async ({ path, method, body, status, result }) => {
    const mock = supabaseExtensionAuthMock((url) => {
      if (url.endsWith("/rpc/save_review_queue_video")) return response({ inserted: true });
      if (url.endsWith("/rpc/sync_review_extension_day")) return response(daySnapshot);
      if (url.endsWith("/rpc/get_review_queue_status")) return response({ videos: {} });
      if (url.endsWith("/rpc/begin_review_subscription_sync")) return response({ action: "cached" });
      if (url.includes("/review_subscriptions?")) return response([]);
      if (url.includes("/review_queue_videos?")) return response([{ id: "queue-id" }]);
      return undefined;
    });
    vi.stubGlobal("fetch", mock);
    const headers = new Headers({ Authorization: `Bearer ${token}` });
    if (origin) headers.set("Origin", origin);
    if (body) headers.set("Content-Type", "application/json");
    const res = await workerFetch(new Request(`${env.REVIEW_ORIGIN}${path}`, {
      method, headers, ...(body ? { body: JSON.stringify({ ...body, client: origin?.startsWith("moz-extension:") ? "Firefox" : "Chrome" }) } : {}),
    }), env);
    if (origin) {
      const preflight = await workerFetch(new Request(`${env.REVIEW_ORIGIN}${path}`, {
        method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": method, "Access-Control-Request-Headers": "authorization,content-type" },
      }), env);
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    }
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(result);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    expect(res.headers.get("Vary")).toContain("Origin");
    expect(mock.mock.calls.some(([url]) => /googleapis|youtube\/v3|oembed/i.test(String(url)))).toBe(false);
  });
});

describe("extension bearer boundary", () => {
  it.each(extensionRoutes)("$method $path rejects missing, malformed, and revoked tokens", async ({ path, method, body }) => {
    for (const authorization of [null, "Bearer short", `Bearer ${token}`]) {
      const mock = supabaseExtensionAuthMock((url) => url.includes("review_extension_tokens?") ? response([]) : undefined);
      vi.stubGlobal("fetch", mock);
      const headers = new Headers({ Origin: transportOrigins[3].origin!, Cookie: "villow_review_session=irrelevant" });
      if (authorization) headers.set("Authorization", authorization);
      if (body) headers.set("Content-Type", "application/json");
      const res = await workerFetch(new Request(`${env.REVIEW_ORIGIN}${path}`, {
        method, headers, ...(body ? { body: JSON.stringify(body) } : {}),
      }), env);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        message: method === "DELETE" && !authorization ? "Your review session has expired." : "Invalid or revoked extension token.",
      });
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(transportOrigins[3].origin);
      if (authorization !== `Bearer ${token}`) {
        // Cookie-only DELETE uses the website session path and also fails closed.
        expect(mock).not.toHaveBeenCalled();
      } else {
        expect(mock.mock.calls).toHaveLength(1);
        const url = String(mock.mock.calls[0][0]);
        expect(url).toContain("revoked_at=is.null");
        expect(url).toContain("expires_at=gt.");
      }
    }
  });

  it("exposes Firefox rate-limit backoff and keeps 429", async () => {
    vi.stubGlobal("fetch", supabaseExtensionAuthMock((url) => url.endsWith("/rpc/check_review_rate_limit") ? response(false) : undefined));
    const res = await workerFetch(extensionRequest("/api/ping", { headers: { Origin: transportOrigins[3].origin! } }), env);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(res.headers.get("Access-Control-Expose-Headers")).toBe("Retry-After");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(transportOrigins[3].origin);
  });

  it.each([
    ["/api/extension-settings", "GET"], ["/api/extension-usage", "POST"], ["/api/screen-time", "POST"],
  ])("keeps the optional %s fallback readable from Firefox", async (path, method) => {
    const res = await workerFetch(extensionRequest(path, { method, headers: { Origin: transportOrigins[3].origin! } }), env);
    expect(res.status).toBe(404);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(transportOrigins[3].origin);
  });

  it.each([
    ["/api/me", "GET"], ["/api/queue", "GET"], ["/api/extension-tokens", "POST"],
    ["/api/logout", "POST"], ["/api/review", "DELETE"], ["/api/oauth/start", "POST"],
  ])("does not enable extension CORS for the website route %s %s", async (path, method) => {
    const headers = { Origin: "https://attacker.example" };
    const preflight = await workerFetch(new Request(`${env.REVIEW_ORIGIN}${path}`, {
      method: "OPTIONS", headers: { ...headers, "Access-Control-Request-Method": method },
    }), env);
    expect(preflight.status).toBe(403);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const res = await workerFetch(new Request(`${env.REVIEW_ORIGIN}${path}`, { method, headers }), env);
    expect([401, 403]).toContain(res.status);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });
});

describe("extension-day response date", () => {
  it("preserves Chrome receipt details when a different Firefox installation syncs", async () => {
    const otherSource = "44444444-4444-4444-8444-444444444444";
    const rpcPayloads: unknown[] = [];
    vi.stubGlobal("fetch", supabaseExtensionAuthMock((url, init) => {
      if (!url.endsWith("/rpc/sync_review_extension_day")) return undefined;
      rpcPayloads.push(JSON.parse(String(init?.body)));
      return response(daySnapshot);
    }));
    for (const [source, client, origin] of [
      [validQueue.source, "Chrome", extensionOrigin],
      [otherSource, "Firefox", transportOrigins[3].origin!],
    ]) {
      const payload = { ...validDay, source, client };
      const res = await workerFetch(extensionRequest("/api/extension-day", {
        method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(payload),
      }), env);
      expect(res.status).toBe(200);
      const snapshot = await res.json() as { saves: typeof daySnapshot.saves };
      expect(snapshot.saves).toEqual(daySnapshot.saves);
      const receipt = snapshot.saves[validQueue.videoId];
      expect(receipt.source).toBe(validQueue.source);
      expect(Date.parse(receipt.savedAt)).toBe(Date.parse("2026-09-07T05:42:00Z"));
      expect(receipt.present).toBe(true);
      expect(receipt.played).toBe(false);
      expect(receipt.title).toBe(validQueue.title);
      expect(receipt.channel).toBe(validQueue.channel);
      expect(rpcPayloads.at(-1)).toEqual({ p_user_id: userId, p_payload: payload });
    }
  });

  it.each(["Australia/Sydney", "Australia/Brisbane"])("labels a delayed snapshot with its queried local day in %s", async (timezone) => {
    const payload = { ...validDay, timezone };
    let forwarded: unknown;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-07T13:59:59Z"));
    try {
      vi.stubGlobal("fetch", supabaseExtensionAuthMock((url, init) => {
        if (!url.endsWith("/rpc/sync_review_extension_day")) return undefined;
        forwarded = JSON.parse(String(init?.body));
        vi.setSystemTime(new Date("2026-09-07T14:00:01Z")); // September 8 locally, still September 7 UTC.
        return response(daySnapshot);
      }));
      const res = await workerFetch(extensionRequest("/api/extension-day", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      }), env);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ...daySnapshot, date: "2026-09-07" });
      expect(forwarded).toEqual({ p_user_id: userId, p_payload: payload });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns the requested next day with empty totals intact", async () => {
    const payload = { ...validDay, date: "2026-09-08" };
    const empty = { totals: { recommendationsSeen: 0, activeSeconds: 0, saves: 0 }, saves: {} };
    vi.stubGlobal("fetch", supabaseExtensionAuthMock((url) => url.endsWith("/rpc/sync_review_extension_day") ? response(empty) : undefined));
    const res = await workerFetch(extensionRequest("/api/extension-day", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    }), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...empty, date: payload.date });
  });

  it("keeps a failed day query as 503 instead of returning a dated empty snapshot", async () => {
    vi.stubGlobal("fetch", supabaseExtensionAuthMock((url) => url.endsWith("/rpc/sync_review_extension_day") ? response({ message: "database unavailable" }, 500) : undefined));
    const res = await workerFetch(extensionRequest("/api/extension-day", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(validDay),
    }), env);
    expect(res.status).toBe(503);
    expect(await res.json()).not.toHaveProperty("date");
  });
});
