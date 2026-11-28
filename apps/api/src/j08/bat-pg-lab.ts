import {createHash,randomBytes,randomInt} from "node:crypto";
import type {QuoteLabConnection} from "../j06/quote-pg-lab";

/** Server-only LAB adapter. Session capability is supplied by the trusted J07
 * session resolver, never taken from request JSON. No public routes, real SMS
 * or manufacturing. A fresh dedicated connection is required per invocation. */
type Role="j08_issuer"|"j08_client"|"j08_otp_sender";
type Failure={status:"unavailable"};
type Review={scope:"LAB";manufacturable:false;version:number;digest:string;bytesBase64:string};
type Status={scope:"LAB";manufacturable:false;version:number;status:"review"|"waiting"|"approved"|"refused"|"expired"|"replaced"|"locked"};
type Outcome<T>={status:"ok";value:T}|Failure;
type Connection=Awaited<ReturnType<QuoteLabConnection>>;
type Context={caseId:string;version:number;linkToken:string};
type Binding={caseId:string;version:number;digest:string};
type OtpDelivery=Readonly<{caseId:string;version:number;challengeId:string;code:string}>;
type Ports=Readonly<{issuer:QuoteLabConnection;client:QuoteLabConnection;sender:QuoteLabConnection;fakeDelivery:(message:OtpDelivery)=>Promise<void>}>;
const fail=():Failure=>({status:"unavailable"});
const hash=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
const hex=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const version=(v:unknown):v is number=>typeof v==="number"&&Number.isSafeInteger(v)&&v>0;
function exact(v:unknown,keys:readonly string[]):v is Record<string,unknown>{
 if(!v||typeof v!=="object"||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))return false;
 const own=Reflect.ownKeys(v);
 return own.length===keys.length&&keys.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(v,k)??{},"value"));
}
function context(v:Record<string,unknown>):v is Context & Record<string,unknown>{return uuid(v.caseId)&&version(v.version)&&hex(v.linkToken);}
function binding(v:Record<string,unknown>):v is Binding & Record<string,unknown>{return uuid(v.caseId)&&version(v.version)&&hex(v.digest);}
const baseKeys=["caseId","version","linkToken"];
async function transact<T>(connect:QuoteLabConnection,role:Role,fn:(c:Connection)=>Promise<T|null>):Promise<Outcome<T>>{
 let c:Connection|undefined,started=false;
 try{
  c=await connect();
  const r=await c.query("select session_user::text as login,current_user::text as role,current_database() as db");
  if(r.rows.length!==1||r.rows[0].login!==role||r.rows[0].role!==role||r.rows[0].db!=="panokit_j03_industrial_lab")return fail();
  await c.query("begin isolation level serializable");started=true;
  const value=await fn(c);
  if(value===null){await c.query("rollback");started=false;return fail();}
  // No automatic retry. A lost COMMIT acknowledgement is an unknown outcome:
  // do not return success or send capabilities, and never replay blindly.
  await c.query("commit");started=false;
  return {status:"ok",value};
 }catch{return fail();}
 finally{if(c){if(started)await c.query("rollback").catch(()=>{});await c.close().catch(()=>{});}}
}
async function scalar(c:Connection,sql:string,args:unknown[]):Promise<unknown>{
 const r=await c.query(sql,args);if(r.rows.length!==1||!Object.hasOwn(r.rows[0],"value"))throw Error("LAB_RESULT");return r.rows[0].value;
}
function statusProjection(v:unknown,n:number):Status|null{
 if(!exact(v,["scope","manufacturable","version","status"])||v.scope!=="LAB"||v.manufacturable!==false||v.version!==n||typeof v.status!=="string"||!["review","waiting","approved","refused","expired","replaced","locked"].includes(v.status))return null;
 return v as Status;
}
function reviewProjection(v:unknown,n:number):Review|null{
 if(!exact(v,["scope","manufacturable","version","digest","bytesBase64"])||v.scope!=="LAB"||v.manufacturable!==false||v.version!==n||!hex(v.digest)||typeof v.bytesBase64!=="string"||v.bytesBase64.length>3_000_000)return null;
 const text=v.bytesBase64.replace(/\n/g,"");
 if(!/^[A-Za-z0-9+/]+={0,2}$/.test(text))return null;
 const bytes=Buffer.from(text,"base64");
 if(bytes.length<1||bytes.length>2_000_000||bytes.toString("base64")!==text||createHash("sha256").update(bytes).digest("hex")!==v.digest)return null;
 return {scope:"LAB",manufacturable:false,version:n,digest:v.digest,bytesBase64:text};
}
function args(c:Context,session:string):unknown[]{return [c.caseId,c.version,hash(session),hash(c.linkToken)];}
export function createBatLabAdapter(ports:Ports){
 return {
  // Must be called by the trusted issuer service, never a client endpoint.
  async rotate(input:unknown,session:unknown):Promise<Outcome<{linkToken:string}>>{
   if(!hex(session)||!exact(input,["caseId","version","digest"])||!binding(input))return fail();
   const token=randomBytes(32).toString("hex");
   return transact(ports.issuer,"j08_issuer",async c=>await scalar(c,"select j08_private.rotate_link($1,$2,$3,$4,$5) as value",[input.caseId,input.version,input.digest,hash(session),hash(token)])===true?{linkToken:token}:null);
  },
  async status(input:unknown,session:unknown):Promise<Outcome<Status>>{
   if(!hex(session)||!exact(input,baseKeys)||!context(input))return fail();
   return transact(ports.client,"j08_client",async c=>statusProjection(await scalar(c,"select j08_private.read_status($1,$2,$3,$4) as value",args(input,session)),input.version));
  },
  // Base64 is inert data. The future renderer must vet content and prevent active SVG.
  async review(input:unknown,session:unknown):Promise<Outcome<Review>>{
   if(!hex(session)||!exact(input,baseKeys)||!context(input))return fail();
   return transact(ports.client,"j08_client",async c=>reviewProjection(await scalar(c,"select j08_private.read_bat($1,$2,$3,$4) as value",args(input,session)),input.version));
  },
  async sendOtp(input:unknown,session:unknown):Promise<Outcome<{challengeId:string}>>{
   if(!hex(session)||!exact(input,[...baseKeys,"digest"])||!context(input)||!hex(input.digest))return fail();
   const code=String(randomInt(0,1_000_000)).padStart(6,"0");
   const r=await transact(ports.sender,"j08_otp_sender",async c=>{
    const id=await scalar(c,"select j08_private.issue_otp($1,$2,$3,$4,$5,$6) as value",[...args(input,session),input.digest,code]);return uuid(id)?id:null;
   });
   if(r.status!=="ok")return fail();
   // This callback is a server-local fake delivery only, not an HTTP response.
   try{await ports.fakeDelivery(Object.freeze({caseId:input.caseId,version:input.version,challengeId:r.value,code}));}
   catch{return fail();}
   return {status:"ok",value:{challengeId:r.value}};
  },
  async confirm(input:unknown,session:unknown):Promise<Outcome<"approved"|"wrong"|"locked">>{
   if(!hex(session)||!exact(input,[...baseKeys,"digest","challengeId","code","statement","locale"])||!context(input)||!hex(input.digest)||!uuid(input.challengeId)||typeof input.code!=="string"||input.code.length>64||input.statement!=="lab-bat-v1"||(input.locale!=="fr"&&input.locale!=="ar"))return fail();
   // Wrong/locked are committed results: rollback would lose the attempt.
   return transact(ports.client,"j08_client",async c=>{
    const r=await scalar(c,"select j08_private.confirm_otp($1,$2,$3,$4,$5,$6,$7,$8,$9) as value",[...args(input,session),input.digest,input.challengeId,input.code,input.statement,input.locale]);
    return r==="approved"||r==="wrong"||r==="locked"?r:null;
   });
  },
  async refuse(input:unknown,session:unknown):Promise<Outcome<true>>{
   if(!hex(session)||!exact(input,[...baseKeys,"digest","explicit","locale"])||!context(input)||!hex(input.digest)||input.explicit!==true||(input.locale!=="fr"&&input.locale!=="ar"))return fail();
   return transact(ports.client,"j08_client",async c=>await scalar(c,"select j08_private.refuse_bat($1,$2,$3,$4,$5,$6,$7) as value",[...args(input,session),input.digest,true,input.locale])===true?true:null);
  }
 };
}
