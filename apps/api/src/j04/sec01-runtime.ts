import { Controller, Inject, Module, Post, Req, Res } from "@nestjs/common";
import type { DynamicModule } from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { TextDecoder } from "node:util";
import type { ComposeSql, createComposePorts } from "./sec01-compose-ports";

type Ports = Awaited<ReturnType<typeof createComposePorts>>;
type Credentials = {email:string;password:string};
type Identity = {subject:string;sessionId:string};
type Provider = {
 begin(c:Credentials):Promise<{subject:string;challenge:string;cookies:string[]}>;
 complete(challenge:string,code:string):Promise<Identity & {cookie:string;cookies:string[]}>;
 read(cookie:string):Promise<Identity|null>;
 revoke(cookie:string):Promise<string[]>;
};
type Guard = {admit(req:IncomingMessage):Promise<{status:number;credentials?:Credentials}>};
type Config = {origin:string;ports:Ports;writer:ComposeSql;logout:ComposeSql;provider:Provider;guard:Guard;replayKey:Uint8Array;tokenKey:Uint8Array};
type Flow = {state:"starting"|"pending"|"verifying"|"verified"|"consuming";csrf:string;expires:number;digest:Buffer;subject?:string;challenge?:string;identity?:Identity;cookieDigest?:Buffer};
const nativeName="__Secure-better-auth.session_token", privilegedName="pk_admin_compose";
const deny=():never=>{throw Error("SEC01_DENIED");};
const opaque=/^[A-Za-z0-9_-]{43}$/, hex=/^[0-9a-f]{64}$/, uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const random=()=>randomBytes(32).toString("base64url");
const equal=(a:Buffer,b:Buffer)=>a.length===b.length&&timingSafeEqual(a,b);
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:deny();
const shape=(v:Record<string,unknown>,keys:string[])=>{if(Object.keys(v).sort().join(",")!==keys.sort().join(","))deny();};
function cookie(raw:unknown,name:string):string{
 if(typeof raw!=="string"||raw.length>8192||/[\r\n\0]/.test(raw))return deny();
 const xs=raw.split(";").map(x=>x.trim()).filter(x=>x.startsWith(name+"="));
 if(xs.length!==1||! /^[A-Za-z0-9._%~+=/-]{1,2048}$/.test(xs[0].slice(name.length+1)))return deny();
 return xs[0];
}
function challenge(raw:unknown):string{
 if(typeof raw!=="string"||raw.length>8192)return deny();
 const xs=raw.split(";").map(x=>x.trim()).filter(x=>x.split("=")[0].endsWith(".two_factor"));
 if(xs.length!==1)return deny();
 return cookie(raw,xs[0].split("=")[0]);
}
const csrfHeader=(req:IncomingMessage):string=>typeof req.headers["x-sec01-csrf"]==="string"?req.headers["x-sec01-csrf"]:deny();
function headers(req:IncomingMessage,origin:string,route:string){
 if(req.url!==route||req.method!=="POST"||req.headers.origin!==origin||req.headers["sec-fetch-site"]!=="same-origin"||req.headers["content-type"]!=="application/json"||req.headers["content-encoding"]!==undefined)deny();
 const protectedNames=new Set(["origin","content-type","cookie","x-sec01-csrf","sec-fetch-site","content-length","content-encoding"]);
 const seen=new Set<string>();
 for(let i=0;i<req.rawHeaders.length;i+=2){const n=req.rawHeaders[i].toLowerCase();if(protectedNames.has(n)){if(seen.has(n))deny();seen.add(n);}}
}
async function body(req:IncomingMessage,max:number){
 const chunks:Buffer[]=[];let size=0;
 for await(const data of req){const b=Buffer.isBuffer(data)?data:Buffer.from(data);size+=b.length;if(size>max)deny();chunks.push(b);}
 return object(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks))));
}
function respond(res:ServerResponse,status:number,data:unknown,cookies:string[]=[]){
 res.statusCode=status;res.setHeader("Cache-Control","no-store");res.setHeader("Content-Type","application/json");
 if(cookies.length)res.setHeader("Set-Cookie",cookies);res.end(JSON.stringify(data));
}
/** Native provider adapter. Native handler is private; only allowlisted calls below. */
export function createNativeProvider(origin:string,handler:(r:Request)=>Promise<Response>,lookup:(email:string)=>Promise<string|null>):Provider{
 async function call(route:string,data?:unknown,raw?:string){
  const h=new Headers({origin,accept:"application/json","sec-fetch-site":"same-origin"});if(raw)h.set("cookie",raw);
  if(data!==undefined)h.set("content-type","application/json");
  const res=await handler(new Request(origin+"/api/auth"+route,{method:data===undefined?"GET":"POST",headers:h,...(data===undefined?{}:{body:JSON.stringify(data)})}));
  if(!res.ok)deny();return {data:await res.json(),cookies:res.headers.getSetCookie()};
 }
 const pairs=(xs:string[])=>xs.map(x=>x.split(";")[0]).filter(x=>!x.endsWith("=")).join("; ");
 async function read(raw:string):Promise<Identity|null>{
  const r=await call("/get-session",undefined,cookie(raw,nativeName));
  const s=r.data?.session,u=r.data?.user;
  if(!s||!u)return null;
  if(typeof s.id!=="string"||typeof u.id!=="string"||s.userId!==u.id||u.twoFactorEnabled!==true)return deny();
  return {subject:u.id,sessionId:s.id};
 }
 async function revoke(raw:string){const r=await call("/sign-out",{},cookie(raw,nativeName));return r.cookies;}
 return {
  async begin(c){const r=await call("/sign-in/email",c);if(r.data?.twoFactorRedirect!==true||!r.data?.twoFactorMethods?.includes("totp"))deny();
   const subject=await lookup(c.email);if(typeof subject!=="string"||subject.length<6||subject.length>150)return deny();
   const raw=pairs(r.cookies);if(raw.includes(nativeName+"=")||raw.includes(".trust_device="))deny();
   return {subject,challenge:challenge(raw),cookies:r.cookies};},
  async complete(ch,code){const r=await call("/two-factor/verify-totp",{code,trustDevice:false},ch);
   const raw=pairs(r.cookies);const native=cookie(raw,nativeName);
   try{if(raw.includes(".trust_device=")||raw.includes(".two_factor="))deny();const id=await read(native);if(!id)return deny();return {...id,cookie:native,cookies:r.cookies};}
   catch(e){await revoke(native);throw e;}},
  read,revoke
 };
}
export class Sec01Runtime {
 private readonly flows=new Map<string,Flow>();
 private readonly flowKey=randomBytes(32);
 private readonly replay:Buffer;
 private readonly token:Buffer;
 constructor(private readonly cfg:Config){
  const u=new URL(cfg.origin);if(u.origin!==cfg.origin||u.protocol!=="https:"||u.hostname!=="127.0.0.1"||!u.port||cfg.replayKey.byteLength!==32||cfg.tokenKey.byteLength!==32||cfg.writer===cfg.logout)deny();
  this.replay=Buffer.from(cfg.replayKey);this.token=Buffer.from(cfg.tokenKey);
 }
 private mac(key:Buffer,domain:string,value:string){return createHmac("sha256",key).update(domain+"\0"+value).digest();}
 private prune(){for(const [k,f] of this.flows)if(f.expires<=Date.now())this.flows.delete(k);}
 private live(k:string,f:Flow){if(this.flows.get(k)!==f||f.expires<=Date.now())deny();}
 private lookup(k:unknown,csrf:string,state:Flow["state"]):[string,Flow]{
  this.prune();if(typeof k!=="string"||!opaque.test(k)||!opaque.test(csrf))return deny();
  const f=this.flows.get(k);if(!f||f.state!==state||!equal(Buffer.from(f.csrf),Buffer.from(csrf)))return deny();
  return [k,f];
 }
 private async begin(req:IncomingMessage,res:ServerResponse){
  // IP budget consumed by the existing restricted login guard before body parsing.
  const admission=await this.cfg.guard.admit(req);
  if(admission.status!==200||!admission.credentials){req.resume();return respond(res,admission.status,{message:"SEC01 denied"});}
  headers(req,this.cfg.origin,"/sec01/begin");this.prune();if(this.flows.size>=128)deny();
  const k=random(),f:Flow={state:"starting",csrf:random(),expires:Date.now()+60000,digest:this.mac(this.flowKey,"proof",k)};
  this.flows.set(k,f);
  try{const p=await this.cfg.provider.begin(admission.credentials);this.live(k,f);f.subject=p.subject;f.challenge=p.challenge;
   await this.cfg.ports.begin(p.subject,f.digest,new Date(f.expires));this.live(k,f);f.state="pending";
   respond(res,200,{flow:k,csrf:f.csrf},p.cookies);
  }catch(e){this.flows.delete(k);throw e;}
 }
 private async complete(req:IncomingMessage,res:ServerResponse){
  const b=await body(req,4096);shape(b,["flow","code"]);
  const [k,f]=this.lookup(b.flow,csrfHeader(req),"pending");
  if(typeof b.code!=="string"||! /^\d{6}$/.test(b.code)||!f.subject||!f.challenge||challenge(req.headers.cookie)!==f.challenge)deny();
  const subject=f.subject as string, ch=f.challenge as string, code=b.code as string;
  f.state="verifying";let native:Awaited<ReturnType<Provider["complete"]>>|undefined;
  try{const tag=this.mac(this.replay,"PANOKIT/TOTP/v1",subject+"\0"+code);
   if(!await this.cfg.ports.reserve(subject,f.digest,tag))deny();this.live(k,f);
   native=await this.cfg.provider.complete(ch,code);this.live(k,f);
   if(native.subject!==subject)deny();
   await this.cfg.ports.mark(subject,f.digest,native.sessionId);this.live(k,f);
   f.identity={subject,sessionId:native.sessionId};f.cookieDigest=this.mac(this.flowKey,"cookie",native.cookie);f.state="verified";delete f.challenge;
   respond(res,200,{proof:k,csrf:f.csrf},native.cookies);
  }catch(e){this.flows.delete(k);if(native)await this.cfg.provider.revoke(native.cookie);throw e;}
 }
 private async issue(req:IncomingMessage,res:ServerResponse){
  const b=await body(req,4096);shape(b,["proof"]);const [k,f]=this.lookup(b.proof,csrfHeader(req),"verified");
  const native=cookie(req.headers.cookie,nativeName);
  if(!f.cookieDigest||!equal(f.cookieDigest,this.mac(this.flowKey,"cookie",native)))deny();
  f.state="consuming";
  try{const id=await this.cfg.provider.read(native);this.live(k,f);if(!id||id.subject!==f.identity?.subject||id.sessionId!==f.identity.sessionId)return deny();
   const sid=randomUUID(),value=randomBytes(32).toString("hex")+"."+sid;
   await this.cfg.ports.issue(id.subject,f.digest,sid,this.mac(this.token,"session",value),new Date(Date.now()+240000));
   respond(res,200,{ok:true,csrf:this.mac(this.token,"csrf",value).toString("hex")},[privilegedName+"="+value+"; Path=/sec01; Max-Age=240; HttpOnly; Secure; SameSite=Strict"]);
  }finally{this.flows.delete(k);}
 }
 private async context(req:IncomingMessage){
  const raw=cookie(req.headers.cookie,nativeName),value=cookie(req.headers.cookie,privilegedName).slice(privilegedName.length+1);
  const [token,id,...rest]=value.split("."),csrf=csrfHeader(req);
  if(rest.length||!hex.test(token)||!uuid.test(id)||!hex.test(csrf)||!equal(Buffer.from(csrf,"hex"),this.mac(this.token,"csrf",value)))deny();
  const native=await this.cfg.provider.read(raw);if(!native)return deny();
  return {raw,id,digest:this.mac(this.token,"session",value),native};
 }
 async handle(route:string,req:IncomingMessage,res:ServerResponse){
  try{
   if(route==="/sec01/begin")return await this.begin(req,res);
   headers(req,this.cfg.origin,route);
   if(route==="/sec01/complete")return await this.complete(req,res);
   if(route==="/sec01/issue")return await this.issue(req,res);
   const c=await this.context(req),b=await body(req,65536);
   if(route==="/sec01/write"){
    shape(b,["operation","revision","config"]);const config=object(b.config);
    if(typeof b.operation!=="string"||!uuid.test(b.operation)||typeof b.revision!=="number"||!Number.isInteger(b.revision)||b.revision<1||b.revision>=2147483647)deny();
    const r=await this.cfg.writer.query("select * from sec01_admin.write_context_pricing($1,$2,$3,$4,$5,$6,$7)",[c.id,c.digest,b.operation,b.revision,JSON.stringify(config),c.native.subject,c.native.sessionId]);
    const row=r.rows[0];if(r.rows.length!==1||typeof b.revision!=="number"||row.revision!==b.revision+1||typeof row.replayed!=="boolean")deny();
    return respond(res,200,row);
   }
   if(route==="/sec01/logout"){
    shape(b,[]);const r=await this.cfg.logout.query("select sec01_admin.logout_context($1,$2,$3,$4) as ok",[c.id,c.digest,c.native.subject,c.native.sessionId]);
    if(r.rows.length!==1||r.rows[0].ok!==true)deny();
    const cookies=await this.cfg.provider.revoke(c.raw);return respond(res,200,{ok:true},[...cookies,privilegedName+"=; Path=/sec01; Max-Age=0; HttpOnly; Secure; SameSite=Strict"]);
   }
   deny();
  }catch{req.resume();if(!res.headersSent){res.removeHeader("Set-Cookie");respond(res,403,{message:"SEC01 denied"});}else res.end();}
 }
}
const RUNTIME=Symbol("SEC01_RUNTIME");
@Controller("sec01")
class Sec01Controller{
 constructor(@Inject(RUNTIME)private readonly runtime:Sec01Runtime){}
 @Post("begin") begin(@Req()req:IncomingMessage,@Res()res:ServerResponse){return this.runtime.handle("/sec01/begin",req,res);}
 @Post("complete") complete(@Req()req:IncomingMessage,@Res()res:ServerResponse){return this.runtime.handle("/sec01/complete",req,res);}
 @Post("issue") issue(@Req()req:IncomingMessage,@Res()res:ServerResponse){return this.runtime.handle("/sec01/issue",req,res);}
 @Post("write") write(@Req()req:IncomingMessage,@Res()res:ServerResponse){return this.runtime.handle("/sec01/write",req,res);}
 @Post("logout") logout(@Req()req:IncomingMessage,@Res()res:ServerResponse){return this.runtime.handle("/sec01/logout",req,res);}
}
@Module({})
export class Sec01ComposeModule{
 static disposable(config:Config):DynamicModule{return {module:Sec01ComposeModule,controllers:[Sec01Controller],providers:[{provide:RUNTIME,useValue:new Sec01Runtime(config)}]};}
}
