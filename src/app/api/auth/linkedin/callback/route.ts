import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken, getUserInfo } from "@/lib/linkedin";
import { supabaseAdmin } from "@/lib/supabase";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

// OAuth callback: validates state, exchanges code, stores the account + tokens.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("li_oauth_state")?.value;

  if (!code || !state || state !== cookieState) {
    return NextResponse.redirect(new URL("/?error=oauth_state", req.url));
  }

  try {
    const token = await exchangeCodeForToken(code);
    const info = await getUserInfo(token.access_token);
    const memberUrn = `urn:li:person:${info.sub}`;

    const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();
    const refreshExpiresAt = token.refresh_token_expires_in
      ? new Date(Date.now() + token.refresh_token_expires_in * 1000).toISOString()
      : null;

    const sb = supabaseAdmin();
    const { data: acct, error } = await sb.from("linkedin_accounts").upsert(
      {
        member_urn: memberUrn,
        name: info.name ?? null,
        picture: info.picture ?? null,
        access_token: token.access_token,
        refresh_token: token.refresh_token ?? null,
        expires_at: expiresAt,
        refresh_expires_at: refreshExpiresAt,
      },
      { onConflict: "member_urn" }
    ).select("id").single();
    if (error) throw new Error(error.message);

    const res = NextResponse.redirect(new URL("/?connected=1", req.url));
    res.cookies.set(SESSION_COOKIE, acct.id, sessionCookieOptions());
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(msg)}`, req.url));
  }
}
