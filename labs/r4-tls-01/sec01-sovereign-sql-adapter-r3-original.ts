/** Recovery R3: narrow role-specific SQL ports, no database connection. */
import type { LabDeps } from "./sec01-sovereign-http-gate";
export type SqlPort = {query(sql: string, args: unknown[]): Promise<{rows: Record<string, unknown>[]}>};
export function createSec01LabDeps(
  settings: Pick<LabDeps,"origin"|"tokenKey"|"verifyIssue">,
  ports: {issuer: SqlPort; writer: SqlPort; logout: SqlPort}
): LabDeps {
  if (ports.issuer === ports.writer || ports.issuer === ports.logout || ports.writer === ports.logout)
    throw new Error("separate role adapters required (actual SQL role verification pending)");
  return {
    ...settings,
    async issue(subject,proof,id,digest,expires) {
      const r = await ports.issuer.query(
        "SELECT sec01_admin.issue_privileged_session($1::text,$2::bytea,$3::uuid,$4::bytea,$5::timestamptz) AS actor_id",
        [subject,Buffer.from(proof),id,Buffer.from(digest),expires]);
      if (r.rows.length !== 1 || typeof r.rows[0].actor_id !== "string") throw new Error("issue not acknowledged");
    },
    async write(id,digest,operation,revision,config) {
      const r = await ports.writer.query(
        "SELECT * FROM sec01_admin.write_pricing($1::uuid,$2::bytea,$3::uuid,$4::integer,$5::jsonb)",
        [id,Buffer.from(digest),operation,revision,JSON.stringify(config)]);
      const v=r.rows[0];
      if (r.rows.length !== 1 || typeof v.revision !== "number" ||
          !Number.isInteger(v.revision) || v.revision !== revision+1 ||
          typeof v.replayed !== "boolean") throw new Error("write not acknowledged");
      return {revision:v.revision,replayed:v.replayed};
    },
    async logout(id,digest) {
      const r=await ports.logout.query(
        "SELECT sec01_admin.revoke_own_session($1::uuid,$2::bytea) AS revoked",
        [id,Buffer.from(digest)]);
      if(r.rows.length!==1 || r.rows[0].revoked!==true) throw new Error("logout not acknowledged");
    }
  };
}
