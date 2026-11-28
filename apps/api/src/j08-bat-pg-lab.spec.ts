import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createBatLabAdapter} from "./j08/bat-pg-lab";
const caseId="11111111-1111-4111-8111-111111111111",challengeId="22222222-2222-4222-8222-222222222222";
const session="a".repeat(64),linkToken="b".repeat(64),version=1,bytes=Buffer.from("LAB fixture"),digest=createHash("sha256").update(bytes).digest("hex");
const input={caseId,version,linkToken},bind={caseId,version,digest};
const review={scope:"LAB",manufacturable:false,version,digest,bytesBase64:bytes.toString("base64")};
const hash=(v:string)=>createHash("sha256").update(v).digest("hex");
function fixture(value:unknown,options:{badRole?:boolean;badDb?:boolean;commitLost?:boolean;sqlError?:boolean;deliveryError?:boolean}={}){
 const calls:{sql:string;args?:unknown[]}[]=[],delivered:unknown[]=[];let closed=0;
 const connect=(role:string)=>async()=>({query:async(sql:string,args?:unknown[])=>{
  calls.push({sql,args});
  if(sql.startsWith("select session_user"))return {rows:[{login:options.badRole?"wrong":role,role,db:options.badDb?"wrong":"panokit_j03_industrial_lab"}]};
  if(sql.startsWith("select j08_private.")){if(options.sqlError)throw Error("sensitive");return {rows:[{value}]};}
  if(sql==="commit"&&options.commitLost)throw Error("lost acknowledgement");
  return {rows:[]};
 },close:async()=>{closed++;}});
 const api=createBatLabAdapter({issuer:connect("j08_issuer"),client:connect("j08_client"),sender:connect("j08_otp_sender"),fakeDelivery:async m=>{assert.equal(calls.at(-1)?.sql,"commit");delivered.push(m);if(options.deliveryError)throw Error("fake delivery");}});
 return {api,calls,delivered,closed:()=>closed};
}
test("J08 T01 rejects extra keys and accessor before database",async()=>{const f=fixture(review);assert.deepEqual(await f.api.review({...input,session},session),{status:"unavailable"});assert.deepEqual(await f.api.review({...input,get linkToken(){throw Error("getter");}},session),{status:"unavailable"});assert.equal(f.calls.length,0);});
test("J08 T02 role and database isolation",async()=>{for(const o of [{badRole:true},{badDb:true}]){const f=fixture(review,o);assert.deepEqual(await f.api.review(input,session),{status:"unavailable"});assert.equal(f.calls.length,1);assert.equal(f.closed(),1);}});
test("J08 T03 exact review and hashes only in parameters",async()=>{const f=fixture(review);assert.deepEqual(await f.api.review(input,session),{status:"ok",value:review});assert.deepEqual(f.calls[2].args,[caseId,version,hash(session),hash(linkToken)]);assert.equal(f.calls.at(-1)?.sql,"commit");});
test("J08 T04 rejects corrupt bytes or positive manufacture",async()=>{for(const r of [{...review,bytesBase64:"YQ=="},{...review,manufacturable:true},{...review,secret:session}]){const f=fixture(r);assert.deepEqual(await f.api.review(input,session),{status:"unavailable"});assert.equal(f.calls.at(-1)?.sql,"rollback");}});
test("J08 T05 generic denial on SQL failure",async()=>{const f=fixture(review,{sqlError:true});assert.deepEqual(await f.api.review(input,session),{status:"unavailable"});assert.equal(f.closed(),1);assert.equal(f.calls.at(-1)?.sql,"rollback");});
test("J08 T06 link generated, hashed and returned only after commit",async()=>{const f=fixture(true);const r=await f.api.rotate(bind,session);assert.equal(r.status,"ok");if(r.status==="ok"){assert.match(r.value.linkToken,/^[a-f0-9]{64}$/);assert.deepEqual(f.calls[2].args,[caseId,version,digest,hash(session),hash(r.value.linkToken)]);}assert.equal(f.calls.at(-1)?.sql,"commit");});
test("J08 T07 ambiguous link commit does not expose capability or retry",async()=>{const f=fixture(true,{commitLost:true});assert.deepEqual(await f.api.rotate(bind,session),{status:"unavailable"});assert.equal(f.calls.filter(x=>x.sql.includes("rotate_link")).length,1);});
test("J08 T08 fake OTP delivery after commit, no plaintext in result",async()=>{const f=fixture(challengeId);assert.deepEqual(await f.api.sendOtp({...input,digest},session),{status:"ok",value:{challengeId}});assert.equal(f.delivered.length,1);const m=f.delivered[0] as {code:string};assert.match(m.code,/^[0-9]{6}$/);assert.equal(f.calls[2].args?.[5],m.code);});
test("J08 T09 ambiguous OTP commit never delivers or retries",async()=>{const f=fixture(challengeId,{commitLost:true});assert.deepEqual(await f.api.sendOtp({...input,digest},session),{status:"unavailable"});assert.equal(f.delivered.length,0);assert.equal(f.calls.filter(x=>x.sql.includes("issue_otp")).length,1);});
test("J08 T10 delivery failure is generic, no automatic resend",async()=>{const f=fixture(challengeId,{deliveryError:true});assert.deepEqual(await f.api.sendOtp({...input,digest},session),{status:"unavailable"});assert.equal(f.delivered.length,1);});
test("J08 T11 wrong and locked attempts commit, no rollback",async()=>{for(const value of ["wrong","locked","approved"]){const f=fixture(value);assert.deepEqual(await f.api.confirm({...input,digest,challengeId,code:"000000",statement:"lab-bat-v1",locale:"ar"},session),{status:"ok",value});assert.equal(f.calls.at(-1)?.sql,"commit");}});
test("J08 T12 ambiguous consent returns no success and never repeats",async()=>{const f=fixture("approved",{commitLost:true});assert.deepEqual(await f.api.confirm({...input,digest,challengeId,code:"000000",statement:"lab-bat-v1",locale:"fr"},session),{status:"unavailable"});assert.equal(f.calls.filter(x=>x.sql.includes("confirm_otp")).length,1);});
test("J08 T13 status projection only and explicit refusal",async()=>{const f=fixture({scope:"LAB",manufacturable:false,version,status:"approved"});assert.equal((await f.api.status(input,session)).status,"ok");assert.deepEqual(await f.api.refuse({...input,digest,explicit:false,locale:"fr"},session),{status:"unavailable"});const g=fixture(true);assert.deepEqual(await g.api.refuse({...input,digest,explicit:true,locale:"ar"},session),{status:"ok",value:true});});
