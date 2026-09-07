#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";

const args = process.argv.slice(2);
const command = args.shift();
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const requiredOption = (name) => {
  const value = option(name);
  if (!value) throw new Error(`Missing --${name}`);
  return value;
};
const assertUuid = (value, name) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error(`${name} must be a UUID`);
  return value;
};
const token = () => randomBytes(48).toString("base64url");
const hash = (value) => createHash("sha256").update(value).digest("base64url");
const origin = (process.env.REVIEW_ORIGIN || "https://review.villow.app").replace(/\/$/, "");

function credentials() {
  const url = process.env.REVIEW_SUPABASE_URL;
  const key = process.env.REVIEW_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set REVIEW_SUPABASE_URL and REVIEW_SUPABASE_SERVICE_ROLE_KEY in the operator shell");
  return { url: url.replace(/\/$/, ""), key };
}

function supabaseHeaders(key, extra = {}) {
  return {
    apikey: key,
    "Content-Type": "application/json",
    ...(key.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }),
    ...extra,
  };
}

async function request(path, init = {}) {
  const { url, key } = credentials();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: supabaseHeaders(key, init.headers || {}),
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(body?.message || `Supabase returned ${response.status}`);
  return body;
}

async function createInvite() {
  const label = requiredOption("label").trim();
  const days = Number(option("expires-days") || "14");
  if (!label || label.length > 120 || !Number.isInteger(days) || days < 1 || days > 90) throw new Error("Use a label up to 120 characters and --expires-days from 1 to 90");
  const raw = token();
  const rows = await request("review_invites?select=id,label,created_at,expires_at", {
    method:"POST", headers:{ Prefer:"return=representation" },
    body:JSON.stringify({ token_hash:hash(raw), label, expires_at:new Date(Date.now() + days * 86_400_000).toISOString(), allowed_uses:1 }),
  });
  console.log(JSON.stringify({ invitation:rows[0], invitationUrl:`${origin}/#villow_invite=${raw}` }, null, 2));
}

async function revokeInvite() {
  const id = assertUuid(requiredOption("id"), "--id");
  await request(`review_invites?id=eq.${encodeURIComponent(id)}`, { method:"PATCH", headers:{ Prefer:"return=minimal" }, body:JSON.stringify({ revoked_at:new Date().toISOString() }) });
  console.log(`Revoked invitation ${id}.`);
}

async function unbindInvite() {
  const inviteId = assertUuid(requiredOption("id"), "--id");
  const userId = assertUuid(requiredOption("confirm-user-id"), "--confirm-user-id");
  await request("rpc/admin_unbind_review_invite", { method:"POST", body:JSON.stringify({ p_invite_id:inviteId, p_expected_user_id:userId }) });
  console.log(`Unbound invitation ${inviteId}; sessions and extension links for ${userId} were revoked.`);
}

async function createExtensionToken() {
  const userId = assertUuid(requiredOption("user-id"), "--user-id");
  const label = (option("label") || "Operator-issued review link").trim().slice(0, 80);
  const days = Number(option("expires-days") || "30");
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error("--expires-days must be from 1 to 90");
  const raw = token();
  const rows = await request("review_extension_tokens?select=id,label,created_at,expires_at", {
    method:"POST", headers:{ Prefer:"return=representation" },
    body:JSON.stringify({ user_id:userId, token_hash:hash(raw), label, expires_at:new Date(Date.now() + days * 86_400_000).toISOString() }),
  });
  console.log(JSON.stringify({ token:rows[0], connectLink:`${origin}/connect#villow_token=${raw}` }, null, 2));
}

async function revokeExtensionToken() {
  const id = assertUuid(requiredOption("id"), "--id");
  await request(`review_extension_tokens?id=eq.${encodeURIComponent(id)}`, { method:"PATCH", headers:{ Prefer:"return=minimal" }, body:JSON.stringify({ revoked_at:new Date().toISOString() }) });
  console.log(`Revoked extension link ${id}.`);
}

async function revokeSessions() {
  const userId = assertUuid(requiredOption("user-id"), "--user-id");
  await request(`review_sessions?user_id=eq.${encodeURIComponent(userId)}&revoked_at=is.null`, { method:"PATCH", headers:{ Prefer:"return=minimal" }, body:JSON.stringify({ revoked_at:new Date().toISOString() }) });
  console.log(`Revoked active website sessions for ${userId}.`);
}

async function clearQueue() {
  const userId = assertUuid(requiredOption("user-id"), "--user-id");
  await request(`review_queue_videos?user_id=eq.${encodeURIComponent(userId)}`, { method:"DELETE", headers:{ Prefer:"return=minimal" } });
  console.log(`Cleared the review queue for ${userId}.`);
}

async function deleteUser() {
  const userId = assertUuid(requiredOption("user-id"), "--user-id");
  if (option("confirm-user-id") !== userId) throw new Error("Repeat the user id with --confirm-user-id to delete review data");
  await request("rpc/forget_review_user", { method:"POST", body:JSON.stringify({ p_user_id:userId }) });
  console.log(`Deleted review data for ${userId}; the claimed invitation was revoked.`);
}

async function status() {
  const userId = assertUuid(requiredOption("user-id"), "--user-id");
  const [users, invites, tokens, sessions, syncs, queue] = await Promise.all([
    request(`review_users?select=id,email,google_authorized_at,last_login_at,access_revoked_at&id=eq.${encodeURIComponent(userId)}`),
    request(`review_invites?select=id,label,expires_at,revoked_at,claimed_at&claimed_by_user_id=eq.${encodeURIComponent(userId)}`),
    request(`review_extension_tokens?select=id,label,created_at,expires_at,revoked_at,last_used_at&user_id=eq.${encodeURIComponent(userId)}`),
    request(`review_sessions?select=id,created_at,expires_at,revoked_at&user_id=eq.${encodeURIComponent(userId)}`),
    request(`review_subscription_syncs?select=started_at,completed_at,status,item_count,safe_error_category&user_id=eq.${encodeURIComponent(userId)}&order=started_at.desc&limit=5`),
    request(`review_queue_videos?select=id&user_id=eq.${encodeURIComponent(userId)}`),
  ]);
  console.log(JSON.stringify({ user:users[0] || null, invitations:invites, extensionTokens:tokens, sessions, subscriptionSyncs:syncs, queueItemCount:queue.length }, null, 2));
}

function generateKeys() {
  console.log(`REVIEW_TOKEN_ENCRYPTION_KEY=${randomBytes(32).toString("base64url")}`);
  console.log(`REVIEW_SESSION_SIGNING_KEY=${randomBytes(48).toString("base64url")}`);
}

const commands = {
  "invite:create":createInvite,
  "invite:revoke":revokeInvite,
  "invite:unbind":unbindInvite,
  "token:create":createExtensionToken,
  "token:revoke":revokeExtensionToken,
  "session:revoke":revokeSessions,
  "queue:clear":clearQueue,
  "user:delete":deleteUser,
  "user:status":status,
  "keys:generate":generateKeys,
};

if (!command || !commands[command]) {
  console.error("Usage: npm run admin -- <invite:create|invite:revoke|invite:unbind|token:create|token:revoke|session:revoke|queue:clear|user:delete|user:status|keys:generate> [options]");
  process.exitCode = 1;
} else {
  Promise.resolve()
    .then(() => commands[command]())
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
