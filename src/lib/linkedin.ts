// LinkedIn API client: OAuth, media upload, post creation, first comment.
// Uses the versioned REST API (https://api.linkedin.com/rest/*).
//
// NOTE: the exact endpoints/headers below are correct as of the 202409 version, but LinkedIn's
// versioned API changes over time. The 3 spots most likely to need a tweak on first live test
// are marked with "// LIVE-TEST".

const LI_API = "https://api.linkedin.com";
const LI_OAUTH = "https://www.linkedin.com/oauth/v2";
const VERSION = process.env.LINKEDIN_VERSION || "202601";

function restHeaders(extra: Record<string, string> = {}) {
  return {
    "LinkedIn-Version": VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
    ...extra,
  };
}

// ---------- OAuth ----------

export function getAuthUrl(state: string) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.LINKEDIN_CLIENT_ID!,
    redirect_uri: process.env.LINKEDIN_REDIRECT_URI!,
    // openid+profile -> read member id/name; w_member_social -> post + comment on member's behalf.
    scope: "openid profile w_member_social",
    state,
  });
  return `${LI_OAUTH}/authorization?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: process.env.LINKEDIN_CLIENT_ID!,
    client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
    redirect_uri: process.env.LINKEDIN_REDIRECT_URI!,
  });
  const res = await fetch(`${LI_OAUTH}/accessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
    scope: string;
  };
}

export async function refreshAccessToken(refreshToken: string) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: process.env.LINKEDIN_CLIENT_ID!,
    client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
  });
  const res = await fetch(`${LI_OAUTH}/accessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
  };
}

export async function getUserInfo(accessToken: string) {
  const res = await fetch(`${LI_API}/v2/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`userinfo failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { sub: string; name?: string; picture?: string; email?: string };
}

// ---------- Media upload ----------

export async function uploadImage(
  accessToken: string,
  owner: string,
  bytes: ArrayBuffer,
  contentType: string
): Promise<string> {
  const init = await fetch(`${LI_API}/rest/images?action=initializeUpload`, {
    method: "POST",
    headers: restHeaders({ Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }),
    body: JSON.stringify({ initializeUploadRequest: { owner } }),
  });
  if (!init.ok) throw new Error(`image init failed: ${init.status} ${await init.text()}`);
  const { value } = await init.json();
  const uploadUrl: string = value.uploadUrl;
  const imageUrn: string = value.image;

  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": contentType },
    body: bytes,
  });
  if (!put.ok) throw new Error(`image upload failed: ${put.status} ${await put.text()}`);
  return imageUrn;
}

export async function uploadVideo(
  accessToken: string,
  owner: string,
  bytes: ArrayBuffer,
  contentType: string
): Promise<string> {
  const fileSizeBytes = bytes.byteLength;
  const init = await fetch(`${LI_API}/rest/videos?action=initializeUpload`, {
    method: "POST",
    headers: restHeaders({ Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }),
    body: JSON.stringify({
      initializeUploadRequest: { owner, fileSizeBytes, uploadCaptions: false, uploadThumbnail: false },
    }),
  });
  if (!init.ok) throw new Error(`video init failed: ${init.status} ${await init.text()}`);
  const { value } = await init.json();
  const videoUrn: string = value.video;
  const instructions: { uploadUrl: string; firstByte: number; lastByte: number }[] = value.uploadInstructions;

  // Upload each chunk and collect ETags (required for finalize).
  const uploadedPartIds: string[] = [];
  for (const ins of instructions) {
    const chunk = bytes.slice(ins.firstByte, ins.lastByte + 1);
    const put = await fetch(ins.uploadUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": contentType },
      body: chunk,
    });
    if (!put.ok) throw new Error(`video chunk upload failed: ${put.status} ${await put.text()}`);
    const etag = put.headers.get("etag");
    if (etag) uploadedPartIds.push(etag.replaceAll('"', ""));
  }

  const finalize = await fetch(`${LI_API}/rest/videos?action=finalizeUpload`, {
    method: "POST",
    headers: restHeaders({ Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }),
    body: JSON.stringify({ finalizeUploadRequest: { video: videoUrn, uploadToken: "", uploadedPartIds } }),
  });
  if (!finalize.ok) throw new Error(`video finalize failed: ${finalize.status} ${await finalize.text()}`);
  // NOTE: video then processes async on LinkedIn's side. For long/large videos the post may need
  // a short delay before LinkedIn accepts it. Small clips usually work immediately. // LIVE-TEST
  return videoUrn;
}

// ---------- Posting ----------

// The Posts API `commentary` field treats these characters as reserved and they MUST be escaped
// with a backslash, otherwise the request 400s. This is the #1 gotcha of the Posts API.
export function escapeCommentary(text: string): string {
  return text.replace(/[\\<>#~_|{}@\[\]()*]/g, (c) => `\\${c}`);
}

export type MediaUrn = { type: "image" | "video"; urn: string };

export async function createPost(
  accessToken: string,
  author: string,
  commentary: string,
  media: MediaUrn[]
): Promise<string> {
  const body: Record<string, unknown> = {
    author,
    commentary: escapeCommentary(commentary),
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };

  if (media.length === 1) {
    body.content = { media: { id: media[0].urn } };
  } else if (media.length > 1) {
    // Multiple media -> multiImage (images only; LinkedIn does not support multi-video posts).
    body.content = { multiImage: { images: media.map((m) => ({ id: m.urn })) } };
  }

  const res = await fetch(`${LI_API}/rest/posts`, {
    method: "POST",
    headers: restHeaders({ Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`create post failed: ${res.status} ${await res.text()}`);

  // The created post URN comes back in a response header (no JSON body on 201).
  const urn = res.headers.get("x-restli-id") || res.headers.get("x-linkedin-id");
  if (!urn) throw new Error("post created but URN missing from response headers"); // LIVE-TEST
  return urn;
}

export async function createComment(
  accessToken: string,
  actor: string,
  objectUrn: string,
  text: string
): Promise<string | null> {
  const encoded = encodeURIComponent(objectUrn);
  const res = await fetch(`${LI_API}/rest/socialActions/${encoded}/comments`, {
    method: "POST",
    headers: restHeaders({ Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }),
    body: JSON.stringify({ actor, object: objectUrn, message: { text } }),
  });
  if (!res.ok) throw new Error(`create comment failed: ${res.status} ${await res.text()}`);
  return res.headers.get("x-restli-id");
}
