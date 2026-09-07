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
  ALLOWED_EXTENSION_ORIGINS: extensionOrigin,
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
  it("answers allowed preflight with the exact origin and Vary", async () => {
    const result = await workerFetch(extensionRequest("/api/queue", {
      method: "OPTIONS",
      headers: { Origin: extensionOrigin, "Access-Control-Request-Headers": "authorization,content-type" },
    }), env);
    expect(result.status).toBe(204);
    expect(result.headers.get("Access-Control-Allow-Origin")).toBe(extensionOrigin);
    expect(result.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
    expect(result.headers.get("Vary")).toContain("Origin");
    expect(result.headers.get("Access-Control-Expose-Headers")).toContain("Retry-After");
  });

  it("rejects an unconfigured development extension origin", async () => {
    const result = await workerFetch(new Request("https://review.villow.app/api/ping", {
      headers: { Origin: `chrome-extension://${"b".repeat(32)}`, Authorization: `Bearer ${token}` },
    }), env);
    expect(result.status).toBe(403);
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
