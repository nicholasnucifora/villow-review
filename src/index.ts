import { constantTimeEqual, decryptSecret, encryptSecret, randomToken, sha256, signValue, verifySignedValue } from "./crypto";
import { DatabaseError, ReviewDatabase, supabaseRequestHeaders } from "./db";
import {
  createOAuthTransaction, exchangeAuthorizationCode, fetchGoogleIdentity, GoogleReauthRequired,
  GoogleUnavailable, grantedScopes, hasRequiredScopes, OAuthTransactionSetupError, synchronizeSubscriptions,
} from "./google";
import {
  finalize, html, HttpError, isAllowedExtensionOrigin, isExpectedHost, json, preflight,
  readJson, redirect, requireSameOrigin,
} from "./http";
import type { Env, ExtensionAuth, SessionAuth } from "./types";
import { reviewCss, reviewHtml, reviewJs } from "./ui";
import { validateExtensionDay, validateQueuePayload, validateVideoId } from "./validation";

const SESSION_COOKIE = "villow_review_session";
const CSRF_COOKIE = "villow_review_csrf";
const INVITE_COOKIE = "villow_review_invited";
const INVITE_COOKIE_VALUE = "shared-invite-v1";
const GOOGLE_REAUTH_MESSAGE = "Reconnect Google in Villow to refresh your subscriptions.";

function cookieValue(request: Request, name: string): string | null {
  const cookies = request.headers.get("Cookie") || "";
  for (const item of cookies.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) return decodeURIComponent(item.slice(separator + 1).trim());
  }
  return null;
}

function cookie(name: string, value: string, env: Env, options: { httpOnly?: boolean; maxAge?: number } = {}): string {
  const secure = new URL(env.REVIEW_ORIGIN).protocol === "https:" ? "; Secure" : "";
  const httpOnly = options.httpOnly ? "; HttpOnly" : "";
  const maxAge = options.maxAge === undefined ? "" : `; Max-Age=${options.maxAge}`;
  return `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax${secure}${httpOnly}${maxAge}`;
}

function withCookies(response: Response, values: string[]): Response {
  const headers = new Headers(response.headers);
  for (const value of values) headers.append("Set-Cookie", value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function clearCookies(env: Env): string[] {
  return [cookie(SESSION_COOKIE, "", env, { httpOnly: true, maxAge: 0 }), cookie(CSRF_COOKIE, "", env, { maxAge: 0 })];
}

function reviewInviteToken(env: Env): string {
  if (typeof env.REVIEW_INVITE_TOKEN !== "string" || env.REVIEW_INVITE_TOKEN.length === 0) {
    throw new Error("Review invitation secret is not configured");
  }
  return env.REVIEW_INVITE_TOKEN;
}

async function invitationCookieValue(env: Env): Promise<string> {
  return signValue(INVITE_COOKIE_VALUE, await sha256(reviewInviteToken(env)));
}

async function hasInvitationAccess(request: Request, env: Env): Promise<boolean> {
  const signed = cookieValue(request, INVITE_COOKIE);
  if (!signed) return false;
  return await verifySignedValue(signed, await sha256(reviewInviteToken(env))) === INVITE_COOKIE_VALUE;
}

async function sessionAuth(request: Request, env: Env, db: ReviewDatabase): Promise<SessionAuth | null> {
  const signed = cookieValue(request, SESSION_COOKIE);
  if (!signed) return null;
  const raw = await verifySignedValue(signed, env.REVIEW_SESSION_SIGNING_KEY);
  if (!raw || !/^[A-Za-z0-9_-]{40,200}$/.test(raw)) return null;
  return db.getSession(await sha256(raw));
}

async function requireSession(request: Request, env: Env, db: ReviewDatabase, csrf = false): Promise<SessionAuth> {
  const auth = await sessionAuth(request, env, db);
  if (!auth) throw new HttpError(401, "Your review session has expired.");
  if (csrf) {
    if (!requireSameOrigin(request, env)) throw new HttpError(403, "Request origin was rejected.");
    const header = request.headers.get("X-CSRF-Token");
    const cookieToken = cookieValue(request, CSRF_COOKIE);
    if (!header || !cookieToken || header !== cookieToken || await sha256(header) !== auth.csrfHash) {
      throw new HttpError(403, "Security check failed. Reload and try again.");
    }
  }
  return auth;
}

async function requireExtension(request: Request, env: Env, db: ReviewDatabase): Promise<ExtensionAuth> {
  if (!isAllowedExtensionOrigin(request, env)) throw new HttpError(403, "Extension origin is not allowed.");
  const authorization = request.headers.get("Authorization") || "";
  const match = /^Bearer ([A-Za-z0-9_-]{40,200})$/.exec(authorization);
  if (!match) throw new HttpError(401, "Invalid or revoked extension token.");
  const auth = await db.authenticateExtension(await sha256(match[1]));
  if (!auth) throw new HttpError(401, "Invalid or revoked extension token.");
  return auth;
}

async function rateLimit(env: Env, scope: string, keyHash: string, maximum: number, windowSeconds: number): Promise<boolean> {
  const response = await fetch(`${env.REVIEW_SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/check_review_rate_limit`, {
    method: "POST",
    headers: supabaseRequestHeaders(env.REVIEW_SUPABASE_SERVICE_ROLE_KEY),
    body: JSON.stringify({ p_scope: scope, p_key_hash: keyHash, p_maximum: maximum, p_window_seconds: windowSeconds }),
  });
  if (!response.ok) throw new DatabaseError("Rate limit check failed", response.status);
  return Boolean(await response.json());
}

async function requireRateLimit(env: Env, scope: string, key: string, maximum: number, windowSeconds: number): Promise<void> {
  if (!await rateLimit(env, scope, await sha256(key), maximum, windowSeconds)) {
    const error = new HttpError(429, "Too many requests. Try again shortly.");
    Object.assign(error, { retryAfter: Math.min(windowSeconds, 300) });
    throw error;
  }
}

async function handleInvitation(request: Request, env: Env): Promise<Response> {
  if (!requireSameOrigin(request, env)) throw new HttpError(403, "Request origin was rejected.");
  const body = await readJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Invitation is invalid.");
  const input = body as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || typeof input.token !== "string" || input.token.length === 0 || input.token.length > 2_048) {
    throw new HttpError(400, "This invitation could not be used.");
  }
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!await constantTimeEqual(input.token, reviewInviteToken(env))) {
    try {
      await requireRateLimit(env, "invitation", ip, 12, 600);
    } catch (error) {
      if (error instanceof HttpError && error.status === 429) throw error;
      // The high-entropy secret still fails closed when the rate-limit store is unavailable.
    }
    throw new HttpError(403, "This invitation could not be used.");
  }
  return withCookies(json({ invited: true }), [
    cookie(INVITE_COOKIE, await invitationCookieValue(env), env, { httpOnly: true }),
  ]);
}

async function handleOAuthStart(request: Request, env: Env, db: ReviewDatabase): Promise<Response> {
  if (!requireSameOrigin(request, env)) throw new HttpError(403, "Request origin was rejected.");
  const body = await readJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body as Record<string, unknown>).length !== 0) {
    throw new HttpError(400, "Request is invalid.");
  }
  if (!await hasInvitationAccess(request, env)) throw new HttpError(403, "A valid review invitation is required.");
  try {
    const authorizeUrl = await createOAuthTransaction(db, env, { sharedInvite: true });
    return json({ authorizeUrl });
  } catch (error) {
    let reference = "OAUTH_RUNTIME";
    if (error instanceof DatabaseError) {
      if (error.status === 401 || error.status === 403 || error.code === "42501") {
        reference = "OAUTH_STORAGE_AUTH";
      } else if (
        error.code === "PGRST202" ||
        error.code === "PGRST204" ||
        error.code === "23514" ||
        /shared_invite|schema cache|column/i.test(error.message)
      ) {
        reference = "OAUTH_STORAGE_SCHEMA";
      } else {
        reference = `OAUTH_STORAGE_${error.status}`;
      }
    } else if (error instanceof OAuthTransactionSetupError) {
      reference = error.stage === "encryption" ? "OAUTH_ENCRYPTION_KEY" : "OAUTH_STORAGE_NETWORK";
    }
    throw new HttpError(503, `Google sign-in could not be started. Reference: ${reference}.`);
  }
}

async function handleOAuthCallback(request: Request, env: Env, db: ReviewDatabase): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !state || !code || !/^[A-Za-z0-9_-]{40,200}$/.test(state) || code.length > 2048) {
    return redirect("/?oauth=failed");
  }
  const transaction = await db.consumeOAuthTransaction(await sha256(state));
  if (!transaction) return redirect("/?oauth=expired");
  try {
    const verifier = await decryptSecret(transaction.encrypted_code_verifier, env.REVIEW_TOKEN_ENCRYPTION_KEY);
    const tokens = await exchangeAuthorizationCode(env, code, verifier);
    const scopes = grantedScopes(tokens);
    if (!hasRequiredScopes(scopes)) return redirect("/?oauth=scope");
    const identity = await fetchGoogleIdentity(tokens.access_token);
    const userId = await db.completeOAuth({
      inviteId: transaction.invite_id,
      expectedUserId: transaction.expected_user_id,
      sharedInvite: transaction.shared_invite,
      googleSubject: identity.sub,
      email: identity.email || null,
      displayName: identity.name || null,
      encryptedAccessToken: await encryptSecret(tokens.access_token, env.REVIEW_TOKEN_ENCRYPTION_KEY),
      encryptedRefreshToken: tokens.refresh_token ? await encryptSecret(tokens.refresh_token, env.REVIEW_TOKEN_ENCRYPTION_KEY) : null,
      accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      grantedScopes: scopes,
    });
    const sessionToken = randomToken(48);
    const csrfToken = randomToken(32);
    await db.createSession(userId, await sha256(sessionToken), await sha256(csrfToken), new Date(Date.now() + 12 * 60 * 60_000).toISOString());
    const signedSession = await signValue(sessionToken, env.REVIEW_SESSION_SIGNING_KEY);
    return withCookies(redirect("/?connected=1"), [
      cookie(SESSION_COOKIE, signedSession, env, { httpOnly: true, maxAge: 43_200 }),
      cookie(CSRF_COOKIE, csrfToken, env, { maxAge: 43_200 }),
    ]);
  } catch (error) {
    if (error instanceof DatabaseError && /invitation|different google account/i.test(error.message)) return redirect("/?oauth=account");
    return redirect("/?oauth=failed");
  }
}

async function handleApi(request: Request, env: Env, db: ReviewDatabase): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "POST" && path === "/api/invitations/validate") return handleInvitation(request, env);
  if (request.method === "GET" && path === "/api/invitations/status") return json({ invited: await hasInvitationAccess(request, env) });
  if (request.method === "POST" && path === "/api/oauth/start") return handleOAuthStart(request, env, db);
  if (request.method === "GET" && path === "/api/oauth/callback") return handleOAuthCallback(request, env, db);

  if (request.method === "GET" && path === "/api/me") {
    const auth = await requireSession(request, env, db);
    const csrfToken = cookieValue(request, CSRF_COOKIE);
    if (!csrfToken || await sha256(csrfToken) !== auth.csrfHash) throw new HttpError(401, "Your review session has expired.");
    return json({ user: auth.user, csrfToken });
  }

  if (request.method === "POST" && path === "/api/logout") {
    const auth = await requireSession(request, env, db, true);
    await db.revokeSession(auth.sessionId);
    return withCookies(json({ signedOut: true }), clearCookies(env));
  }

  if (request.method === "DELETE" && path === "/api/review") {
    const auth = await requireSession(request, env, db, true);
    const body = await readJson(request) as Record<string, unknown>;
    if (body.confirmation !== "FORGET") throw new HttpError(400, "Confirmation did not match.");
    await db.forgetUser(auth.user.id);
    return withCookies(json({ forgotten: true }), clearCookies(env));
  }

  if (request.method === "POST" && path === "/api/google/reconnect") {
    const auth = await requireSession(request, env, db, true);
    const authorizeUrl = await createOAuthTransaction(db, env, { expectedUserId: auth.user.id });
    return json({ authorizeUrl });
  }

  if (request.method === "GET" && path === "/api/subscriptions/status") {
    const auth = await requireSession(request, env, db);
    return json(await db.subscriptionStatus(auth.user.id));
  }

  if (path === "/api/extension-tokens" && request.method === "GET") {
    const auth = await requireSession(request, env, db);
    return json({ tokens: await db.listExtensionTokens(auth.user.id) });
  }
  if (path === "/api/extension-tokens" && request.method === "POST") {
    const auth = await requireSession(request, env, db, true);
    const body = await readJson(request);
    const label = body && typeof body === "object" && !Array.isArray(body) && typeof (body as Record<string, unknown>).label === "string"
      ? ((body as Record<string, unknown>).label as string).trim().slice(0, 80)
      : "Review extension";
    const token = randomToken(48);
    const row = await db.createExtensionToken(auth.user.id, await sha256(token), label || "Review extension", new Date(Date.now() + 30 * 86_400_000).toISOString());
    return json({ token: { id: row.id, createdAt: row.created_at, expiresAt: row.expires_at }, connectLink: `${new URL(env.REVIEW_ORIGIN).origin}/connect#villow_token=${token}` }, 201);
  }
  const extensionTokenMatch = /^\/api\/extension-tokens\/([0-9a-f-]{36})$/i.exec(path);
  if (extensionTokenMatch && request.method === "DELETE") {
    const auth = await requireSession(request, env, db, true);
    const removed = await db.revokeExtensionToken(auth.user.id, extensionTokenMatch[1]);
    return removed ? json({ revoked: true }) : json({ message: "Token not found." }, 404);
  }

  if (path === "/api/ping" && request.method === "GET") {
    const auth = await requireExtension(request, env, db);
    await requireRateLimit(env, "ping", auth.tokenId, 60, 60);
    return json({});
  }

  if (path === "/api/subscriptions" && request.method === "GET") {
    const auth = await requireExtension(request, env, db);
    await requireRateLimit(env, "subscriptions", auth.tokenId, 30, 3600);
    try {
      const channels = await synchronizeSubscriptions(db, env, auth.userId);
      return json({ channels });
    } catch (error) {
      if (error instanceof GoogleReauthRequired) return json({ message: GOOGLE_REAUTH_MESSAGE }, 503);
      if (error instanceof GoogleUnavailable || error instanceof DatabaseError) return json({ message: "Subscriptions could not be refreshed. Try again shortly." }, 503);
      throw error;
    }
  }

  if (path === "/api/queue" && request.method === "POST") {
    const auth = await requireExtension(request, env, db);
    await requireRateLimit(env, "queue", auth.tokenId, 240, 60);
    const payload = validateQueuePayload(await readJson(request));
    const inserted = await db.saveQueueVideo(auth, payload);
    return inserted ? json({ saved: true, videoId: payload.videoId }, 201) : json({ message: "Video already exists in this review queue." }, 409);
  }

  if (path === "/api/queue" && request.method === "GET") {
    const auth = await requireSession(request, env, db);
    return json({ videos: await db.listQueue(auth.user.id) });
  }

  if (path === "/api/extension-day" && request.method === "POST") {
    const auth = await requireExtension(request, env, db);
    await requireRateLimit(env, "extension_day", auth.tokenId, 180, 60);
    const payload = validateExtensionDay(await readJson(request));
    return json(await db.extensionDay(auth.userId, payload as unknown as Record<string, unknown>));
  }

  if (path === "/api/queue/status" && request.method === "GET") {
    const auth = await requireExtension(request, env, db);
    await requireRateLimit(env, "queue_status", auth.tokenId, 120, 60);
    return json(await db.queueStatus(auth.userId));
  }

  const queueDeleteMatch = /^\/api\/queue\/([^/]+)$/.exec(path);
  if (queueDeleteMatch && request.method === "DELETE") {
    const videoId = validateVideoId(decodeURIComponent(queueDeleteMatch[1]));
    let userId: string;
    if (request.headers.has("Authorization")) userId = (await requireExtension(request, env, db)).userId;
    else userId = (await requireSession(request, env, db, true)).user.id;
    const deleted = await db.deleteQueueVideo(userId, videoId);
    return deleted ? json({ removed: true }) : json({ message: "Video not found." }, 404);
  }

  // These extension routes are intentionally unsupported. A 404 activates the extension's documented fallback.
  if (["/api/extension-settings", "/api/extension-usage", "/api/screen-time"].includes(path)) return json({ message: "Not supported by the review environment." }, 404);
  return json({ message: "Not found." }, 404);
}

async function route(request: Request, env: Env): Promise<Response> {
  if (!isExpectedHost(request, env)) return json({ message: "Not found." }, 404);
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return preflight(request, env);
  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/connect")) return html(reviewHtml);
  if (request.method === "GET" && url.pathname === "/assets/review.css") return new Response(reviewCss, { headers: { "Content-Type": "text/css; charset=utf-8" } });
  if (request.method === "GET" && url.pathname === "/assets/review.js") return new Response(reviewJs, { headers: { "Content-Type": "text/javascript; charset=utf-8" } });
  if (request.method === "GET" && url.pathname === "/robots.txt") return new Response("User-agent: *\nDisallow: /\n", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  if (url.pathname.startsWith("/api/")) return handleApi(request, env, new ReviewDatabase(env));
  return json({ message: "Not found." }, 404);
}

export async function workerFetch(request: Request, env: Env): Promise<Response> {
  try {
    return finalize(request, await route(request, env), env);
  } catch (error) {
    if (error instanceof HttpError) {
      const headers: HeadersInit = error.status === 429
        ? { "Retry-After": String((error as HttpError & { retryAfter?: number }).retryAfter || 60) }
        : {};
      return finalize(request, json({ message: error.message }, error.status, headers), env);
    }
    return finalize(request, json({ message: "The review environment is temporarily unavailable." }, 503), env);
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return workerFetch(request, env);
  },
};
