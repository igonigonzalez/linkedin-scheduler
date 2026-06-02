import { NextRequest } from "next/server";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "li_session";
const SECURE = process.env.NODE_ENV === "production";

// Server-component helper (uses Next cookies()).
export async function getSessionAccountId(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

// Route-handler helper (uses req.cookies).
export function getSessionAccountIdFromReq(req: NextRequest): string | null {
  return req.cookies.get(SESSION_COOKIE)?.value ?? null;
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
