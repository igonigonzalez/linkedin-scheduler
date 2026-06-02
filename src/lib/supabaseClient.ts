"use client";

import { createClient } from "@supabase/supabase-js";

// Browser client (anon key, public). Used only to upload media via signed upload URLs.
export const supabaseBrowser = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
