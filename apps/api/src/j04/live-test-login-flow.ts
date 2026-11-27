import type {SupabaseTokenVerifier} from "./pricing-admin-identity-gate";
import type {SupabaseFreshUserReader} from "./live-session-readonly";
import {verifyReadOnlyAuthServiceRecognition} from "./live-session-readonly";

/**
 * J04 test-only login driver. Authentication is NOT pricing authorization.
 * Refresh failure does not replace a fresh database session_id lookup.
 */
export interface J04TestPasswordAuthPort {
  signInWithPassword(credentials: {email: string; password: string}): Promise<{
    data: {session: {access_token: string; refresh_token: string} | null} | null;
    error: unknown;
  }>;
  signOut(options: {scope: "local"}): Promise<{error: unknown}>;
  refreshSession(session: {refresh_token: string}): Promise<{
    data: {session: unknown | null} | null;
    error: unknown;
  }>;
}
export type J04TestLoginResult = Readonly<{
  login: "pass" | "fail";
  identity: "recognized_not_authorized" | "rejected" | "not_run";
  localSignout: "acknowledged" | "failed" | "not_run";
  refreshAttempt: "no_session_returned" | "session_returned" | "not_run";
  pricingAuthorized: false;
}>;
export async function runJ04TestLoginLogout(
  credentials: {email: string; password: string},
  expectedIssuer: string,
  port: J04TestPasswordAuthPort,
  verifier: SupabaseTokenVerifier,
  userReader: SupabaseFreshUserReader,
): Promise<J04TestLoginResult> {
  let login: J04TestLoginResult["login"] = "fail";
  let identity: J04TestLoginResult["identity"] = "not_run";
  let localSignout: J04TestLoginResult["localSignout"] = "not_run";
  let refreshAttempt: J04TestLoginResult["refreshAttempt"] = "not_run";
  const result = (): J04TestLoginResult => ({
    login, identity, localSignout, refreshAttempt, pricingAuthorized: false,
  });
  // Fail closed before network access; no credentials in errors.
  if (typeof credentials.email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(credentials.email) ||
    typeof credentials.password !== "string" ||
    credentials.password.length < 8 ||
    expectedIssuer !== "https://panokit-recovery-fixture.supabase.co/auth/v1") {
    return result();
  }
  let accessToken: string | undefined;
  let refreshToken: string | undefined;
  try {
    const signedIn = await port.signInWithPassword(credentials);
    if (signedIn.error || !signedIn.data?.session ||
      typeof signedIn.data.session.access_token !== "string" ||
      typeof signedIn.data.session.refresh_token !== "string" ||
      !signedIn.data.session.access_token || !signedIn.data.session.refresh_token) {
      return result();
    }
    login = "pass";
    accessToken = signedIn.data.session.access_token;
    refreshToken = signedIn.data.session.refresh_token;
    const recognized = await verifyReadOnlyAuthServiceRecognition(
      accessToken, expectedIssuer, verifier, userReader,
    );
    identity = recognized === "auth_service_recognized_not_authorized"
      ? "recognized_not_authorized" : "rejected";
  } catch {
    // Always try to revoke whenever a complete session was observed locally.
  } finally {
    if (refreshToken && accessToken) {
      try {
        const signedOut = await port.signOut({scope: "local"});
        localSignout = signedOut.error ? "failed" : "acknowledged";
      } catch {
        localSignout = "failed";
      }
    }
  }
  if (identity !== "recognized_not_authorized" ||
    localSignout !== "acknowledged" || !refreshToken) {
    return result();
  }
  try {
    const refreshed = await port.refreshSession({refresh_token: refreshToken});
    if (refreshed.data?.session) {
      refreshAttempt = "session_returned";
      // Best-effort cleanup of a session issued by unexpected refresh.
      try { await port.signOut({scope: "local"}); } catch { /* fail closed */ }
    } else {
      // Could also be a transient network failure: not revocation proof.
      refreshAttempt = "no_session_returned";
    }
  } catch {
    refreshAttempt = "no_session_returned";
  }
  return result();
}
