import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { catalogueFetch } from "@/lib/catalog-fetch";

let client: SupabaseClient | undefined;

/** Public-view reads only; credentials are validated when first used. */
export function getSupabaseServerClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !anonKey) {
    throw new Error(
      "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to load the product catalogue.",
    );
  }

  client = createClient(url, anonKey, {
    db: { retry: false },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: catalogueFetch,
    },
  });

  return client;
}
