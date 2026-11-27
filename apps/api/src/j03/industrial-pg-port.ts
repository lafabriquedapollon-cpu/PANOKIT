import { type IndustrialReadPort } from "./industrial-admission";

type QueryResult = {rows: Array<Record<string, unknown>>};
export type IndustrialSqlClient = {query(sql: string, args: string[]): Promise<QueryResult>};
/** LAB-only trusted reader connection. Not a route or public DB credential. */
export function createIndustrialPgReadPort(client: IndustrialSqlClient, formatId: string): IndustrialReadPort {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(formatId)) throw Error("INVALID_FORMAT_ID");
  return {
    async readSnapshot() {
      const result = await client.query("select session_user::text as login, current_user::text as role, current_database() as db, j03_private.read_snapshot($1) as snapshot", [formatId]);
      if (result.rows.length !== 1) throw Error("J03_READ_DENIED");
      const row = result.rows[0];
      if (row.login !== "j03_reader" || row.role !== "j03_reader" || row.db !== "panokit_j03_industrial_lab") throw Error("J03_READ_DENIED");
      if (row.snapshot === null) return null;
      if (!row.snapshot || typeof row.snapshot !== "object" || Array.isArray(row.snapshot)) throw Error("J03_READ_DENIED");
      const value = row.snapshot as Record<string,unknown>;
      if (!Object.hasOwn(value,"revision") || !Object.hasOwn(value,"approval")) throw Error("J03_READ_DENIED");
      return {revision:value.revision,approval:value.approval};
    },
  };
}
