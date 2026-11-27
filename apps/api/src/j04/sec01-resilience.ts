import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ComposeSql } from "./sec01-compose-ports";
const fail=():never=>{throw Error("SEC01_RESILIENCE_DENIED");};
export const keyId=(key:Uint8Array)=>createHash("sha256").update(key).digest();
const equal=(a:unknown,b:Buffer)=>Buffer.isBuffer(a)&&a.length===b.length&&timingSafeEqual(a,b);
type Fixed={login:Buffer;token:Buffer;auth:Buffer};
type Keys=Fixed&{replay:Buffer};
/** Linux disposable owner-only store; provisioning is explicit. Missing or malformed material never regenerates. */
export class Sec01KeyStore {
 private readonly root:string;
 private readonly uid:number;
 constructor(root:string){
  if(process.platform!=="linux"||typeof process.getuid!=="function"||process.getuid()===0)throw Error("SEC01_KEYSTORE_PLATFORM");
  this.uid=process.getuid();this.root=resolve(root);this.checkRoot();
 }
 private checkRoot(){
  const st=lstatSync(this.root);
  if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==this.uid||(st.mode&0o777)!==0o700||realpathSync(this.root)!==this.root)fail();
 }
 private read(name:string,size:number){
  this.checkRoot();const fd=openSync(join(this.root,name),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const st=fstatSync(fd);if(!st.isFile()||st.nlink!==1||st.uid!==this.uid||(st.mode&0o777)!==0o600||st.size!==size)fail();
   const value=readFileSync(fd);if(value.length!==size)fail();return value;
  }finally{closeSync(fd);}
 }
 private persist(name:string,bytes:Buffer){
  this.checkRoot();const fd=openSync(join(this.root,name),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
  const d=openSync(this.root,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(d);}finally{closeSync(d);}
  if(!equal(this.read(name,bytes.length),bytes))fail();
 }
 provisionFixed(){this.persist("fixed.keys",randomBytes(96));return this.fixed();}
 fixed():Fixed{const b=this.read("fixed.keys",96);return {login:b.subarray(0,32),token:b.subarray(32,64),auth:b.subarray(64,96)};}
 persistReplay(){const key=randomBytes(32),id=keyId(key);this.persist("replay-"+id.toString("hex")+".key",key);return id;}
 replay(id:Buffer){if(!Buffer.isBuffer(id)||id.length!==32)fail();const b=this.read("replay-"+id.toString("hex")+".key",32);if(!equal(keyId(b),id))fail();return b;}
}
export async function loadFencedKeys(store:Sec01KeyStore,verifier:ComposeSql):Promise<Keys>{
 const identity=(await verifier.query("select session_user as su,current_user as cu,current_database() as db")).rows[0];
 if(identity?.su!=="sec01_admin_mfa_verifier"||identity.cu!==identity.su||identity.db!=="panokit_sec01_sovereign_lab")fail();
 const r=await verifier.query("select * from sec01_admin.read_runtime_keys()");
 if(r.rows.length!==1)fail();const row=r.rows[0],fixed=store.fixed();
 if(!equal(row.login_id,keyId(fixed.login))||!equal(row.token_id,keyId(fixed.token))||!equal(row.auth_id,keyId(fixed.auth))||!Buffer.isBuffer(row.replay_id))return fail();
 return {...fixed,replay:store.replay(row.replay_id)};
}
/** Narrow SQL adapter for the certified ingress guard. No unversioned admission or arbitrary SQL. */
export async function createFencedLoginPort(db:ComposeSql,loginKey:Uint8Array):Promise<ComposeSql>{
 const id=keyId(loginKey),r=await db.query("select session_user as su,current_user as cu,current_database() as db");
 if(loginKey.byteLength!==32||r.rows.length!==1||r.rows[0].su!=="sec01_admin_login_guard"||r.rows[0].cu!==r.rows[0].su||r.rows[0].db!=="panokit_sec01_sovereign_lab")fail();
 return Object.freeze({async query(sql:string,args:unknown[]=[]){
  if(sql!=="select sec01_admin.reserve_login($1,$2) as allowed"||args.length!==2)fail();
  return db.query("select sec01_admin.reserve_versioned_login($1,$2,$3) as allowed",[args[0],args[1],id]);
 }});
}
type Sweep=(runId:string,limit:number)=>Promise<Record<string,unknown>>;
/** Non-overlapping supervised batches. Actual SQL transaction is the only heartbeat authority. */
export class ExpirySupervisor{
 private timer:NodeJS.Timeout|undefined;
 private active:Promise<void>|undefined;
 private stopped=true;
 private successful=0;
 private failed=0;
 private complete=false;
 constructor(private readonly sweep:Sweep,private readonly intervalMs:number,private readonly limit:number){
  if(!Number.isInteger(intervalMs)||intervalMs<20||intervalMs>30000||!Number.isInteger(limit)||limit<1||limit>100)fail();
 }
 start(){if(!this.stopped||this.active)fail();this.stopped=false;this.tick();}
 private tick(){
  if(this.stopped)return;
  this.active=(async()=>{try{const r=await this.sweep(randomUUID(),this.limit);if(typeof r.complete!=="boolean")fail();this.complete=r.complete===true;this.successful++;}
   catch{this.complete=false;this.failed++;}
   finally{this.active=undefined;if(!this.stopped)this.timer=setTimeout(()=>this.tick(),this.intervalMs);}})();
 }
 async stop(){this.stopped=true;if(this.timer)clearTimeout(this.timer);this.timer=undefined;await this.active;}
 status(){return {running:!this.stopped,successful:this.successful,failed:this.failed,complete:this.complete};}
}
