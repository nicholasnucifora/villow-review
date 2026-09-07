export interface Env {
  ENVIRONMENT?: "development" | "staging" | "production";
  REVIEW_ORIGIN: string;
  REVIEW_SUPABASE_URL: string;
  REVIEW_SUPABASE_SERVICE_ROLE_KEY: string;
  REVIEW_GOOGLE_CLIENT_ID: string;
  REVIEW_GOOGLE_CLIENT_SECRET: string;
  REVIEW_TOKEN_ENCRYPTION_KEY: string;
  REVIEW_SESSION_SIGNING_KEY: string;
  ALLOWED_EXTENSION_ORIGINS: string;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

export interface QueuePayload {
  videoId: string;
  title: string;
  channel: string;
  channelUrl: string;
  duration: string;
  isLive: boolean;
  viewCountText: string;
  publishedText: string;
  metadataText: string;
  thumbnail: string;
  sourceUrl: string;
  source: string;
  client: "Chrome" | "Firefox" | "Edge" | "Opera" | "Brave" | "Browser";
}

export interface ExtensionDayPayload {
  date: string;
  timezone: string;
  source: string;
  client: QueuePayload["client"];
  contributed: {
    recommendationsSeen: number;
    activeSeconds: number;
    externalSaves: number;
  };
  config: {
    recommendationLimitPerDay: number | null;
    saveLimitPerDay: number | null;
    timeLimitSecondsPerDay: number | null;
    youTubeBlocked: boolean;
  };
}

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  displayName: string | null;
  googleAuthorizedAt: string | null;
  accessRevokedAt: string | null;
}

export interface SessionAuth {
  user: AuthenticatedUser;
  sessionId: string;
  csrfHash: string;
}

export interface ExtensionAuth {
  userId: string;
  tokenId: string;
}

export interface GoogleChannel {
  channelId: string;
  handle?: string;
  title?: string;
}
