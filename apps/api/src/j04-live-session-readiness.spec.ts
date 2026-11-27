import assert from "node:assert/strict";
import {test} from "node:test";
import type {SupabaseTokenVerifier,VerifiedSupabaseClaims} from "./j04/pricing-admin-identity-gate";
import type {SupabaseFreshUserReader} from "./j04/live-session-readonly";
import {verifyReadOnlyAuthServiceRecognition as recognize} from "./j04/live-session-readonly";

const issuer = "https://pk-live-lab.supabase.co/auth/v1";
const sub = "3cac9292-41ad-42b4-95cb-2262ace437d2";
const sid = "4db18455-ed23-4f10-b7f2-f038f3c7120d";
const now = 1800000000;
const jwt = "header.payload.signature";
const payload: VerifiedSupabaseClaims = {
  iss: issuer, sub, session_id: sid, aud: "authenticated", role: "authenticated",
  aal: "aal2", is_anonymous: false, exp: now+300, iat:now-30,
};
function ports(patch: Partial<VerifiedSupabaseClaims> = {}, userId = sub) {
  const verifier: SupabaseTokenVerifier = {
    async verifyAccessToken(token) {assert.equal(token,jwt); return {...payload,...patch};},
  };
  const userReader: SupabaseFreshUserReader = {
    async getUser(token) {assert.equal(token,jwt);return {data: {user: {id:userId}},error:null};},
  };
  return {verifier,userReader};
}
test("J04 live-probe structurally recognizes same user without claiming admin authorization",async()=>{
  const {verifier,userReader}=ports();
  assert.equal(await recognize(jwt,issuer,verifier,userReader,now),
    "auth_service_recognized_not_authorized");
});
test("J04 live-probe rejects wrong user, issuer, stale token, absent session and AAL",async()=>{
  for (const [patch,userId] of [
    [{}, "1aaa9292-41ad-42b4-95cb-2262ace437d2"],
    [{iss:"https://foreign.supabase.co/auth/v1"},sub],
    [{exp:now-1},sub],
    [{session_id:"invalid"},sub],
    [{aal:"aal0"},sub],
    [{is_anonymous:true},sub],
    [{role:"service_role"},sub],
    [{iat:now+500},sub],
  ] as Array<[Partial<VerifiedSupabaseClaims>,string]>) {
    const {verifier,userReader}=ports(patch,userId);
    assert.equal(await recognize(jwt,issuer,verifier,userReader,now),"rejected");
  }
});
test("J04 live-probe fails closed on remote Auth errors and malformed config",async()=>{
  const {verifier}=ports();
  const rejectedUser:SupabaseFreshUserReader={
    async getUser(){throw Error("secret-token-stack-info");},
  };
  assert.equal(await recognize(jwt,issuer,verifier,rejectedUser,now),"rejected");
  const user:SupabaseFreshUserReader={
    async getUser(){return {data:{user:null},error:"auth unavailable"};},
  };
  assert.equal(await recognize(jwt,issuer,verifier,user,now),"rejected");
  assert.equal(await recognize(jwt,"http://invalid",verifier,user,now),"rejected");
});
