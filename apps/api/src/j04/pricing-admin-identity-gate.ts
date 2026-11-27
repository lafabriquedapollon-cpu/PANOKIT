/**
 * PANOKIT J04 — candidate admin identity boundary, completely isolated.
 * No NestJS controller, module registration, network request, Supabase SDK,
 * SQL connection, or client-exposed key is installed by this file.
 *
 * The injected tokenVerifier MUST verify a Supabase Auth JWT signature,
 * its signing-key trust chain (JWKS), and issuer BEFORE returning claims.
 * The injected accessReader MUST query a trusted server-side data source for
 * current session status and permissions; no cached JWT role or user_metadata.
 *
 * Until both implementations are independently reviewed and integration-tested,
 * this is only an authorization protocol / fail-closed design, NOT working Auth.
 */

export type PricingPermission = "pricing:view" | "pricing:edit";
export type VerifiedSupabaseClaims = {
  iss: string;
  aud: string;
  sub: string;
  role: string;
  session_id: string;
  exp: number;
  iat: number;
  nbf?: number;
  is_anonymous: boolean;
  aal: string;
  // Additional JWT metadata, including user_metadata and app_metadata,
  // is intentionally ignored for pricing authorizations.
  [key: string]: unknown;
};
export type CurrentPricingAccess = {
  userId: string;
  sessionId: string;
  sessionActive: boolean;
  userActive: boolean;
  /** Current AAL from auth.sessions, not only a possibly stale JWT claim. */
  sessionAal: string;
  permissions: readonly string[];
};
/** Security-critical adapter; not allowed to simply JSON.parse a JWT. */
export interface SupabaseTokenVerifier {
  verifyAccessToken(jwt: string): Promise<VerifiedSupabaseClaims | null>;
}
/**
 * Server-only permission source, to be linked to an authenticated database
 * principal / permission tables and auth.sessions after separate J04 checks.
 */
export interface CurrentAccessReader {
  readAccess(userId: string, sessionId: string): Promise<CurrentPricingAccess | null>;
}
export type PricingAdminEditor = {
  actorId: string;
  permissions: readonly PricingPermission[];
};

export class PricingIdentityError extends Error {
  constructor(public readonly code:
    "missing_credentials" | "invalid_token" | "permission_denied" |
    "mfa_required" | "access_unavailable",
  ) {
    super(code);
    this.name = "PricingIdentityError";
  }
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const JWT = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
const CLOCK_SKEW = 30;

/**
 * Intended server-only caller:
 * 1. reject missing/malformed header,
 * 2. use trusted verifier for JWT signature, issuer and audience,
 * 3. independently check claims and expiration,
 * 4. query current session + DB-granted permission for EVERY decision,
 * 5. enforce AAL2 for price edits,
 * 6. return only the specific authorized scope.
 */
export class PricingAdminIdentityGate {
  constructor(
    private readonly expectedIssuer: string,
    private readonly verifier: SupabaseTokenVerifier,
    private readonly accessReader: CurrentAccessReader,
    private readonly nowSeconds: () => number = () => Math.floor(Date.now() / 1000),
  ) {
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/auth\/v1$/.test(expectedIssuer)) {
      throw new PricingIdentityError("access_unavailable");
    }
  }

  async requireEditor(
    authorization: string | string[] | undefined,
    permission: PricingPermission,
  ): Promise<PricingAdminEditor> {
    if (permission !== "pricing:view" && permission !== "pricing:edit") {
      throw new PricingIdentityError("permission_denied");
    }
    if (typeof authorization !== "string" || authorization.length > 8192) {
      throw new PricingIdentityError("missing_credentials");
    }
    const match = JWT.exec(authorization);
    if (!match) throw new PricingIdentityError("invalid_token");

    // A production implementation must validate the JWT cryptographically,
    // never trust decoded unverified content from a browser.
    let claims: VerifiedSupabaseClaims | null;
    try {
      claims = await this.verifier.verifyAccessToken(match[1]);
    } catch {
      throw new PricingIdentityError("invalid_token");
    }
    const now = this.nowSeconds();
    if (!claims || claims.iss !== this.expectedIssuer ||
      claims.aud !== "authenticated" || claims.role !== "authenticated" ||
      claims.is_anonymous !== false ||
      typeof claims.sub !== "string" || !UUID.test(claims.sub) ||
      typeof claims.session_id !== "string" || !UUID.test(claims.session_id) ||
      !Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.iat) ||
      claims.exp <= now || claims.iat > now + CLOCK_SKEW ||
      claims.iat >= claims.exp ||
      (claims.nbf !== undefined &&
        (!Number.isSafeInteger(claims.nbf) || claims.nbf > now + CLOCK_SKEW))) {
      throw new PricingIdentityError("invalid_token");
    }
    // Session revocation / role changes must be checked against current server
    // state; JWT app_metadata, user_metadata and auth.role are insufficient.
    let current: CurrentPricingAccess | null;
    try {
      current = await this.accessReader.readAccess(claims.sub, claims.session_id);
    } catch {
      throw new PricingIdentityError("access_unavailable");
    }
    if (!current || current.userId !== claims.sub ||
      current.sessionId !== claims.session_id ||
      current.userActive !== true || current.sessionActive !== true ||
      !Array.isArray(current.permissions) || !current.permissions.includes(permission)) {
      throw new PricingIdentityError("permission_denied");
    }
    if (permission === "pricing:edit" && (claims.aal !== "aal2" || current.sessionAal !== "aal2")) {
      throw new PricingIdentityError("mfa_required");
    }
    // Minimal output is structurally compatible with J06 InternalEditor; it
    // does not contain broad account roles or raw JWT claims.
    return { actorId: claims.sub, permissions: [permission] };
  }
}
