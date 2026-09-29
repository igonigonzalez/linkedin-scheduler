import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "li_session";
const SECURE = process.env.NODE_ENV === "production";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sessionSecret() {
  const secret = process.env.SESSION_SECRET || process.env.CRON_SECRET;
  if (!secret) throw new Error("Missing SESSION_SECRET or CRON_SECRET");
  return secret;
}

function sign(accountId: string) {
  return createHmac("sha256", sessionSecret()).update(accountId).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function signSession(accountId: string) {
  return `${accountId}.${sign(accountId)}`;
}

export function verifySession(value: string | undefined | null): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const accountId = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  if (!UUID_RE.test(accountId) || !safeEqual(signature, sign(accountId))) return null;
  return accountId;
}

// Server-component helper (uses Next cookies()).
export async function getSessionAccountId(): Promise<string | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}

// Route-handler helper (uses req.cookies).
export function getSessionAccountIdFromReq(req: NextRequest): string | null {
  return verifySession(req.cookies.get(SESSION_COOKIE)?.value);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: SECURE,
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 60, // 60 days (matches LinkedIn token lifetime)
    path: "/",
  };
}
