import assert from "node:assert/strict";
import { test } from "node:test";
import { PILOT_MODEL, REQUIRED_EVIDENCE, parseIndustrialRevision, industrialDigest, readApprovedPilotFormat, type IndustrialRevision } from "./j03/industrial-admission";
function fixture(): IndustrialRevision {
  // Synthetic TEST_ONLY values; never imported into web or runtime.
  return {modelId:PILOT_MODEL,formatId:"test-only",revision:1,widthMm:101,heightMm:202,depthMm:30,labelFr:"TEST_ONLY",labelAr:"اختبار",evidence:REQUIRED_EVIDENCE.map((kind,i)=>({kind,privateRef:"fixture_evidence_"+i,sha256:String(i+1).repeat(64)}))};
}
const approval = (r: IndustrialRevision) => ({modelId:r.modelId,formatId:r.formatId,revision:r.revision,digest:industrialDigest(r),status:"approved"});
const read = (revision:unknown,approval:unknown) => readApprovedPilotFormat({readSnapshot:async()=>({revision,approval})});
test("J03-B empty repository is closed",async()=>assert.equal(await readApprovedPilotFormat({readSnapshot:async()=>null}),null));
test("J03-B repository fault fails closed",async()=>assert.equal(await readApprovedPilotFormat({readSnapshot:async()=>{throw Error("offline")}}),null));
test("J03-B unapproved draft is not public",async()=>assert.equal(await read(fixture(),null),null));
test("J03-B withdrawal blocks former approval",async()=>{const r=fixture();assert.equal(await read(r,{...approval(r),status:"withdrawn"}),null)});
test("J03-B approval cannot be supplied in revision payload",async()=>{const r=fixture();assert.equal(await read({...r,approval:approval(r)},approval(r)),null)});
test("J03-B approval bound to model format and revision",async()=>{const r=fixture(),a=approval(r);for(const p of [{modelId:"other"},{formatId:"other"},{revision:2}])assert.equal(await read(r,{...a,...p}),null)});
test("J03-B modification after approval invalidates digest",async()=>{const r=fixture(),a=approval(r);assert.equal(await read({...r,widthMm:102},a),null);assert.equal(await read({...r,evidence:r.evidence.map((e,i)=>i===0?{...e,sha256:"f".repeat(64)}:e)},a),null)});
test("J03-B complete evidence required; duplicate and unknown refused",()=>{const r=fixture();assert.equal(parseIndustrialRevision({...r,evidence:r.evidence.slice(1)}),null);assert.equal(parseIndustrialRevision({...r,evidence:[r.evidence[0],...r.evidence.slice(0,7)]}),null);assert.equal(parseIndustrialRevision({...r,evidence:[{...r.evidence[0],kind:"unknown"},...r.evidence.slice(1)]}),null)});
test("J03-B private evidence refs and hashes validated",()=>{const r=fixture();for(const patch of [{privateRef:"https://example.invalid/private"},{sha256:"nope"},{extra:"no"}])assert.equal(parseIndustrialRevision({...r,evidence:[{...r.evidence[0],...patch},...r.evidence.slice(1)]}),null)});
test("J03-B invalid dimensions/revision and locale labels refused",()=>{const r=fixture();for(const p of [{widthMm:0},{heightMm:-1},{depthMm:1.5},{widthMm:Infinity},{revision:NaN},{labelFr:" "},{labelAr:"fr"},{labelAr:"اختبار\u202e"},{formatId:"../../test"}])assert.equal(parseIndustrialRevision({...r,...p}),null)});
test("J03-B evidence order canonicalized",()=>{const r=fixture();assert.equal(industrialDigest(r),industrialDigest({...r,evidence:[...r.evidence].reverse()}))});
test("J03-B public projection allowlist and never orderable",async()=>{const r=fixture(),p=await read(r,approval(r));assert.deepEqual(p,{id:"test-only",revision:1,widthMm:101,heightMm:202,depthMm:30,labelFr:"TEST_ONLY",labelAr:"اختبار",orderable:false});assert.ok(Object.isFrozen(p));assert.ok(!JSON.stringify(p).includes("fixture_evidence"));});
