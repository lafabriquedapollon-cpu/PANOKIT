import {createServer} from "node:http";
import {createHash,randomBytes} from "node:crypto";
import type {AddressInfo} from "node:net";
import type {createBatLabAdapter} from "./bat-pg-lab";

type Adapter=Pick<ReturnType<typeof createBatLabAdapter>,"status">;
type Binding=Readonly<{caseId:string;version:number;linkToken:string;sourceSession:string}>;
type Session={binding:Binding;deadline:number;busy:boolean};
const hex=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const hash=(v:string)=>createHash("sha256").update(v).digest("hex");
const token=()=>randomBytes(32).toString("hex");
const states=["review","waiting","approved","refused","expired","replaced","locked"];
const headers={"cache-control":"no-store","content-type":"application/json; charset=utf-8","x-content-type-options":"nosniff","referrer-policy":"no-referrer","cross-origin-resource-policy":"same-origin","content-security-policy":"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'","x-robots-tag":"noindex, nofollow"};
/** Status-only first transport slice. Fixture provisioning is a trusted
 * in-process operation, not an HTTP endpoint. No rendering, OTP or public route. */
export async function startBatStatusBroker(adapter:Adapter,ttlMs=120000){
 if(!Number.isSafeInteger(ttlMs)||ttlMs<1||ttlMs>120000)throw Error("LAB_TTL");
 const sessions=new Map<string,Session>();
 const cookieName="j08lab_"+randomBytes(12).toString("hex");
 let origin="",closed=false;
 const live=(s:Session)=>!closed&&performance.now()<s.deadline;
 const server=createServer(async(req,res)=>{
  const send=(status:number,body:unknown)=>{res.writeHead(status,headers);res.end(JSON.stringify(body));};
  const deny=(status=403)=>send(status,{status:"unavailable",manufacturable:false});
  let held:Session|undefined;
  try{
   const h=req.headersDistinct;
   if(req.socket.remoteAddress!=="127.0.0.1"||h.host?.length!==1||h.host[0]!==new URL(origin).host||req.method!=="POST"||req.url!=="/bat/status"||h.origin?.length!==1||h.origin[0]!==origin||h["sec-fetch-site"]?.length!==1||h["sec-fetch-site"][0]!=="same-origin"||h["content-type"]?.length!==1||h["content-type"][0]!=="application/json"||h["content-encoding"]!==undefined||h.cookie?.length!==1){deny();return;}
   const matches=h.cookie[0].split(";").map(x=>x.trim()).filter(x=>x.startsWith(cookieName+"="));
   if(matches.length!==1){deny();return;}
   const raw=matches[0].slice(cookieName.length+1);
   if(!hex(raw)){deny();return;}
   const key=hash(raw),s=sessions.get(key);
   if(!s||!live(s)||s.busy){deny();return;}
   s.busy=true;held=s;
   const chunks:Buffer[]=[];let size=0;
   for await(const part of req){const b=Buffer.from(part);size+=b.length;if(size>64){deny(413);return;}chunks.push(b);}
   let body:unknown;
   try{body=JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{deny(400);return;}
   if(body===null||typeof body!=="object"||Array.isArray(body)||Object.keys(body).length!==0){deny(400);return;}
   if(!live(s)||sessions.get(key)!==s){deny();return;}
   const {caseId,version,linkToken,sourceSession}=s.binding;
   const r=await adapter.status({caseId,version,linkToken},sourceSession);
   if(!live(s)||sessions.get(key)!==s||r.status!=="ok"){deny();return;}
   const v=r.value;
   if(v.scope!=="LAB"||v.manufacturable!==false||v.version!==version||!states.includes(v.status)){deny();return;}
   send(200,{scope:"LAB",manufacturable:false,version,status:v.status});
  }catch{if(!res.headersSent)deny(503);else res.end();}
  finally{if(held)held.busy=false;}
 });
 server.requestTimeout=5000;server.headersTimeout=3000;
 await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
 origin="http://127.0.0.1:"+(server.address() as AddressInfo).port;
 return {
  origin,cookieName,
  // Harness must already possess the original J07 session and issued link.
  // Cookie is unique to this listener, HttpOnly/SameSite Strict in browser.
  // HTTP loopback is LAB-only; never reuse this transport on a public host.
  provision(binding:Binding){
   if(closed||!uuid(binding.caseId)||!Number.isSafeInteger(binding.version)||binding.version<1||!hex(binding.linkToken)||!hex(binding.sourceSession))throw Error("LAB_BINDING");
   for(const [key,s] of sessions)if(!live(s)&&!s.busy)sessions.delete(key);
   if(sessions.size>=64)throw Error("LAB_CAPACITY");
   const id=token(),key=hash(id);
   sessions.set(key,{binding:Object.freeze({caseId:binding.caseId,version:binding.version,linkToken:binding.linkToken,sourceSession:binding.sourceSession}),deadline:performance.now()+ttlMs,busy:false});
   return {cookie:cookieName+"="+id+"; HttpOnly; SameSite=Strict; Path=/bat; Max-Age="+Math.ceil(ttlMs/1000),revoke:()=>{sessions.delete(key);}};
  },
  close:async()=>{closed=true;sessions.clear();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
 };
}
