import {createHash,randomBytes,randomUUID} from "node:crypto";
import {calculateLabQuote,type QuoteResult,type QuoteLabPort} from "./quote-lab";
import {validateGuestContact,type GuestField} from "../j07/guest-contact";
import type {QuoteLabConnection} from "./quote-pg-lab";
type Quote=Extract<QuoteResult,{status:"lab_quote"}>["quote"];
type LeaseFailure=Extract<QuoteResult,{status:"unavailable"}>|{status:"unavailable";reason:"lease_unavailable"};
export type LeaseResult=LeaseFailure|{status:"lab_lease";scope:"LAB";orderable:false;leaseToken:string;expiresAt:string;quote:Quote}|{status:"lab_valid";scope:"LAB";orderable:false;expiresAt:string;quote:Quote};
export type GuestAdmissionResult=LeaseFailure|{status:"unavailable";reason:"contact_invalid";fields:readonly GuestField[]}|{status:"unavailable";reason:"admission_unavailable"}|{status:"lab_guest_admitted";scope:"LAB";orderable:false;receiptId:string};
type Client=Awaited<ReturnType<QuoteLabConnection>>;
const fail=(reason:"calculation_unavailable"|"lease_unavailable"):LeaseFailure=>({status:"unavailable",reason});
const hash=(token:string)=>createHash("sha256").update(token,"utf8").digest("hex");
function port(c:Client):QuoteLabPort{return {readSnapshot:async s=>{
 const r=await c.query("select j06_private.read_snapshot($1,$2) as snapshot",[s.formatId,s.fulfillment.mode==="delivery"?s.fulfillment.destinationRef:null]);
 if(r.rows.length!==1)throw Error("SNAPSHOT");return r.rows[0].snapshot;
}};}
async function transaction<T extends LeaseResult|GuestAdmissionResult>(connect:QuoteLabConnection,fn:(c:Client)=>Promise<T>):Promise<T|LeaseFailure>{
 let c:Client|undefined,started=false;
 try{
  c=await connect();const r=await c.query("select session_user::text as login,current_user::text as role,current_database() as db");
  if(r.rows.length!==1||r.rows[0].login!=="j06_runtime"||r.rows[0].role!=="j06_runtime"||r.rows[0].db!=="panokit_j03_industrial_lab")return fail("calculation_unavailable");
  await c.query("begin isolation level serializable");started=true;
  const result=await fn(c);
  await c.query(result.status==="unavailable"?"rollback":"commit");started=false;return result;
 }catch{return fail("calculation_unavailable");}
 finally{if(c){if(started)await c.query("rollback").catch(()=>{});await c.close().catch(()=>{});}}
}
function iso(v:unknown):string{const d=v instanceof Date?v:typeof v==="string"?new Date(v):null;if(!d||!Number.isFinite(d.getTime()))throw Error("EXPIRY");return d.toISOString();}
export async function issueLabLease(input:unknown,connect:QuoteLabConnection):Promise<LeaseResult>{
 return issueLease(input,connect);
}
/** Session capability is supplied by a trusted server adapter, never taken from contact JSON. */
export async function issueGuestLabLease(input:unknown,sessionToken:unknown,connect:QuoteLabConnection):Promise<LeaseResult>{
 if(!capability(sessionToken))return {status:"unavailable",reason:"invalid_request"};
 return issueLease(input,connect,hash(sessionToken));
}
function capability(v:unknown):v is string{return typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);}
async function issueLease(input:unknown,connect:QuoteLabConnection,sessionHash?:string):Promise<LeaseResult>{
 return transaction<LeaseResult>(connect,async c=>{
  const result=await calculateLabQuote(input,port(c));if(result.status!=="lab_quote")return result;
  const saved=await c.query("select j06_private.persist_quote($1::jsonb) as saved",[JSON.stringify(result.quote)]);
  if(saved.rows.length!==1||saved.rows[0].saved!==true)throw Error("PERSIST");
  const token=randomBytes(32).toString("hex");
  const lease=sessionHash===undefined?await c.query("select j06_private.issue_lease($1,$2) as expires",[hash(token),result.quote.fingerprint]):await c.query("select j06_private.issue_guest_lease($1,$2,$3) as expires",[hash(token),result.quote.fingerprint,sessionHash]);
  if(lease.rows.length!==1)throw Error("LEASE");
  return {status:"lab_lease",scope:"LAB",orderable:false,leaseToken:token,expiresAt:iso(lease.rows[0].expires),quote:result.quote};
 });
}
function record(v:unknown):v is Record<string,unknown>{return !!v&&typeof v==="object"&&!Array.isArray(v);}
export async function revalidateLabLease(input:unknown,connect:QuoteLabConnection):Promise<LeaseResult>{
 if(!record(input)||Object.keys(input).length!==1||!Object.hasOwn(input,"leaseToken")||typeof input.leaseToken!=="string"||!/^[a-f0-9]{64}$/.test(input.leaseToken))return {status:"unavailable",reason:"invalid_request"};
 const tokenHash=hash(input.leaseToken);
 return transaction<LeaseResult>(connect,c=>readValidLease(c,tokenHash));
}
async function readValidLease(c:Client,tokenHash:string,sessionHash?:string):Promise<LeaseFailure|Extract<LeaseResult,{status:"lab_valid"}>>{
  const read=async()=>{const r=sessionHash===undefined?await c.query("select j06_private.read_lease($1) as lease",[tokenHash]):await c.query("select j06_private.read_guest_lease($1,$2) as lease",[tokenHash,sessionHash]);if(r.rows.length!==1)throw Error("READ_LEASE");return r.rows[0].lease;};
  const lease=await read();
  if(!record(lease)||!record(lease.quote))return fail("lease_unavailable");
  const q=lease.quote;
  if(q.scope!=="LAB"||q.orderable!==false||typeof q.fingerprint!=="string")return fail("lease_unavailable");
  const fresh=await calculateLabQuote({modelId:q.modelId,formatId:q.formatId,industrialRevision:q.industrialRevision,expectedTariffRevision:q.tariffRevision,options:q.options,fulfillment:q.fulfillment},port(c));
  if(fresh.status!=="lab_quote")return fresh;
  if(fresh.quote.fingerprint!==q.fingerprint)return fail("lease_unavailable");
  const final=await read();if(!record(final)||!record(final.quote)||final.quote.fingerprint!==q.fingerprint||iso(final.expiresAt)!==iso(lease.expiresAt))return fail("lease_unavailable");
  return {status:"lab_valid",scope:"LAB",orderable:false,expiresAt:iso(lease.expiresAt),quote:fresh.quote};

}
/** Trusted server-side LAB adapter only. Does not prove identity, visual consent or order acceptance.
 * Contact data is validated in memory and never persisted or returned. One receipt per lease;
 * a duplicate is rejected (not an idempotent replay of the original response). */
export async function admitLabGuest(input:unknown,sessionToken:unknown,connect:QuoteLabConnection):Promise<GuestAdmissionResult>{
 if(!capability(sessionToken)||!record(input)||Reflect.ownKeys(input).length!==2||!["leaseToken","contact"].every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(input,k)??{},"value"))||
    typeof input.leaseToken!=="string"||!/^[a-f0-9]{64}$/.test(input.leaseToken))return {status:"unavailable",reason:"invalid_request"};
 if(input.leaseToken===sessionToken)return fail("lease_unavailable");
 const tokenHash=hash(input.leaseToken),sessionHash=hash(sessionToken);
 return transaction<GuestAdmissionResult>(connect,async c=>{
  const lease=await readValidLease(c,tokenHash,sessionHash);
  if(lease.status==="unavailable")return lease;
  const contact=validateGuestContact(input.contact,lease.quote.fulfillment.mode);
  if(contact.status!=="valid")return {status:"unavailable",reason:"contact_invalid",fields:contact.fields};
  const receiptId=randomUUID();
  const saved=await c.query("select j06_private.record_guest_admission($1,$2,$3,$4::uuid) as saved",[tokenHash,sessionHash,lease.quote.fingerprint,receiptId]);
  if(saved.rows.length!==1)throw Error("ADMISSION");
  if(saved.rows[0].saved!==true)return {status:"unavailable",reason:"admission_unavailable"};
  return {status:"lab_guest_admitted",scope:"LAB",orderable:false,receiptId};
 });
}
