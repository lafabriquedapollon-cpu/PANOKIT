import type {
  SupabaseTokenVerifier, VerifiedSupabaseClaims,
} from "./pricing-admin-identity-gate";

/**
 * Adapter for the OFFICIAL Supabase Auth SDK's auth.getClaims(token) method.
 * The SDK verifies the JWT signature using trusted JWKS (or verifies remotely
 * for legacy symmetric keys). Do NOT pass a decoded, unverified JWT here.
 *
 * Injection rather than createClient() keeps the project URL, publishable key,
 * network and secrets out of this isolated draft PR. Production composition
 * must supply a correctly configured server-only Supabase client.
 */
export interface VerifiedClaimsSdk {
  getClaims(jwt: string): Promise<{
    data: { claims: unknown } | null;
    error: unknown;
  }>;
}
export class SupabaseSdkClaimsVerifier implements SupabaseTokenVerifier {
  constructor(private readonly client: VerifiedClaimsSdk) {}

  async verifyAccessToken(jwt: string): Promise<VerifiedSupabaseClaims | null> {
    if (typeof jwt !== "string" || jwt.length < 16 || jwt.length > 8192 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(jwt)) {
      return null;
    }
    try {
      const {data, error} = await this.client.getClaims(jwt);
      if (error || !data || !data.claims ||
        typeof data.claims !== "object" || Array.isArray(data.claims)) {
        return null;
      }
      const c = data.claims as Record<string, unknown>;
      if (typeof c.iss !== "string" || typeof c.aud !== "string" ||
        typeof c.role !== "string" || typeof c.sub !== "string" ||
        typeof c.session_id !== "string" || typeof c.aal !== "string" ||
        typeof c.is_anonymous !== "boolean" ||
        typeof c.exp !== "number" || typeof c.iat !== "number" ||
        (c.nbf !== undefined && typeof c.nbf !== "number")) {
        return null;
      }
      // A separate gate pins issuer, audience, exp and session.
      // This object is trusted only because SDK.getClaims validated its JWT.
      return c as VerifiedSupabaseClaims;
    } catch {
      // Fail closed, never leak SDK endpoint URLs, internal headers or secrets.
      return null;
    }
  }
}
