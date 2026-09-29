import { supabaseAdmin } from "@/lib/supabase";

const SIGNED_URL_SECONDS = 60 * 60 * 2;

type Sb = ReturnType<typeof supabaseAdmin>;
type WithPath = { path: string; url: string };

// Short-lived read URLs. The bucket is private, so the stored public URL must not be shown.
export async function signMediaList<T extends WithPath>(sb: Sb, media: T[]): Promise<T[]> {
  if (!media.length) return media;
  const signed = new Map<string, string>();
  for (let i = 0; i < media.length; i += 50) {
    const slice = media.slice(i, i + 50);
    const { data, error } = await sb.storage.from("media").createSignedUrls(
      slice.map((item) => item.path),
      SIGNED_URL_SECONDS
    );
    if (error || !data) continue;
    for (const item of data) {
      if (item.path && item.signedUrl && !item.error) signed.set(item.path, item.signedUrl);
    }
  }
  return media.map((item) => (signed.has(item.path) ? { ...item, url: signed.get(item.path)! } : item));
}

export async function signPosts<T extends { media?: WithPath[] | null }>(sb: Sb, posts: T[]): Promise<T[]> {
  const flat = posts.flatMap((post) => post.media ?? []);
  const signed = await signMediaList(sb, flat);
  let cursor = 0;
  return posts.map((post) => {
    const count = post.media?.length ?? 0;
    const media = signed.slice(cursor, cursor + count);
    cursor += count;
    return { ...post, media };
  });
}
