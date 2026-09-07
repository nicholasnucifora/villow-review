import { HttpError } from "./http";
import type { ExtensionDayPayload, QueuePayload } from "./types";

const queueKeys = new Set([
  "videoId", "title", "channel", "channelUrl", "duration", "isLive", "viewCountText",
  "publishedText", "metadataText", "thumbnail", "sourceUrl", "source", "client",
]);
const clients = new Set(["Chrome", "Firefox", "Edge", "Opera", "Brave", "Browser"]);
const controlCharacters = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Expected a JSON object.");
  return value as Record<string, unknown>;
}

function textField(value: unknown, name: string, max: number): string {
  if (typeof value !== "string") throw new HttpError(400, `${name} must be a string.`);
  if (value.length > max) throw new HttpError(400, `${name} is too long.`);
  if (controlCharacters.test(value)) throw new HttpError(400, `${name} contains control characters.`);
  return value;
}

function safeUrl(value: string, allowedHosts: RegExp): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !allowedHosts.test(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

export function validateQueuePayload(value: unknown): QueuePayload {
  const input = record(value);
  for (const key of Object.keys(input)) if (!queueKeys.has(key)) throw new HttpError(400, `Unexpected field: ${key}.`);
  for (const key of queueKeys) if (!(key in input)) throw new HttpError(400, `Missing field: ${key}.`);

  const videoId = textField(input.videoId, "videoId", 11);
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new HttpError(400, "videoId is invalid.");
  const title = textField(input.title, "title", 300);
  const channel = textField(input.channel, "channel", 200);
  const channelUrl = textField(input.channelUrl, "channelUrl", 500);
  const duration = textField(input.duration, "duration", 16);
  const viewCountText = textField(input.viewCountText, "viewCountText", 100);
  const publishedText = textField(input.publishedText, "publishedText", 100);
  const metadataText = textField(input.metadataText, "metadataText", 500);
  const thumbnail = textField(input.thumbnail, "thumbnail", 700);
  const sourceUrl = textField(input.sourceUrl, "sourceUrl", 700);
  const source = textField(input.source, "source", 36);
  const client = textField(input.client, "client", 16);

  if (typeof input.isLive !== "boolean") throw new HttpError(400, "isLive must be a boolean.");
  if (duration && !/^\d{1,3}:\d{2}(?::\d{2})?$/.test(duration)) throw new HttpError(400, "duration is invalid.");
  if (channelUrl && !safeUrl(channelUrl, /^(?:www\.)?youtube\.com$/i)) throw new HttpError(400, "channelUrl is invalid.");
  const thumb = safeUrl(thumbnail, /^i\d?\.ytimg\.com$/i);
  if (thumbnail && (!thumb || !thumb.pathname.includes(`/${videoId}/`))) throw new HttpError(400, "thumbnail is invalid.");
  const sourcePage = safeUrl(sourceUrl, /^(?:www\.|m\.)?youtube\.com$/i);
  if (!sourcePage || sourcePage.pathname !== "/watch" || sourcePage.searchParams.get("v") !== videoId) throw new HttpError(400, "sourceUrl is invalid.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(source)) throw new HttpError(400, "source is invalid.");
  if (!clients.has(client)) throw new HttpError(400, "client is invalid.");

  return {
    videoId, title, channel, channelUrl, duration, isLive: input.isLive, viewCountText,
    publishedText, metadataText, thumbnail, sourceUrl, source, client: client as QueuePayload["client"],
  };
}

function boundedInteger(value: unknown, name: string, max: number, nullable = false): number | null {
  if (nullable && value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > max) throw new HttpError(400, `${name} is invalid.`);
  return value as number;
}

export function validateExtensionDay(value: unknown): ExtensionDayPayload {
  const input = record(value);
  const expected = ["date", "timezone", "source", "client", "contributed", "config"];
  if (Object.keys(input).some((key) => !expected.includes(key)) || expected.some((key) => !(key in input))) throw new HttpError(400, "extension-day fields are invalid.");
  const date = textField(input.date, "date", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new HttpError(400, "date is invalid.");
  const timezone = textField(input.timezone, "timezone", 64);
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); } catch { throw new HttpError(400, "timezone is invalid."); }
  const source = textField(input.source, "source", 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(source)) throw new HttpError(400, "source is invalid.");
  const client = textField(input.client, "client", 16);
  if (!clients.has(client)) throw new HttpError(400, "client is invalid.");
  const contributed = record(input.contributed);
  const config = record(input.config);
  const contributionKeys = ["recommendationsSeen", "activeSeconds", "externalSaves"];
  const configKeys = ["recommendationLimitPerDay", "saveLimitPerDay", "timeLimitSecondsPerDay", "youTubeBlocked"];
  if (Object.keys(contributed).some((key) => !contributionKeys.includes(key)) || contributionKeys.some((key) => !(key in contributed))) throw new HttpError(400, "contributed fields are invalid.");
  if (Object.keys(config).some((key) => !configKeys.includes(key)) || configKeys.some((key) => !(key in config))) throw new HttpError(400, "config fields are invalid.");
  if (typeof config.youTubeBlocked !== "boolean") throw new HttpError(400, "youTubeBlocked is invalid.");
  return {
    date, timezone, source, client: client as QueuePayload["client"],
    contributed: {
      recommendationsSeen: boundedInteger(contributed.recommendationsSeen, "recommendationsSeen", 10_000_000)!,
      activeSeconds: boundedInteger(contributed.activeSeconds, "activeSeconds", 86_400)!,
      externalSaves: boundedInteger(contributed.externalSaves, "externalSaves", 100_000)!,
    },
    config: {
      recommendationLimitPerDay: boundedInteger(config.recommendationLimitPerDay, "recommendationLimitPerDay", 1_000_000, true),
      saveLimitPerDay: boundedInteger(config.saveLimitPerDay, "saveLimitPerDay", 1_000_000, true),
      timeLimitSecondsPerDay: boundedInteger(config.timeLimitSecondsPerDay, "timeLimitSecondsPerDay", 86_400, true),
      youTubeBlocked: config.youTubeBlocked,
    },
  };
}

export function validateVideoId(value: string): string {
  if (!/^[A-Za-z0-9_-]{11}$/.test(value)) throw new HttpError(400, "videoId is invalid.");
  return value;
}
