import {createHash,createHmac,randomInt,randomBytes,timingSafeEqual} from "node:crypto";

/** Pure J08 LAB policy. Inputs from trusted adapters only; not an HTTP API, database,
 * identity proof or authorization to manufacture. The caller MUST lock and persist
 * the aggregate atomically, with trusted clock and roles. Never accept caller-supplied
 * commercial/technical evidence directly from browser JSON. */
export const LINK_TTL_MS=7*24*60*60*1000;
export const OTP_TTL_MS=5*60*1000;
export const OTP_MAX_ATTEMPTS=5;
type Technical="review"|"feasible"|"correction"|"infeasible";
type Status="pending"|"approved"|"refused"|"expired"|"replaced";
type Locale="fr"|"ar";
type Role="client"|"assigned_workshop"|"authorized_issuer"|"commercial";
export type Binding=Readonly<{caseId:string;version:number;digest:string}>;
export type Bat=Readonly<Binding & {status:Status;issuedAt:number;approval?:Readonly<{at:number;locale:Locale;statement:"lab-bat-v1";sessionHash:string;challengeId:string}>}>;
export type Case=Readonly<{caseId:string;receiptId:string;initialDigest:string;technical:Technical;technicalBinding:Binding|null;versions:readonly Bat[]}>;
export type Link=Readonly<Binding & {tokenHash:string;sessionHash:string;issuedAt:number;expiresAt:number;revoked:boolean}>;
export type Challenge=Readonly<Binding & {id:string;sessionHash:string;linkHash:string;mac:string;issuedAt:number;expiresAt:number;consumed:boolean}>;
export type Series=Readonly<Binding & {sessionHash:string;attempts:number;challenge:Challenge|null}>;
export type CommercialProof=Readonly<Binding & {verified:true}>;
const digest=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
const id=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const time=(v:number)=>Number.isSafeInteger(v)&&v>=0&&v<=Number.MAX_SAFE_INTEGER-LINK_TTL_MS;
const same=(a:Binding,b:Binding)=>a.caseId===b.caseId&&a.version===b.version&&a.digest===b.digest;
const active=(c:Case)=>c.versions.at(-1);
const validBinding=(v:Binding)=>id(v.caseId)&&Number.isSafeInteger(v.version)&&v.version>0&&digest(v.digest);
const freezeCase=(c:Case):Case=>Object.freeze({...c,technicalBinding:c.technicalBinding?Object.freeze({...c.technicalBinding}):null,versions:Object.freeze(c.versions.map(v=>Object.freeze({...v,...(v.approval?{approval:Object.freeze({...v.approval})}:{})})))});
const replace=(c:Case,b:Bat):Case=>freezeCase({...c,versions:[...c.versions.slice(0,-1),b]});
export const hashBytes=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
const validBytes=(bytes:Buffer)=>Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=2_000_000;
/** A trusted archive reader must attest receipt provenance and safe bytes. */
export function openLabCase(caseId:string,receiptId:string,initialDigest:string,archivedBytes:Buffer):Case|null{
 if(!id(caseId)||!id(receiptId)||!digest(initialDigest)||!validBytes(archivedBytes)||hashBytes(archivedBytes)!==initialDigest)return null;
 return freezeCase({caseId,receiptId,initialDigest,technical:"review",technicalBinding:null,versions:[]});
}
/** Workshop decisions do not change commercial proof or copy approval. A correction
 * or infeasibility invalidates the active BAT, even if the next digest is identical. */
export function decideTechnical(c:Case,role:Role,assigned:boolean,decision:Exclude<Technical,"review">,binding:Binding|null):Case|null{
 if(role!=="assigned_workshop"||assigned!==true||!["feasible","correction","infeasible"].includes(decision))return null;
 const b=active(c);
 if(decision==="feasible"){
  if(b){if(!binding||!same(b,binding)||!["pending","approved"].includes(b.status))return null;}
  else if(binding!==null)return null;
  return freezeCase({...c,technical:decision,technicalBinding:b?{caseId:b.caseId,version:b.version,digest:b.digest}:null});
 }
 if(binding!==null)return null;
 const next=freezeCase({...c,technical:decision,technicalBinding:null});
 return b&&b.status!=="replaced"?replace(next,{...b,status:"replaced"}):next;
}
/** The bytes must already be vetted by the isolated trusted renderer. No public storage. */
export function issueBat(c:Case,role:Role,bytes:Buffer,now:number):Case|null{
 if(role!=="authorized_issuer"||!validBytes(bytes)||!time(now)||c.technical!=="feasible"&&c.technical!=="correction")return null;
 const prior=active(c);
 if(prior&&now<prior.issuedAt)return null;
 const version=(prior?.version??0)+1;
 if(!Number.isSafeInteger(version))return null;
 const b:Bat={caseId:c.caseId,version,digest:hashBytes(bytes),status:"pending",issuedAt:now};
 return freezeCase({...c,technical:"review",technicalBinding:null,versions:[...c.versions.slice(0,-1),...(prior?[{...prior,status:"replaced" as const}]:[]),b]});
}
/** No disclosure on wrong case, version, token or session. Expiry is exclusive. */
export function canReview(c:Case,link:Link,token:string,sessionHash:string,now:number):boolean{
 const b=active(c);
 return !!b&&b.status==="pending"&&c.technical==="feasible"&&!!c.technicalBinding&&same(b,c.technicalBinding)&&validBinding(link)&&same(b,link)&&!link.revoked&&digest(token)&&digest(sessionHash)&&digest(link.tokenHash)&&link.sessionHash===sessionHash&&hashBytes(Buffer.from(token))===link.tokenHash&&time(now)&&time(link.issuedAt)&&link.issuedAt>=b.issuedAt&&link.expiresAt===link.issuedAt+LINK_TTL_MS&&now>=link.issuedAt&&now<link.expiresAt;
}
/** Authorization to issue/renew is separately established by trusted adapter.
 * Caller must revoke previous link atomically before returning this capability. */
export function newLink(c:Case,role:Role,authorized:boolean,sessionHash:string,now:number):{link:Link;token:string}|null{
 const b=active(c);
 if(role!=="authorized_issuer"||authorized!==true||!b||b.status!=="pending"||c.technical!=="feasible"||!c.technicalBinding||!same(b,c.technicalBinding)||!digest(sessionHash)||!time(now)||now<b.issuedAt)return null;
 const token=randomBytes(32).toString("hex");
 return {token,link:Object.freeze({caseId:b.caseId,version:b.version,digest:b.digest,tokenHash:hashBytes(Buffer.from(token)),sessionHash,issuedAt:now,expiresAt:now+LINK_TTL_MS,revoked:false})};
}
export function newSeries(b:Bat,sessionHash:string):Series|null{
 if(b.status!=="pending"||!validBinding(b)||!digest(sessionHash))return null;
 return Object.freeze({caseId:b.caseId,version:b.version,digest:b.digest,sessionHash,attempts:0,challenge:null});
}
const validSeries=(s:Series)=>validBinding(s)&&digest(s.sessionHash)&&Number.isInteger(s.attempts)&&s.attempts>=0&&s.attempts<=OTP_MAX_ATTEMPTS;
const validSecret=(secret:Buffer)=>Buffer.isBuffer(secret)&&secret.length>=32;
function mac(secret:Buffer,q:Omit<Challenge,"mac"|"consumed">,code:string):string{
 return createHmac("sha256",secret).update(JSON.stringify([q.caseId,q.version,q.digest,q.id,q.sessionHash,q.linkHash,q.issuedAt,q.expiresAt,code])).digest("hex");
}
/** Code is returned only to a fake SMS adapter; do not log or persist it.
 * Series is unique per BAT in persistence, not reset by rotating a link/challenge. */
export function issueOtp(c:Case,link:Link,token:string,s:Series,sessionHash:string,secret:Buffer,now:number):{series:Series;code:string}|null{
 if(!canReview(c,link,token,sessionHash,now)||!validSecret(secret)||!validSeries(s)||!same(s,link)||s.sessionHash!==sessionHash||s.attempts>=OTP_MAX_ATTEMPTS)return null;
 const code=String(randomInt(0,1_000_000)).padStart(6,"0");
 const q={caseId:s.caseId,version:s.version,digest:s.digest,id:randomBytes(32).toString("hex"),sessionHash,linkHash:link.tokenHash,issuedAt:now,expiresAt:now+OTP_TTL_MS};
 return {code,series:Object.freeze({...s,challenge:Object.freeze({...q,mac:mac(secret,q,code),consumed:false})})};
}
type Attempt=Readonly<{result:"denied"|"wrong"|"locked"|"approved";series:Series;case:Case}>;
export function confirmOtp(c:Case,link:Link,token:string,s:Series,sessionHash:string,challengeId:string,code:unknown,consent:unknown,locale:Locale,secret:Buffer,now:number):Attempt{
 const deny:Attempt={result:"denied",series:s,case:c};
 const b=active(c),q=s.challenge;
 if(!b||!canReview(c,link,token,sessionHash,now)||!validSeries(s)||!same(s,link)||s.sessionHash!==sessionHash||!validSecret(secret)||consent!=="lab-bat-v1"||!["fr","ar"].includes(locale))return deny;
 if(s.attempts>=OTP_MAX_ATTEMPTS)return {...deny,result:"locked"};
 if(!q||q.consumed||!same(q,s)||q.sessionHash!==sessionHash||q.linkHash!==link.tokenHash||q.id!==challengeId||!digest(q.id)||!digest(q.mac)||!time(q.issuedAt)||q.issuedAt<link.issuedAt||q.expiresAt!==q.issuedAt+OTP_TTL_MS||now<q.issuedAt||now>=q.expiresAt)return deny;
 const wellFormed=typeof code==="string"&&/^[0-9]{6}$/.test(code);
 const expected=Buffer.from(mac(secret,q,wellFormed?code:"invalid"),"hex");
 const correct=timingSafeEqual(expected,Buffer.from(q.mac,"hex"))&&wellFormed;
 if(!correct){
  const attempts=s.attempts+1;
  return {result:attempts===OTP_MAX_ATTEMPTS?"locked":"wrong",series:Object.freeze({...s,attempts}),case:c};
 }
 const approved:Bat={...b,status:"approved",approval:{at:now,locale,statement:"lab-bat-v1",sessionHash,challengeId:q.id}};
 return {result:"approved",series:Object.freeze({...s,challenge:Object.freeze({...q,consumed:true})}),case:replace(c,approved)};
}
export function refuseBat(c:Case,link:Link,token:string,sessionHash:string,explicit:boolean,now:number):Case|null{
 const b=active(c);
 return b&&explicit===true&&canReview(c,link,token,sessionHash,now)?replace(c,{...b,status:"refused"}):null;
}
/** Expiration of the business BAT is a trusted policy decision, not the link TTL. */
export function expireBat(c:Case,role:Role,binding:Binding):Case|null{
 const b=active(c);
 return role==="authorized_issuer"&&b&&same(b,binding)&&["pending","approved"].includes(b.status)?replace(c,{...b,status:"expired"}):null;
}
/** Deliberately returns eligibility only. No order or authorization capability.
 * Unknown business validity or commercial proof is a denial. */
export function labEligibility(c:Case,proof:CommercialProof|null,businessValidity:boolean,bytes:Buffer):Readonly<{eligible:boolean;scope:"LAB";manufacturable:false}>{
 const b=active(c);
 const eligible=!!b&&b.status==="approved"&&!!b.approval&&c.technical==="feasible"&&!!c.technicalBinding&&same(b,c.technicalBinding)&&!!proof&&proof.verified===true&&same(b,proof)&&businessValidity===true&&validBytes(bytes)&&hashBytes(bytes)===b.digest;
 return Object.freeze({eligible,scope:"LAB",manufacturable:false});
}
