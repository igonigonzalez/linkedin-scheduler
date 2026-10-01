import { headers } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionAccountId } from "@/lib/session";
import { signPosts } from "@/lib/mediaAccess";
import type { Account, Post } from "@/lib/types";
import Dashboard from "./dashboard";

export const dynamic = "force-dynamic";

export default async function Page() {
  const accountId = await getSessionAccountId();
  const sb = supabaseAdmin();
  const host = (await headers()).get("host") ?? "";
  const localPreview = host.startsWith("localhost") || host.startsWith("127.0.0.1");

  let account: Account | null = null;
  let posts: Post[] = [];

  if (accountId) {
    const [acctRes, postsRes] = await Promise.all([
      sb.from("linkedin_accounts").select("id,name,picture,expires_at").eq("id", accountId).maybeSingle(),
      sb.from("posts").select("*, media(*)").eq("account_id", accountId).order("scheduled_at", { ascending: false }),
    ]);
    account = (acctRes.data as Account) ?? null;
    posts = await signPosts(sb, (postsRes.data as Post[]) ?? []);
  }

  return <Dashboard account={account} initialPosts={posts} localPreview={localPreview} />;
}
