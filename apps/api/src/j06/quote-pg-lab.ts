import {calculateLabQuote,type QuoteResult,type QuoteLabPort} from "./quote-lab";
type SqlClient={query(sql:string,args?:unknown[]):Promise<{rows:Record<string,unknown>[]}>;close():Promise<void>};
export type QuoteLabConnection=()=>Promise<SqlClient>;
const failure=():QuoteResult=>Object.freeze({status:"unavailable",reason:"calculation_unavailable"});
/** Dedicated fresh LAB connection per transaction. Never connect to a LIVE database. */
export async function persistLabQuote(input:unknown,connect:QuoteLabConnection):Promise<QuoteResult>{
 let c:SqlClient|undefined,started=false;
 try{
  c=await connect();const client=c;
  const check=await client.query("select session_user::text as login,current_user::text as role,current_database() as db");
  if(check.rows.length!==1||check.rows[0].login!=="j06_runtime"||check.rows[0].role!=="j06_runtime"||check.rows[0].db!=="panokit_j03_industrial_lab")return failure();
  await client.query("begin isolation level serializable");started=true;
  const p:QuoteLabPort={readSnapshot:async s=>{
    const q=await client.query("select j06_private.read_snapshot($1,$2) as snapshot",[s.formatId,s.fulfillment.mode==="delivery"?s.fulfillment.destinationRef:null]);
    if(q.rows.length!==1)throw Error("SNAPSHOT_UNAVAILABLE");
    return q.rows[0].snapshot;
  }};
  const result=await calculateLabQuote(input,p);
  if(result.status!=="lab_quote"){await client.query("rollback");started=false;return result;}
  const saved=await client.query("select j06_private.persist_quote($1::jsonb) as saved",[JSON.stringify(result.quote)]);
  if(saved.rows.length!==1||saved.rows[0].saved!==true)throw Error("QUOTE_NOT_STORED");
  await client.query("commit");started=false;return result;
 }catch{return failure();}
 finally{if(c){if(started)await c.query("rollback").catch(()=>{});await c.close().catch(()=>{});}}
}
