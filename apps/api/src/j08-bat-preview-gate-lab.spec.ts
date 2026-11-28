import assert from "node:assert/strict";
import {test} from "node:test";
import {createHash} from "node:crypto";
import {deflateSync} from "node:zlib";
import {createBatPreviewGate} from "./j08/bat-preview-gate-lab";
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
