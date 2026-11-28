import {test} from "node:test";
import assert from "node:assert/strict";
import {createBatDecisionSession} from "./j08/bat-decision-session-lab";
import type {createBatLabAdapter} from "./j08/bat-pg-lab";
type Adapter=Pick<ReturnType<typeof createBatLabAdapter>,"sendOtp"|"confirm"|"refuse">;
const binding={caseId:"11111111-1111-4111-8111-111111111111",version:1,linkToken:"b".repeat(64),sourceSession:"a".repeat(64),expectedDigest:"d".repeat(64)};
const challengeId="22222222-2222-4222-8222-222222222222";
const unavailable={status:"unavailable"};
const issue={action:"request-otp"};
const confirm={action:"confirm",explicit:true,locale:"fr",code:"012345"};
const refuse={action:"refuse",explicit:true,locale:"ar"};
function fixture(overrides:Partial<Adapter>={}){
 let live=true;const calls:unknown[][]=[];
 const adapter:Adapter={
  sendOtp:async(...args)=>{calls.push(["issue",...args]);return {status:"ok",value:{challengeId}};},
  confirm:async(...args)=>{calls.push(["confirm",...args]);return {status:"ok",value:"approved"};},
  refuse:async(...args)=>{calls.push(["refuse",...args]);return {status:"ok",value:true};},
  ...overrides
 };
 const s=createBatDecisionSession(adapter,binding,()=>live);
 return {s,calls,preview:()=>s.markPreview(binding.expectedDigest),revoke:()=>{live=false;}};
}
const context={caseId:binding.caseId,version:1,linkToken:binding.linkToken,digest:binding.expectedDigest};
const projection=(result:string)=>({status:"ok",value:{scope:"LAB",manufacturable:false,version:1,result}});
test("M01 denies until trusted preview and current session",async()=>{
 const f=fixture();assert.deepEqual(await f.s.execute(issue),unavailable);
 f.s.markPreview("e".repeat(64));assert.deepEqual(await f.s.execute(issue),unavailable);
 f.preview();f.revoke();assert.deepEqual(await f.s.execute(issue),unavailable);assert.equal(f.calls.length,0);
});
test("M02 exact input: caller cannot supply identity, digest or challenge",async()=>{
 const f=fixture();f.preview();
 for(const v of [null,[],{}, {...issue,caseId:binding.caseId},{...issue,digest:binding.expectedDigest},{...issue,sourceSession:binding.sourceSession}, {...confirm,challengeId},{...confirm,code:"12345"},{...refuse,explicit:false},{...refuse,locale:"en"},{...refuse,manufacturable:true}]){
  assert.deepEqual(await f.s.execute(v),unavailable);
 }
 assert.equal(f.calls.length,0);
});
test("M03 server-bound challenge and consent; no capability in output",async()=>{
 const f=fixture();f.preview();
 assert.deepEqual(await f.s.execute(confirm),unavailable);
 assert.deepEqual(await f.s.execute(issue),projection("otp-sent"));
 assert.deepEqual(await f.s.execute(issue),unavailable);
 assert.deepEqual(await f.s.execute(confirm),projection("approved"));
 assert.deepEqual(await f.s.execute(confirm),unavailable);assert.deepEqual(await f.s.execute(refuse),unavailable);
 assert.deepEqual(f.calls,[["issue",context,binding.sourceSession],["confirm",{...context,challengeId,code:"012345",statement:"lab-bat-v1",locale:"fr"},binding.sourceSession]]);
});
test("M04 wrong code remains retryable, lock is terminal",async()=>{
 let n=0;const f=fixture({confirm:async()=>({status:"ok",value:++n===1?"wrong":"locked"})});f.preview();
 await f.s.execute(issue);assert.deepEqual(await f.s.execute(confirm),projection("wrong"));
 assert.deepEqual(await f.s.execute(confirm),projection("locked"));assert.deepEqual(await f.s.execute(confirm),unavailable);assert.equal(n,2);
});
test("M05 explicit refusal is version-bound and terminal",async()=>{
 const f=fixture();f.preview();assert.deepEqual(await f.s.execute(refuse),projection("refused"));
 assert.deepEqual(await f.s.execute(issue),unavailable);
 assert.deepEqual(f.calls,[["refuse",{...context,explicit:true,locale:"ar"},binding.sourceSession]]);
});
test("M06 in-flight concurrent action and revocation suppress result",async()=>{
 let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
 const f=fixture({sendOtp:async()=>{entered();await gate;return {status:"ok",value:{challengeId}};}});
 f.preview();const pending=f.s.execute(issue);await started;
 assert.deepEqual(await f.s.execute(refuse),unavailable);f.revoke();release();
 assert.deepEqual(await pending,unavailable);assert.deepEqual(await f.s.execute(confirm),unavailable);
});
test("M07 uncertain acknowledgement fails closed without replay",async()=>{
 let n=0;const f=fixture({sendOtp:async()=>{n++;throw Error("synthetic failure");}});f.preview();
 assert.deepEqual(await f.s.execute(issue),unavailable);assert.deepEqual(await f.s.execute(issue),unavailable);assert.equal(n,1);
});
test("M08 no cross-session challenge reuse",async()=>{
 const a=fixture(),b=fixture();a.preview();b.preview();await a.s.execute(issue);
 assert.deepEqual(await b.s.execute(confirm),unavailable);assert.equal(b.calls.length,0);
});
