import { decryptSecret, encryptSecret, randomToken, sha256 } from "./crypto";
import { DatabaseError, ReviewDatabase } from "./db";
import type { Env, GoogleChannel } from "./types";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/youtube.readonly",
] as const;

const GOOGLE_EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";

export class GoogleReauthRequired extends Error {}
export class GoogleUnavailable extends Error {}
export class OAuthTransactionSetupError extends Error {
  constructor(public readonly stage: "encryption" | "storage") {
    super("OAuth transaction setup failed");
  }
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleIdentity {
  sub: string;
  email?: string;
  name?: string;
}

async function googleJson<T>(url: string, init: RequestInit, fetcher: typeof fetch): Promise<{ response: Response; body: T }> {
  const response = await fetcher(url, init);
  let body: T;
  try {
    body = await response.json() as T;
  } catch {
    throw new GoogleUnavailable("Google returned an unreadable response");
  }
  return { response, body };
}

export async function createOAuthTransaction(
  db: ReviewDatabase,
  env: Env,
  binding:
    | { inviteId: string; expectedUserId?: never; sharedInvite?: never }
    | { expectedUserId: string; inviteId?: never; sharedInvite?: never }
    | { sharedInvite: true; inviteId?: never; expectedUserId?: never },
): Promise<string> {
  const state = randomToken(32);
  const verifier = randomToken(64);
  const challenge = await sha256(verifier);
  let encryptedVerifier: string;
  try {
    encryptedVerifier = await encryptSecret(verifier, env.REVIEW_TOKEN_ENCRYPTION_KEY);
  } catch {
    throw new OAuthTransactionSetupError("encryption");
  }
  try {
    await db.createOAuthTransaction({
      stateHash: await sha256(state),
      inviteId: binding.inviteId,
      expectedUserId: binding.expectedUserId,
      sharedInvite: binding.sharedInvite,
      encryptedVerifier,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    throw new OAuthTransactionSetupError("storage");
  }

  const redirectUri = `${new URL(env.REVIEW_ORIGIN).origin}/api/oauth/callback`;
  const params = new URLSearchParams({
    client_id: env.REVIEW_GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent select_account",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeAuthorizationCode(
  env: Env,
  code: string,
  verifier: string,
  fetcher: typeof fetch = fetch,
): Promise<GoogleTokenResponse> {
  const redirectUri = `${new URL(env.REVIEW_ORIGIN).origin}/api/oauth/callback`;
  const { response, body } = await googleJson<GoogleTokenResponse>("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.REVIEW_GOOGLE_CLIENT_ID,
      client_secret: env.REVIEW_GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  }, fetcher);
  if (!response.ok || !body.access_token) throw new GoogleReauthRequired("Google authorization code was rejected");
  return body;
}

export async function fetchGoogleIdentity(accessToken: string, fetcher: typeof fetch = fetch): Promise<GoogleIdentity> {
  const { response, body } = await googleJson<GoogleIdentity>("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  }, fetcher);
  if (!response.ok || !body.sub) throw new GoogleReauthRequired("Google identity was unavailable");
  return body;
}

export function grantedScopes(token: GoogleTokenResponse): string[] {
  return (token.scope || "").split(/\s+/).filter(Boolean);
}

export function hasRequiredScopes(scopes: string[]): boolean {
  const granted = new Set(scopes);
  return granted.has("openid")
    && (granted.has("email") || granted.has(GOOGLE_EMAIL_SCOPE))
    && granted.has("https://www.googleapis.com/auth/youtube.readonly");
}

async function refreshAccessToken(
  env: Env,
  refreshToken: string,
  fetcher: typeof fetch,
): Promise<GoogleTokenResponse> {
  const { response, body } = await googleJson<GoogleTokenResponse>("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.REVIEW_GOOGLE_CLIENT_ID,
      client_secret: env.REVIEW_GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  }, fetcher);
  if (!response.ok || !body.access_token) {
    if (body.error === "invalid_grant" || response.status === 400 || response.status === 401) throw new GoogleReauthRequired("Google grant expired or was revoked");
    throw new GoogleUnavailable("Google token service is unavailable");
  }
  return body;
}

async function accessTokenForUser(
  db: ReviewDatabase,
  env: Env,
  userId: string,
  forceRefresh: boolean,
  fetcher: typeof fetch,
): Promise<string> {
  const auth = await db.getGoogleAuthorization(userId);
  if (!auth || auth.access_revoked_at || !auth.encrypted_refresh_token || !hasRequiredScopes(auth.granted_scopes || [])) {
    throw new GoogleReauthRequired("Google authorization is stale");
  }
  const expiresSoon = new Date(auth.access_token_expires_at).getTime() <= Date.now() + 60_000;
  if (!forceRefresh && !expiresSoon) return decryptSecret(auth.encrypted_access_token, env.REVIEW_TOKEN_ENCRYPTION_KEY);
  const refreshToken = await decryptSecret(auth.encrypted_refresh_token, env.REVIEW_TOKEN_ENCRYPTION_KEY);
  const refreshed = await refreshAccessToken(env, refreshToken, fetcher);
  const refreshedScopes = grantedScopes(refreshed);
  if (refreshedScopes.length && !hasRequiredScopes(refreshedScopes)) throw new GoogleReauthRequired("Required scope was not renewed");
  const encryptedRefresh = refreshed.refresh_token
    ? await encryptSecret(refreshed.refresh_token, env.REVIEW_TOKEN_ENCRYPTION_KEY)
    : undefined;
  await db.updateGoogleTokens(
    userId,
    await encryptSecret(refreshed.access_token, env.REVIEW_TOKEN_ENCRYPTION_KEY),
    new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
    encryptedRefresh,
  );
  return refreshed.access_token;
}

interface SubscriptionPage {
  nextPageToken?: string;
  items?: Array<{ snippet?: { title?: string; resourceId?: { channelId?: string } } }>;
  error?: unknown;
}

interface ChannelPage {
  items?: Array<{ id?: string; snippet?: { title?: string; customUrl?: string } }>;
  error?: unknown;
}

async function youtubeRequest<T>(url: string, accessToken: string, fetcher: typeof fetch): Promise<T> {
  const { response, body } = await googleJson<T>(url, { headers: { Authorization: `Bearer ${accessToken}` } }, fetcher);
  const reasons = ((body as { error?: { errors?: Array<{ reason?: string }> } }).error?.errors || []).map((item) => item.reason);
  if (response.status === 401 || (response.status === 403 && reasons.includes("insufficientPermissions"))) {
    throw new GoogleReauthRequired("YouTube rejected the Google grant");
  }
  if (!response.ok) throw new GoogleUnavailable(`YouTube request failed with ${response.status}`);
  return body;
}

async function readAllSubscriptions(accessToken: string, fetcher: typeof fetch): Promise<GoogleChannel[]> {
  const byId = new Map<string, GoogleChannel>();
  let pageToken: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const params = new URLSearchParams({ part: "snippet", mine: "true", maxResults: "50" });
    if (pageToken) params.set("pageToken", pageToken);
    const body = await youtubeRequest<SubscriptionPage>(`https://www.googleapis.com/youtube/v3/subscriptions?${params}`, accessToken, fetcher);
    for (const item of body.items || []) {
      const channelId = item.snippet?.resourceId?.channelId;
      if (!channelId || !/^UC[A-Za-z0-9_-]{22}$/.test(channelId)) continue;
      const title = item.snippet?.title?.trim();
      byId.set(channelId, { channelId, ...(title ? { title: title.slice(0, 200) } : {}) });
    }
    pageToken = body.nextPageToken;
    if (!pageToken) break;
    if (page === 99) throw new GoogleUnavailable("Subscription pagination exceeded the safety limit");
  }

  const ids = [...byId.keys()];
  for (let start = 0; start < ids.length; start += 50) {
    const batch = ids.slice(start, start + 50);
    const params = new URLSearchParams({ part: "snippet", id: batch.join(","), maxResults: "50" });
    const body = await youtubeRequest<ChannelPage>(`https://www.googleapis.com/youtube/v3/channels?${params}`, accessToken, fetcher);
    for (const item of body.items || []) {
      if (!item.id || !byId.has(item.id)) continue;
      const current = byId.get(item.id)!;
      const title = item.snippet?.title?.trim();
      const customUrl = item.snippet?.customUrl?.trim().replace(/^@/, "");
      byId.set(item.id, {
        channelId: item.id,
        ...(customUrl ? { handle: customUrl.slice(0, 100) } : {}),
        ...((title || current.title) ? { title: (title || current.title)!.slice(0, 200) } : {}),
      });
    }
  }
  return [...byId.values()];
}

export async function synchronizeSubscriptions(
  db: ReviewDatabase,
  env: Env,
  userId: string,
  fetcher: typeof fetch = fetch,
): Promise<GoogleChannel[]> {
  const sync = await db.beginSubscriptionSync(userId);
  if (sync.action === "cached") return db.listSubscriptions(userId);
  if (sync.action === "busy") {
    const cached = await db.listSubscriptions(userId);
    if (cached.length === 0) throw new GoogleUnavailable("Subscription refresh is already running");
    return cached;
  }
  if (!sync.sync_id) throw new GoogleUnavailable("Subscription sync did not start");
  try {
    let accessToken = await accessTokenForUser(db, env, userId, false, fetcher);
    let channels: GoogleChannel[];
    try {
      channels = await readAllSubscriptions(accessToken, fetcher);
    } catch (error) {
      if (!(error instanceof GoogleReauthRequired)) throw error;
      accessToken = await accessTokenForUser(db, env, userId, true, fetcher);
      channels = await readAllSubscriptions(accessToken, fetcher);
    }
    await db.completeSubscriptionSync(sync.sync_id, userId, channels);
    return channels;
  } catch (error) {
    const category = error instanceof GoogleReauthRequired ? "google_reauth_required" : "google_unavailable";
    await db.failSubscriptionSync(sync.sync_id, category).catch(() => undefined);
    if (error instanceof GoogleReauthRequired) await db.markGoogleAuthorizationStale(userId).catch(() => undefined);
    if (error instanceof DatabaseError) throw new GoogleUnavailable("Subscription storage failed");
    throw error;
  }
}
