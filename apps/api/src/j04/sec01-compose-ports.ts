import { createHash } from "node:crypto";
export type ComposeSql = {
  query(sql: string, args?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};
type Roles = { verifier: ComposeSql; sweeper: ComposeSql; issuer: ComposeSql; writer: ComposeSql; logout: ComposeSql };
const denied = (): never => { throw new Error("SEC01_COMPOSE_DENIED"); };
const one = (r: { rows: Record<string, unknown>[] }): Record<string, unknown> =>
  r.rows.length === 1 ? r.rows[0] : denied();
/** Candidate for disposable composition only. No live route or database provisioning. */
export async function createComposePorts(roles: Roles, replayKey: Uint8Array) {
  if (replayKey.byteLength !== 32 || new Set(Object.values(roles)).size !== 5) denied();
  const keyId = createHash("sha256").update(replayKey).digest();
  const expected = { verifier: "mfa_verifier", sweeper: "sweeper", issuer: "issuer", writer: "writer", logout: "logout" } as const;
  for (const name of Object.keys(expected) as (keyof Roles)[]) {
    const row = one(await roles[name].query("select session_user as su, current_user as cu, current_database() as db"));
    const role = "sec01_admin_" + expected[name];
    if (row.su !== role || row.cu !== role || row.db !== "panokit_sec01_sovereign_lab") denied();
  }
  return Object.freeze({
    async begin(subject: string, digest: Uint8Array, expires: Date) {
      const row = one(await roles.verifier.query("select sec01_admin.begin_mfa_proof($1,$2,$3) as ok", [subject, Buffer.from(digest), expires]));
      if (row.ok !== true) denied();
    },
    async reserve(subject: string, digest: Uint8Array, tag: Uint8Array) {
      const row = one(await roles.verifier.query("select sec01_admin.reserve_versioned_totp($1,$2,$3,$4) as ok", [subject, Buffer.from(digest), Buffer.from(tag), keyId]));
      if (typeof row.ok !== "boolean") denied();
      return row.ok === true;
    },
    async mark(subject: string, digest: Uint8Array, providerId: string) {
      const row = one(await roles.verifier.query("select sec01_admin.mark_reserved_totp($1,$2,$3) as ok", [subject, Buffer.from(digest), providerId]));
      if (row.ok !== true) denied();
    },
    async sweep(runId: string, limit: number) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) denied();
      const row = one(await roles.sweeper.query("select * from sec01_admin.sweep_expiry_batch($1,$2)", [runId, limit]));
      if (typeof row.complete !== "boolean" || !["expired", "purged_attempts", "purged_proofs"].every(k => Number.isInteger(row[k]) && Number(row[k]) >= 0)) denied();
      return row;
    },
    async issue(subject: string, digest: Uint8Array, id: string, tokenDigest: Uint8Array, expires: Date) {
      const row = one(await roles.issuer.query("select sec01_admin.issue_bound_session($1,$2,$3,$4,$5) as actor_id", [subject, Buffer.from(digest), id, Buffer.from(tokenDigest), expires]));
      if (typeof row.actor_id !== "string") denied();
      return row.actor_id;
    },
    async write(id: string, digest: Uint8Array, operation: string, revision: number, config: Record<string, unknown>) {
      const row = one(await roles.writer.query("select * from sec01_admin.write_bound_pricing($1,$2,$3,$4,$5)", [id, Buffer.from(digest), operation, revision, JSON.stringify(config)]));
      if (row.revision !== revision + 1 || typeof row.replayed !== "boolean") denied();
      return { revision: row.revision, replayed: row.replayed };
    },
    async logout(id: string, digest: Uint8Array) {
      const row = one(await roles.logout.query("select sec01_admin.revoke_own_session($1,$2) as ok", [id, Buffer.from(digest)]));
      if (row.ok !== true) denied();
    }
  });
}
