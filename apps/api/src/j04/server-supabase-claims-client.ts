import { createClient } from "@supabase/supabase-js";
import { PricingIdentityError } from "./pricing-admin-identity-gate";
import { SupabaseSdkClaimsVerifier } from "./supabase-claims-verifier";
import type { SupabaseFreshUserReader } from "./live-session-readonly";

/**
 * Server-only composition. Never register this directly as a public controller.
 * No service-role or secret key; JWTs are supplied per request and not stored.
 */
export type ServerClaimsConfig = Readonly<{
  url: string;
  publishableKey: string;
  /** Synthetic, test-only fetch injection. Omit for real network use. */
  fetch?: typeof fetch;
}>;

export type J04ServerSupabaseAuth = Readonly<{
  verifier: SupabaseSdkClaimsVerifier;
  userReader: SupabaseFreshUserReader;
}>;

export function createServerSupabaseAuth(config: ServerClaimsConfig): J04ServerSupabaseAuth {
  if (!config || typeof config.url !== "string" ||
    !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(config.url) ||
    typeof config.publishableKey !== "string" ||
    !/^sb_publishable_[a-zA-Z0-9_-]{8,256}$/.test(config.publishableKey)) {
    throw new PricingIdentityError("access_unavailable");
  }

  const client = createClient(config.url.replace(/\/$/, ""), config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: config.fetch ? {fetch: config.fetch} : {},
  });
  return {
    verifier: new SupabaseSdkClaimsVerifier(client.auth),
    userReader: client.auth,
  };
}

export function createServerSupabaseClaimsVerifier(
  config: ServerClaimsConfig,
): SupabaseSdkClaimsVerifier {
  return createServerSupabaseAuth(config).verifier;
}
