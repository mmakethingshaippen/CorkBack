import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client. Holds only the public anon key; all access is
 * guarded by Row Level Security (see supabase/schema.sql). Never put the
 * service-role key here.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
