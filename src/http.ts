import type { Env } from "./types";

export const MAX_REQUEST_BYTES = 16_384;

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

export function html(markup: string, status = 200): Response {
  return new Response(markup, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export function redirect(path: string, status = 303): Response {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Unsafe redirect");
  return new Response(null, { status, headers: { Location: path } });
}

export function extensionOrigins(env: Env): Set<string> {
  return new Set(
    (env.ALLOWED_EXTENSION_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => /^chrome-extension:\/\/[a-p]{32}$/.test(origin) || /^moz-extension:\/\/[0-9a-f-]{36}$/i.test(origin)),
  );
}

export function isAllowedExtensionOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  // Chrome may omit Origin for privileged extension fetches once the extension
  // has host permission. Those requests still pass through bearer authentication.
  return !origin || extensionOrigins(env).has(origin);
}

export function isAllowedPreflightOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  return Boolean(origin && extensionOrigins(env).has(origin));
}

export function requireSameOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  return origin === new URL(env.REVIEW_ORIGIN).origin;
}

export function isExpectedHost(request: Request, env: Env): boolean {
  const requestUrl = new URL(request.url);
  const expected = new URL(env.REVIEW_ORIGIN);
  if (requestUrl.origin === expected.origin) return true;
  return env.ENVIRONMENT !== "production" && ["localhost", "127.0.0.1"].includes(requestUrl.hostname);
}

export function finalize(request: Request, response: Response, env: Env): Response {
  const headers = new Headers(response.headers);
  const origin = request.headers.get("Origin");
  if (origin && extensionOrigins(env).has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Expose-Headers", "Retry-After");
  }
  const vary = headers.get("Vary");
  headers.set("Vary", vary ? `${vary}, Origin` : "Origin");
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Security-Policy", "default-src 'self'; connect-src 'self'; img-src 'self' https://i.ytimg.com https://i1.ytimg.com https://i2.ytimg.com https://i3.ytimg.com https://i4.ytimg.com https://i5.ytimg.com https://i6.ytimg.com https://i7.ytimg.com https://i8.ytimg.com https://i9.ytimg.com; script-src 'self'; style-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  if (new URL(env.REVIEW_ORIGIN).protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function preflight(request: Request, env: Env): Response {
  if (!isAllowedPreflightOrigin(request, env)) return json({ message: "Origin not allowed." }, 403);
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Max-Age": "600",
    },
  });
}

export async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new HttpError(415, "Content-Type must be application/json.");
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_REQUEST_BYTES) throw new HttpError(413, "Request is too large.");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) throw new HttpError(413, "Request is too large.");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}
