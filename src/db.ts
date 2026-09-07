import type { AuthenticatedUser, Env, ExtensionAuth, GoogleChannel, QueuePayload, SessionAuth } from "./types";

export class DatabaseError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

interface DbOptions {
  fetch?: typeof fetch;
}

/**
 * Supabase's modern sb_secret_ keys are opaque API keys, not JWTs, so they
 * must not be placed in the Authorization header. Keep legacy service-role
 * JWT compatibility while projects transition to the new key format.
 */
export function supabaseRequestHeaders(key: string, extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("apikey", key);
  headers.set("Content-Type", "application/json");
  if (!key.startsWith("sb_secret_")) headers.set("Authorization", `Bearer ${key}`);
  return headers;
}

export function supabaseRestUrl(baseUrl: string, path: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "").replace(/\/rest\/v1$/i, "");
  return `${base}/rest/v1/${path}`;
}

export class ReviewDatabase {
  private readonly fetcher: typeof fetch;

  constructor(private readonly env: Env, options: DbOptions = {}) {
    this.fetcher = options.fetch || fetch;
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const fetcher = this.fetcher;
    const response = await fetcher(supabaseRestUrl(this.env.REVIEW_SUPABASE_URL, path), {
      ...init,
      headers: supabaseRequestHeaders(this.env.REVIEW_SUPABASE_SERVICE_ROLE_KEY, init.headers),
    });
    if (!response.ok) {
      let detail: { message?: string; code?: string } = {};
      try { detail = await response.json() as typeof detail; } catch { /* intentionally empty */ }
      throw new DatabaseError(detail.message || "Review database request failed", response.status, detail.code);
    }
    if (response.status === 204) return undefined as T;
    const body = await response.text();
    return (body ? JSON.parse(body) : undefined) as T;
  }

  private rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
    return this.call<T>(`rpc/${name}`, { method: "POST", body: JSON.stringify(body) });
  }

  async createOAuthTransaction(input: {
    stateHash: string;
    inviteId?: string;
    expectedUserId?: string;
    sharedInvite?: boolean;
    encryptedVerifier: string;
    expiresAt: string;
  }): Promise<void> {
    await this.call("review_oauth_transactions", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        state_hash: input.stateHash,
        invite_id: input.inviteId || null,
        expected_user_id: input.expectedUserId || null,
        shared_invite: input.sharedInvite || false,
        encrypted_code_verifier: input.encryptedVerifier,
        expires_at: input.expiresAt,
      }),
    });
  }

  async consumeOAuthTransaction(stateHash: string): Promise<{
    id: string;
    invite_id: string | null;
    expected_user_id: string | null;
    shared_invite: boolean;
    encrypted_code_verifier: string;
  } | null> {
    const rows = await this.rpc<Array<{
      id: string;
      invite_id: string | null;
      expected_user_id: string | null;
      shared_invite: boolean;
      encrypted_code_verifier: string;
    }>>("consume_review_oauth_transaction", { p_state_hash: stateHash });
    return rows[0] || null;
  }

  async completeOAuth(input: {
    inviteId: string | null;
    expectedUserId: string | null;
    sharedInvite: boolean;
    googleSubject: string;
    email: string | null;
    displayName: string | null;
    encryptedAccessToken: string;
    encryptedRefreshToken: string | null;
    accessTokenExpiresAt: string;
    grantedScopes: string[];
  }): Promise<string> {
    const result = await this.rpc<{ user_id: string } | Array<{ user_id: string }>>("complete_review_oauth", {
      p_invite_id: input.inviteId,
      p_expected_user_id: input.expectedUserId,
      p_shared_invite: input.sharedInvite,
      p_google_subject: input.googleSubject,
      p_email: input.email,
      p_display_name: input.displayName,
      p_encrypted_access_token: input.encryptedAccessToken,
      p_encrypted_refresh_token: input.encryptedRefreshToken,
      p_access_token_expires_at: input.accessTokenExpiresAt,
      p_granted_scopes: input.grantedScopes,
    });
    const row = Array.isArray(result) ? result[0] : result;
    if (!row?.user_id) throw new DatabaseError("OAuth completion returned no user", 500);
    return row.user_id;
  }

  async createSession(userId: string, tokenHash: string, csrfHash: string, expiresAt: string): Promise<string> {
    const rows = await this.call<Array<{ id: string }>>("review_sessions?select=id", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ user_id: userId, session_token_hash: tokenHash, csrf_token_hash: csrfHash, expires_at: expiresAt }),
    });
    return rows[0].id;
  }

  async getSession(tokenHash: string): Promise<SessionAuth | null> {
    const rows = await this.call<Array<{
      id: string;
      csrf_token_hash: string;
      review_users: {
        id: string;
        email: string | null;
        display_name: string | null;
        google_authorized_at: string | null;
        access_revoked_at: string | null;
      };
    }>>(
      `review_sessions?select=id,csrf_token_hash,review_users!inner(id,email,display_name,google_authorized_at,access_revoked_at)&session_token_hash=eq.${encodeURIComponent(tokenHash)}&revoked_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`,
    );
    const row = rows[0];
    if (!row) return null;
    return {
      sessionId: row.id,
      csrfHash: row.csrf_token_hash,
      user: {
        id: row.review_users.id,
        email: row.review_users.email,
        displayName: row.review_users.display_name,
        googleAuthorizedAt: row.review_users.google_authorized_at,
        accessRevokedAt: row.review_users.access_revoked_at,
      },
    };
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.call(`review_sessions?id=eq.${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ revoked_at: new Date().toISOString() }),
    });
  }

  async authenticateExtension(tokenHash: string): Promise<ExtensionAuth | null> {
    const rows = await this.call<Array<{ id: string; user_id: string }>>(
      `review_extension_tokens?select=id,user_id&token_hash=eq.${encodeURIComponent(tokenHash)}&revoked_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`,
    );
    const row = rows[0];
    if (!row) return null;
    void this.call(`review_extension_tokens?id=eq.${encodeURIComponent(row.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ last_used_at: new Date().toISOString() }),
    }).catch(() => undefined);
    return { userId: row.user_id, tokenId: row.id };
  }

  async createExtensionToken(userId: string, tokenHash: string, label: string, expiresAt: string): Promise<{ id: string; created_at: string; expires_at: string }> {
    const rows = await this.call<Array<{ id: string; created_at: string; expires_at: string }>>("review_extension_tokens?select=id,created_at,expires_at", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ user_id: userId, token_hash: tokenHash, label, expires_at: expiresAt }),
    });
    return rows[0];
  }

  listExtensionTokens(userId: string): Promise<Array<Record<string, unknown>>> {
    return this.call(`review_extension_tokens?select=id,label,created_at,expires_at,revoked_at,last_used_at&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc`);
  }

  async revokeExtensionToken(userId: string, tokenId: string): Promise<boolean> {
    const rows = await this.call<Array<{ id: string }>>(`review_extension_tokens?select=id&user_id=eq.${encodeURIComponent(userId)}&id=eq.${encodeURIComponent(tokenId)}&revoked_at=is.null`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ revoked_at: new Date().toISOString() }),
    });
    return rows.length > 0;
  }

  async saveQueueVideo(auth: ExtensionAuth, payload: QueuePayload): Promise<boolean> {
    const result = await this.rpc<{ inserted: boolean } | Array<{ inserted: boolean }>>("save_review_queue_video", {
      p_user_id: auth.userId,
      p_extension_token_id: auth.tokenId,
      p_youtube_video_id: payload.videoId,
      p_title: payload.title,
      p_channel_name: payload.channel,
      p_channel_url: payload.channelUrl,
      p_duration_text: payload.duration,
      p_is_live: payload.isLive,
      p_view_count_text: payload.viewCountText,
      p_published_text: payload.publishedText,
      p_metadata_text: payload.metadataText,
      p_thumbnail_url: payload.thumbnail,
      p_source_id: payload.source,
      p_client: payload.client,
      p_metadata_version: 1,
    });
    const row = Array.isArray(result) ? result[0] : result;
    return Boolean(row?.inserted);
  }

  listQueue(userId: string): Promise<Array<Record<string, unknown>>> {
    return this.call(
      `review_queue_videos?select=id,youtube_video_id,title,channel_name,thumbnail_url,duration_text,is_live,client,saved_at&user_id=eq.${encodeURIComponent(userId)}&order=saved_at.desc&limit=200`,
    );
  }

  async deleteQueueVideo(userId: string, videoId: string): Promise<boolean> {
    const rows = await this.call<Array<{ id: string }>>(
      `review_queue_videos?select=id&user_id=eq.${encodeURIComponent(userId)}&youtube_video_id=eq.${encodeURIComponent(videoId)}`,
      { method: "DELETE", headers: { Prefer: "return=representation" } },
    );
    return rows.length > 0;
  }

  extensionDay(userId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.rpc("sync_review_extension_day", { p_user_id: userId, p_payload: payload });
  }

  queueStatus(userId: string): Promise<{ videos: Record<string, { played: boolean; present: boolean }> }> {
    return this.rpc("get_review_queue_status", { p_user_id: userId });
  }

  async getGoogleAuthorization(userId: string): Promise<{
    encrypted_access_token: string;
    encrypted_refresh_token: string | null;
    access_token_expires_at: string;
    granted_scopes: string[];
    access_revoked_at: string | null;
  } | null> {
    const rows = await this.call<Array<{
      encrypted_access_token: string;
      encrypted_refresh_token: string | null;
      access_token_expires_at: string;
      granted_scopes: string[];
      access_revoked_at: string | null;
    }>>(`review_users?select=encrypted_access_token,encrypted_refresh_token,access_token_expires_at,granted_scopes,access_revoked_at&id=eq.${encodeURIComponent(userId)}&limit=1`);
    return rows[0] || null;
  }

  async updateGoogleTokens(userId: string, encryptedAccessToken: string, expiresAt: string, encryptedRefreshToken?: string): Promise<void> {
    await this.call(`review_users?id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        encrypted_access_token: encryptedAccessToken,
        access_token_expires_at: expiresAt,
        ...(encryptedRefreshToken ? { encrypted_refresh_token: encryptedRefreshToken } : {}),
        access_revoked_at: null,
      }),
    });
  }

  async markGoogleAuthorizationStale(userId: string): Promise<void> {
    await this.call(`review_users?id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ access_revoked_at: new Date().toISOString() }),
    });
  }

  beginSubscriptionSync(userId: string): Promise<{ action: "refresh" | "cached" | "busy"; sync_id?: string }> {
    return this.rpc("begin_review_subscription_sync", { p_user_id: userId });
  }

  completeSubscriptionSync(syncId: string, userId: string, channels: GoogleChannel[]): Promise<void> {
    return this.rpc("complete_review_subscription_sync", { p_sync_id: syncId, p_user_id: userId, p_channels: channels });
  }

  failSubscriptionSync(syncId: string, category: string): Promise<void> {
    return this.rpc("fail_review_subscription_sync", { p_sync_id: syncId, p_error_category: category });
  }

  listSubscriptions(userId: string): Promise<GoogleChannel[]> {
    return this.call<Array<{ youtube_channel_id: string; channel_handle: string | null; channel_title: string | null }>>(
      `review_subscriptions?select=youtube_channel_id,channel_handle,channel_title&user_id=eq.${encodeURIComponent(userId)}&order=channel_title.asc.nullslast`,
    ).then((rows) => rows.map((row) => ({
      channelId: row.youtube_channel_id,
      ...(row.channel_handle ? { handle: row.channel_handle } : {}),
      ...(row.channel_title ? { title: row.channel_title } : {}),
    })));
  }

  async subscriptionStatus(userId: string): Promise<{ lastSuccessfulRefresh: string | null; count: number; googleConnected: boolean }> {
    const [syncs, auth] = await Promise.all([
      this.call<Array<{ completed_at: string }>>(`review_subscription_syncs?select=completed_at&user_id=eq.${encodeURIComponent(userId)}&status=eq.completed&order=completed_at.desc&limit=1`),
      this.getGoogleAuthorization(userId),
    ]);
    // PostgREST does not expose the count as a row for an empty selection; use a tiny RPC for a stable result.
    const count = await this.rpc<number>("count_review_subscriptions", { p_user_id: userId });
    return {
      lastSuccessfulRefresh: syncs[0]?.completed_at || null,
      count,
      googleConnected: Boolean(auth && !auth.access_revoked_at && auth.encrypted_refresh_token),
    };
  }

  forgetUser(userId: string): Promise<void> {
    return this.rpc("forget_review_user", { p_user_id: userId });
  }
}
