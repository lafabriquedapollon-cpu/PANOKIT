import type {SupabaseTokenVerifier} from "./pricing-admin-identity-gate";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export interface SupabaseFreshUserReader {
  getUser(jwt: string): Promise<{
    data: {user: {id: string} | null} | null;
    error: unknown;
  }>;
}

/**
 * Safe preparatory gate, not an administrator authorization decision.
 * Verifies signed claims and that Supabase Auth recognizes the same user.
 *
 * SECURITY: getUser(jwt) does NOT guarantee that the JWT's session_id still
 * exists in auth.sessions, and neither method verifies PANOKIT pricing ACL.
 * The caller must NOT grant access based on this result.
 */
export async function verifyReadOnlyAuthServiceRecognition(
  token: string,
  expectedIssuer: string,
  verifier: SupabaseTokenVerifier,
  userReader: SupabaseFreshUserReader,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<"auth_service_recognized_not_authorized" | "rejected"> {
  if (!token || typeof token !== "string" || token.length > 8192 ||
    !/^https:\/\/[a-z0-9-]+\.supabase\.co\/auth\/v1$/.test(expectedIssuer)) {
    return "rejected";
  }
  try {
    const claims = await verifier.verifyAccessToken(token);
    if (!claims || claims.iss !== expectedIssuer ||
      claims.aud !== "authenticated" || claims.role !== "authenticated" ||
      claims.is_anonymous !== false || !UUID.test(claims.sub) ||
      !UUID.test(claims.session_id) ||
      !["aal1", "aal2"].includes(claims.aal) ||
      !Number.isSafeInteger(claims.exp) ||
      !Number.isSafeInteger(claims.iat) ||
      claims.exp <= nowSeconds || claims.iat > nowSeconds + 30 ||
      claims.iat >= claims.exp ||
      (claims.nbf !== undefined &&
        (!Number.isSafeInteger(claims.nbf) || claims.nbf > nowSeconds + 30))) {
      return "rejected";
    }
    // Explicit supplied token; never uses an implicit browser/local session.
    const {data, error} = await userReader.getUser(token);
    if (error || !data || !data.user || data.user.id !== claims.sub) {
      return "rejected";
    }
    return "auth_service_recognized_not_authorized";
  } catch {
    // No logs or diagnostics may contain a JWT or customer information.
    return "rejected";
  }
}
