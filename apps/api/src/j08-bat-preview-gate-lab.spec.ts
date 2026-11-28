import assert from "node:assert/strict";
import {test} from "node:test";
import {createHash} from "node:crypto";
import {deflateSync} from "node:zlib";
import {createBatPreviewGate} from "./j08/bat-preview-gate-lab";
import {startBatStatusBroker} from "./j08/bat-status-broker-lab";
import type {createBatLabAdapter} from "./j08/bat-pg-lab";
type Adapter=Pick<ReturnType<typeof createBatLabAdapter>,"review">;
const sha=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
const src=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>LAB</text></svg>');
const binding={caseId:"11111111-1111-4111-8111-111111111111",version:1,sourceSession:"a".repeat(64),linkToken:"b".repeat(64),expectedDigest:sha(src)};
function chunk(type:string,data:Buffer){const payload=Buffer.concat([Buffer.from(type),data]);let c=0xffffffff;for(const x of payload){c^=x;for(let i=0;i<8;i++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;}const len=Buffer.alloc(4),crc=Buffer.alloc(4);len.writeUInt32BE(data.length);crc.writeUInt32BE((c^0xffffffff)>>>0);return Buffer.concat([len,payload,crc]);}
function png(width=1,height=1,scan=Buffer.from([0,255,0,0,255]),extra:Buffer[]=[]) {const h=Buffer.alloc(13);h.writeUInt32BE(width,0);h.writeUInt32BE(height,4);h[8]=8;h[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",h),...extra,chunk("IDAT",deflateSync(scan)),chunk("IEND",Buffer.alloc(0))]);}
const fixture=png();
const ok:Awaited<ReturnType<Adapter["review"]>>={status:"ok",value:{scope:"LAB",manufacturable:false,version:1,digest:binding.expectedDigest,bytesBase64:src.toString("base64")}};
const unavailable={status:"unavailable"};
function setup(response:Awaited<ReturnType<Adapter["review"]>>=ok,output=fixture){let reads=0,renders=0;const gate=createBatPreviewGate({review:async(input,session)=>{reads++;assert.deepEqual(input,{caseId:binding.caseId,version:1,linkToken:binding.linkToken});assert.equal(session,binding.sourceSession);return response;}},[binding.expectedDigest],async b=>{renders++;assert.deepEqual(b,src);return output;});return {gate,counts:()=>[reads,renders]};}
test("J08 R01 verified source yields only bounded PNG and distinct source/preview digests",async()=>{const f=setup();assert.deepEqual(await f.gate(binding),{status:"ok",value:{scope:"LAB",manufacturable:false,version:1,sourceDigest:sha(src),previewDigest:sha(fixture),mime:"image/png",pngBase64:fixture.toString("base64"),width:1,height:1}});assert.deepEqual(f.counts(),[1,1]);});
test("J08 R02 unpinned digest fails before database or rasterizer",async()=>{const f=setup();assert.deepEqual(await f.gate({...binding,expectedDigest:"c".repeat(64)}),unavailable);assert.deepEqual(f.counts(),[0,0]);});
test("J08 R03 unauthorized or replaced source never reaches rasterizer",async()=>{const f=setup({status:"unavailable"});assert.deepEqual(await f.gate(binding),unavailable);assert.deepEqual(f.counts(),[1,0]);});
test("J08 R04 corrupted source bytes and mismatched version fail closed",async()=>{for(const value of [{...ok.value,bytesBase64:Buffer.from("<script/>").toString("base64")},{...ok.value,version:2},{...ok.value,digest:"c".repeat(64)},{...ok.value,bytesBase64:ok.value.bytesBase64+"="}]){const f=setup({status:"ok",value});assert.deepEqual(await f.gate(binding),unavailable);assert.deepEqual(f.counts(),[1,0]);}});
test("J08 R05 non PNG, truncation, trailing bytes and broken CRC rejected",async()=>{const corrupt=Buffer.from(fixture);corrupt[29]^=1;for(const output of [src,fixture.subarray(0,-1),Buffer.concat([fixture,Buffer.from("x")]),corrupt]){const f=setup(ok,output);assert.deepEqual(await f.gate(binding),unavailable);}});
test("J08 R06 PNG metadata and active payload chunks rejected",async()=>{for(const name of ["tEXt","iTXt","acTL","eXIf"]){const f=setup(ok,png(1,1,Buffer.from([0,1,2,3,4]),[chunk(name,Buffer.from("payload"))]));assert.deepEqual(await f.gate(binding),unavailable);}});
test("J08 R07 oversized dimensions and invalid scanlines rejected",async()=>{for(const output of [png(2049,1),png(2048,2048),png(1,1,Buffer.from([0,1,2])),png(1,1,Buffer.from([5,1,2,3,4])),png(1,1,Buffer.alloc(5000))]){const f=setup(ok,output);assert.deepEqual(await f.gate(binding),unavailable);}});
test("J08 R08 rasterizer failure is generic and invalid registry cannot start",async()=>{const gate=createBatPreviewGate({review:async()=>ok},[binding.expectedDigest],async()=>{throw Error(binding.sourceSession);});assert.deepEqual(await gate(binding),unavailable);assert.throws(()=>createBatPreviewGate({review:async()=>ok},[],async()=>fixture));});

type StatusAdapter=Pick<ReturnType<typeof createBatLabAdapter>,"status">;
const current:Awaited<ReturnType<StatusAdapter["status"]>>={status:"ok",value:{scope:"LAB",manufacturable:false,version:1,status:"review"}};
async function imageFixture(status:StatusAdapter["status"],gate=setup().gate){
 const broker=await startBatStatusBroker({status},120000,gate),session=broker.provision(binding);
 const call=()=>fetch(broker.origin+"/bat/preview",{method:"POST",headers:{origin:broker.origin,"sec-fetch-site":"same-origin","content-type":"application/json",cookie:session.cookie.split(";")[0]},body:"{}"});
 return {broker,session,call};
}
test("J08 N01 fresh status after rendering must still authorize review",async()=>{
 const f=setup();let checks=0;const b=await imageFixture(async()=>{assert.deepEqual(f.counts(),[1,1]);checks++;return {status:"ok",value:{...current.value,status:"replaced"}};},f.gate);
 try{const r=await b.call();assert.equal(r.status,403);assert.deepEqual(await r.json(),{status:"unavailable",manufacturable:false});assert.equal(r.headers.get("x-bat-preview-sha256"),null);assert.equal(checks,1);}finally{await b.broker.close();}
});
test("J08 N02 revocation while final status is pending denies image",async()=>{
 let release!:()=>void,entered!:()=>void;const waiting=new Promise<void>(r=>{release=r;}),ready=new Promise<void>(r=>{entered=r;});
 const b=await imageFixture(async()=>{entered();await waiting;return current;});
 try{const first=b.call();await ready;const second=await b.call();assert.equal(second.status,403);await second.text();b.session.revoke();release();const r=await first;assert.equal(r.status,403);assert.deepEqual(await r.json(),{status:"unavailable",manufacturable:false});}finally{release();await b.broker.close();}
});
test("J08 N03 preview digest mismatch is rejected before final status",async()=>{
 let checks=0;const valid=setup().gate;const b=await imageFixture(async()=>{checks++;return current;},async x=>{const r=await valid(x);return r.status==="ok"?{status:"ok",value:{...r.value,previewDigest:"0".repeat(64)}}:r;});
 try{const r=await b.call();assert.equal(r.status,403);assert.deepEqual(await r.json(),{status:"unavailable",manufacturable:false});assert.equal(checks,0);}finally{await b.broker.close();}
});

type DecisionPort=Pick<ReturnType<typeof createBatLabAdapter>,"sendOtp"|"confirm"|"refuse">;
const challengeId="22222222-2222-4222-8222-222222222222";
const issue={action:"request-otp"},confirm={action:"confirm",explicit:true,locale:"fr",code:"012345"},refuse={action:"refuse",explicit:true,locale:"ar"};
async function mutationFixture(enabled=true,overrides:Partial<DecisionPort>={},status:StatusAdapter["status"]=async()=>current){
 const calls:unknown[][]=[];
 const port:DecisionPort={
  sendOtp:async(...args)=>{calls.push(["issue",...args]);return {status:"ok",value:{challengeId}};},
  confirm:async(...args)=>{calls.push(["confirm",...args]);return {status:"ok",value:"approved"};},
  refuse:async(...args)=>{calls.push(["refuse",...args]);return {status:"ok",value:true};},
  ...overrides
 };
 const broker=await startBatStatusBroker({status},120000,setup().gate,enabled?port:undefined);
 const session=broker.provision(binding);
 const headers={origin:broker.origin,"sec-fetch-site":"same-origin","content-type":"application/json",cookie:session.cookie.split(";")[0]};
 const call=(body:unknown,path="/bat/decision",patch:Record<string,string>={},raw=false)=>fetch(broker.origin+path,{method:"POST",headers:{...headers,...patch},body:raw?String(body):JSON.stringify(body)});
 const show=async(patch:Record<string,string>={})=>{const r=await call({},"/bat/preview",patch);assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),fixture);};
 const deny=async(r:Response,status=403)=>{assert.equal(r.status,status);assert.deepEqual(await r.json(),{status:"unavailable",manufacturable:false});};
 const result=async(r:Response,value:string)=>{assert.equal(r.status,200);assert.equal(r.headers.get("cache-control"),"no-store");assert.deepEqual(await r.json(),{scope:"LAB",manufacturable:false,version:1,result:value});};
 return {broker,session,headers,call,show,deny,result,calls};
}
test("J08 M2-01 default broker stays read-only even after verified preview",async()=>{
 const f=await mutationFixture(false);try{await f.show();await f.deny(await f.call(issue));assert.equal(f.calls.length,0);}finally{await f.broker.close();}
});
test("J08 M2-02 requires verified preview of same provisioned cookie",async()=>{
 const f=await mutationFixture();try{
  await f.deny(await f.call(issue));await f.show();
  const second=f.broker.provision(binding),cookie=second.cookie.split(";")[0];
  await f.deny(await f.call(issue,"/bat/decision",{cookie}));
  assert.equal(f.calls.length,0);
  await f.result(await f.call(issue),"otp-sent");
 }finally{await f.broker.close();}
});
test("J08 M2-03 origin, media type, cookie, route and ambiguous JSON rejected",async()=>{
 const f=await mutationFixture();try{await f.show();
  const patches:Record<string,string>[]=[{origin:"http://evil.invalid"},{"sec-fetch-site":"cross-site"},{cookie:""},{"content-type":"text/plain"},{"content-encoding":"gzip"},{cookie:f.headers.cookie+"; "+f.headers.cookie}];
  for(const patch of patches)await f.deny(await f.call(issue,"/bat/decision",patch));
  await f.deny(await f.call(issue,"/bat/decision?x=1"));
  await f.deny(await f.call('{"action":"refuse","action":"request-otp"}',"/bat/decision",{},true),400);
  await f.deny(await f.call("x".repeat(257),"/bat/decision",{},true),413);
  await f.deny(await f.call({...issue,digest:binding.expectedDigest}));
  await f.deny(await f.call({...refuse,explicit:false}));
  assert.equal(f.calls.length,0);
 }finally{await f.broker.close();}
});
test("J08 M2-04 confirmation and replay use only server-bound context",async()=>{
 const f=await mutationFixture();try{await f.show();
  await f.deny(await f.call(confirm));await f.result(await f.call(issue),"otp-sent");
  await f.deny(await f.call(issue));await f.result(await f.call(confirm),"approved");
  await f.deny(await f.call(confirm));await f.deny(await f.call(refuse));
  const context={caseId:binding.caseId,version:binding.version,linkToken:binding.linkToken,digest:binding.expectedDigest};
  assert.deepEqual(f.calls,[["issue",context,binding.sourceSession],["confirm",{...context,challengeId,code:"012345",statement:"lab-bat-v1",locale:"fr"},binding.sourceSession]]);
 }finally{await f.broker.close();}
});
test("J08 M2-05 refusal is explicit and terminal",async()=>{
 const f=await mutationFixture();try{await f.show();await f.result(await f.call(refuse),"refused");await f.deny(await f.call(issue));assert.equal(f.calls.length,1);}finally{await f.broker.close();}
});
test("J08 M2-06 revoked in-flight session suppresses acknowledgement; parallel denied",async()=>{
 let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
 const f=await mutationFixture(true,{sendOtp:async()=>{entered();await gate;return {status:"ok",value:{challengeId}};}});
 try{await f.show();const pending=f.call(issue);await started;await f.deny(await f.call(refuse));f.session.revoke();release();await f.deny(await pending);await f.deny(await f.call(confirm));}finally{release();await f.broker.close();}
});
test("J08 M2-07 unsuccessful preview does not unlock decisions",async()=>{
 const f=await mutationFixture(true,{},async()=>({status:"ok",value:{...current.value,status:"replaced"}}));
 try{await f.deny(await f.call({},"/bat/preview"));await f.deny(await f.call(issue));assert.equal(f.calls.length,0);}finally{await f.broker.close();}
});
test("J08 M2-08 missing decision preview port rejected at startup",async()=>{
 const fake:DecisionPort={sendOtp:async()=>({status:"unavailable"}),confirm:async()=>({status:"unavailable"}),refuse:async()=>({status:"unavailable"})};
 await assert.rejects(startBatStatusBroker({status:async()=>current},120000,undefined,fake),/LAB_DECISION_PREVIEW/);
});
