// J08 LAB only. No public route, identity, mutations, storage or visual design.
// Browser capabilities stay in the HttpOnly cookie; requests have empty bodies.
export type BatLabStatus="review"|"waiting"|"approved"|"refused"|"expired"|"replaced"|"locked";
type Outcome<T>={status:"ok";value:T}|{status:"unavailable"};
export type BatLabState={scope:"LAB";manufacturable:false;version:number;status:BatLabStatus};
export type BatLabPreview={blob:Blob;sourceDigest:string;previewDigest:string};
const states:readonly string[]=["review","waiting","approved","refused","expired","replaced","locked"];
const hex=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
const fail=()=>({status:"unavailable" as const});
const signature=[137,80,78,71,13,10,26,10];
function labOrigin(){return typeof window!=="undefined"&&window.location.protocol==="http:"&&window.location.hostname==="127.0.0.1";}
async function request(path:"/bat/status"|"/bat/preview",signal?:AbortSignal){
 if(!labOrigin()||signal?.aborted)throw Error("LAB_UNAVAILABLE");
 const r=await fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:"{}",credentials:"same-origin",cache:"no-store",redirect:"error",mode:"same-origin",signal});
 if(r.status!==200||r.headers.get("cache-control")!=="no-store"||r.headers.get("x-content-type-options")!=="nosniff")throw Error("LAB_UNAVAILABLE");
 return r;
}
async function readBounded(response:Response,max:number,signal?:AbortSignal){
 const reader=response.body?.getReader();if(!reader)throw Error("LAB_BODY");
 const chunks:Uint8Array[]=[];let total=0,done=false;
 try{
  for(;;){if(signal?.aborted)throw Error("LAB_ABORT");const r=await reader.read();if(r.done){done=true;break;}total+=r.value.byteLength;if(total>max)throw Error("LAB_LIMIT");chunks.push(r.value);}
  if(!total||signal?.aborted)throw Error("LAB_BODY");
  const bytes=new Uint8Array(total);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return bytes;
 }finally{if(!done)await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function readBatLabStatus(signal?:AbortSignal):Promise<Outcome<BatLabState>>{
 try{
  const r=await request("/bat/status",signal);
  if(r.headers.get("content-type")!=="application/json; charset=utf-8")return fail();
  const v:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(await readBounded(r,512,signal)));
  if(!v||typeof v!=="object"||Array.isArray(v)||Object.keys(v).length!==4)return fail();
  const x=v as Record<string,unknown>;
  if(x.scope!=="LAB"||x.manufacturable!==false||typeof x.version!=="number"||!Number.isSafeInteger(x.version)||x.version<1||typeof x.status!=="string"||!states.includes(x.status)||signal?.aborted)return fail();
  return {status:"ok",value:{scope:"LAB",manufacturable:false,version:x.version,status:x.status as BatLabStatus}};
 }catch{return fail();}
}
export async function readBatLabPreview(signal?:AbortSignal):Promise<Outcome<BatLabPreview>>{
 try{
  const r=await request("/bat/preview",signal),sourceDigest=r.headers.get("x-bat-source-sha256"),previewDigest=r.headers.get("x-bat-preview-sha256"),length=r.headers.get("content-length");
  if(r.headers.get("content-type")!=="image/png"||!hex(sourceDigest)||!hex(previewDigest)||!length||!/^\d+$/.test(length)||Number(length)>4_000_000)return fail();
  const bytes=await readBounded(r,4_000_000,signal);
  if(bytes.byteLength!==Number(length)||bytes.length<57||!signature.every((v,i)=>bytes[i]===v))return fail();
  const actual=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),v=>v.toString(16).padStart(2,"0")).join("");
  if(actual!==previewDigest||signal?.aborted)return fail();
  return {status:"ok",value:{blob:new Blob([bytes],{type:"image/png"}),sourceDigest,previewDigest}};
 }catch{return fail();}
}
