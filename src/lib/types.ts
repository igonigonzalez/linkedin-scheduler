export type PostStatus = "scheduled" | "publishing" | "published" | "failed";

export interface Media {
  id: string;
  post_id: string;
  type: "image" | "video" | "document";
  path: string;
  url: string;
  title: string | null;
  sort_order: number;
}

export interface Post {
  id: string;
  account_id: string;
  body: string;
  first_comment: string | null;
  scheduled_at: string;
  status: PostStatus;
  post_urn: string | null;
  comment_urn: string | null;
  error: string | null;
  created_at: string;
  published_at: string | null;
  media: Media[];
}

export interface Account {
  id: string;
  name: string | null;
  picture: string | null;
  expires_at: string | null;
}
