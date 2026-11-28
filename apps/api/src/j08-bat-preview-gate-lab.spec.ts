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
