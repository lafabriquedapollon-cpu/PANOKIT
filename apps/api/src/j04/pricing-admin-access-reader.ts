import type {
  CurrentAccessReader, CurrentPricingAccess,
} from "./pricing-admin-identity-gate";

/**
 * Read-only PostgreSQL port (future PG17 server-only driver).
 * The query assumes a separately reviewed private ACL table; no table is
 * created and no SQL is executed when this module is imported.
 *
 * Never grant this port's privileged role to a browser or use a service_role
 * client in a frontend. The role must be constrained to SELECT on the
 * identified auth users/sessions and private permission table.
 */
export interface PgReadPort {
  query(
    sql: string, params: readonly [string, string],
  ): Promise<{ rows: Record<string, unknown>[] }>;
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export const J04_CURRENT_ACCESS_SQL = [
  "SELECT u.id::text AS user_id, s.id::text AS session_id,",
  "  (u.deleted_at IS NULL AND",
  "    (u.banned_until IS NULL OR u.banned_until <= NOW())) AS user_active,",
  "  (s.not_after IS NULL OR s.not_after > NOW()) AS session_active,",
  "  s.aal::text AS session_aal,",
  "  (acl.user_id IS NOT NULL AND acl.revoked_at IS NULL",
  "    AND acl.can_view IS TRUE) AS can_view,",
  "  (acl.user_id IS NOT NULL AND acl.revoked_at IS NULL",
  "    AND acl.can_edit IS TRUE) AS can_edit",
  "FROM auth.users u",
  "JOIN auth.sessions s ON s.user_id = u.id",
  "LEFT JOIN panokit_private.pricing_admin_acl acl ON acl.user_id = u.id",
  "WHERE u.id = $1::uuid AND s.id = $2::uuid",
  "LIMIT 2",
].join("\n");

export class PostgresPricingAccessReader implements CurrentAccessReader {
  constructor(private readonly port: PgReadPort) {}
  async readAccess(userId: string, sessionId: string): Promise<CurrentPricingAccess | null> {
    if (!UUID.test(userId) || !UUID.test(sessionId)) return null;
    // A query failure is deliberately raised so the calling identity gate
    // maps it to access_unavailable rather than permitting stale privileges.
    const result = await this.port.query(J04_CURRENT_ACCESS_SQL, [userId, sessionId]);
    if (!result || !Array.isArray(result.rows)) throw Error("access-unavailable");
    if (result.rows.length === 0) return null;
    if (result.rows.length !== 1) throw Error("ambiguous-access");
    const row = result.rows[0];
    if (row.user_id !== userId || row.session_id !== sessionId ||
      typeof row.user_active !== "boolean" ||
      typeof row.session_active !== "boolean" ||
      typeof row.can_view !== "boolean" ||
      typeof row.can_edit !== "boolean" ||
      !["aal1","aal2"].includes(String(row.session_aal))) {
      throw Error("invalid-access-row");
    }
    const permissions: string[] = [];
    if (row.can_view === true) permissions.push("pricing:view");
    if (row.can_edit === true) permissions.push("pricing:edit");
    return {
      userId, sessionId,
      userActive: row.user_active,
      sessionActive: row.session_active,
      sessionAal: String(row.session_aal),
      permissions,
    };
  }
}
