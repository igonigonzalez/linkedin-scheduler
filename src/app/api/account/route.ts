import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionAccountIdFromReq, SESSION_COOKIE } from "@/lib/session";
import { revokeToken } from "@/lib/linkedin";

export const dynamic = "force-dynamic";

// Deletes this LinkedIn connection, its scheduled posts and its files.
// Posts already live on LinkedIn are not removed there.
export async function DELETE(req: NextRequest) {
  const accountId = getSessionAccountIdFromReq(req);
  if (!accountId) {
    return NextResponse.json({ error: "Sesión no encontrada." }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const { data: account, error: accountErr } = await sb
    .from("linkedin_accounts")
    .select("id, access_token, refresh_token")
    .eq("id", accountId)
    .maybeSingle();
  if (accountErr) return NextResponse.json({ error: accountErr.message }, { status: 500 });
  if (!account) return NextResponse.json({ error: "Cuenta no encontrada." }, { status: 404 });

  const { data: posts, error: postsErr } = await sb
    .from("posts")
    .select("id, media(path)")
    .eq("account_id", accountId);
  if (postsErr) return NextResponse.json({ error: postsErr.message }, { status: 500 });

  const paths = (posts ?? []).flatMap((post) => (post.media ?? []).map((item: { path: string }) => item.path));
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await sb.storage.from("media").remove(paths.slice(i, i + 100));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  for (const token of [account.access_token, account.refresh_token]) {
    if (!token) continue;
    try {
      await revokeToken(token);
    } catch (e) {
      console.error("LinkedIn token revoke failed", e);
    }
  }

  const { error: deleteErr } = await sb.from("linkedin_accounts").delete().eq("id", accountId);
  if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 });

  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
