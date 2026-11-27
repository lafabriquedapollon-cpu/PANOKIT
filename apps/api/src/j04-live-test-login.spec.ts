import assert from "node:assert/strict";
import {test} from "node:test";
import type {SupabaseTokenVerifier,VerifiedSupabaseClaims} from "./j04/pricing-admin-identity-gate";
import type {SupabaseFreshUserReader} from "./j04/live-session-readonly";
import {runJ04TestLoginLogout,type J04TestPasswordAuthPort} from "./j04/live-test-login-flow";

const issuer = "https://panokit-recovery-fixture.supabase.co/auth/v1";
const token = "header.payload.signature";
const uid = "3cac9292-41ad-42b4-95cb-2262ace437d2";
const claims: VerifiedSupabaseClaims = {
  iss:issuer,sub:uid,session_id:"4db18455-ed23-4f10-b7f2-f038f3c7120d",
  aud:"authenticated",role:"authenticated",aal:"aal2",is_anonymous:false,
  exp:Math.floor(Date.now()/1000)+300,iat:Math.floor(Date.now()/1000)-30,
};
const creds={email:"synthetic-user@example.invalid",password:"synthetic-only-password"};
function fixture(opts:{wrongUser?:boolean;signInError?:boolean;signOutError?:boolean;refreshCreatesSession?:boolean}={}) {
  const calls:string[]=[];
  const port:J04TestPasswordAuthPort={
    async signInWithPassword(c){calls.push("login");assert.deepEqual(c,creds);
      return opts.signInError ? {data:null,error:"denied"} :
        {data:{session:{access_token:token,refresh_token:"synthetic-refresh-only"}},error:null};},
    async signOut(o){calls.push("signout");assert.deepEqual(o,{scope:"local"});
      return {error:opts.signOutError?"failed":null};},
    async refreshSession(arg){calls.push("refresh");
      assert.deepEqual(arg,{refresh_token:"synthetic-refresh-only"});
      return opts.refreshCreatesSession ? {data:{session:{access_token:"new"}},error:null} :
        {data:{session:null},error:"invalid-refresh-token"};},
  };
  const verifier:SupabaseTokenVerifier={async verifyAccessToken(){return claims;}};
  const userReader:SupabaseFreshUserReader={async getUser(){return {
    data:{user:{id:opts.wrongUser?"a6cb324e-a56b-4c04-8cbc-008e90f34baa":uid}},error:null,
  };}};
  return {calls,port,verifier,userReader};
}
test("J04 test-login: Auth recognized, signed out, refresh denied, never pricing authorized",async()=>{
  const f=fixture();const o=await runJ04TestLoginLogout(creds,issuer,f.port,f.verifier,f.userReader);
  assert.deepEqual(o,{login:"pass",identity:"recognized_not_authorized",
    localSignout:"acknowledged",refreshAttempt:"no_session_returned",pricingAuthorized:false});
  assert.deepEqual(f.calls,["login","signout","refresh"]);
});
test("J04 test-login: rejected user still triggers logout, never attempts refresh",async()=>{
  const f=fixture({wrongUser:true});const o=await runJ04TestLoginLogout(creds,issuer,f.port,f.verifier,f.userReader);
  assert.equal(o.identity,"rejected");assert.equal(o.localSignout,"acknowledged");
  assert.deepEqual(f.calls,["login","signout"]);
});
test("J04 test-login: sign-in failure creates no session, no signout",async()=>{
  const f=fixture({signInError:true});const o=await runJ04TestLoginLogout(creds,issuer,f.port,f.verifier,f.userReader);
  assert.equal(o.login,"fail");assert.equal(o.localSignout,"not_run");assert.deepEqual(f.calls,["login"]);
});
test("J04 test-login: logout failure never claims refresh revocation",async()=>{
  const f=fixture({signOutError:true});const o=await runJ04TestLoginLogout(creds,issuer,f.port,f.verifier,f.userReader);
  assert.equal(o.localSignout,"failed");assert.equal(o.refreshAttempt,"not_run");
  assert.deepEqual(f.calls,["login","signout"]);
});
test("J04 test-login: successful refresh triggers cleanup, fails closed",async()=>{
  const f=fixture({refreshCreatesSession:true});const o=await runJ04TestLoginLogout(creds,issuer,f.port,f.verifier,f.userReader);
  assert.equal(o.refreshAttempt,"session_returned");assert.equal(o.pricingAuthorized,false);
  assert.deepEqual(f.calls,["login","signout","refresh","signout"]);
});
test("J04 test-login: no network when project identity or credentials invalid",async()=>{
  const f=fixture();for(const [c,host] of [
    [creds,"https://wrong.supabase.co/auth/v1"],
    [{email:"",password:""},issuer],
  ] as Array<[typeof creds,string]>) {
    const o=await runJ04TestLoginLogout(c,host,f.port,f.verifier,f.userReader);
    assert.equal(o.login,"fail");
  }
  assert.deepEqual(f.calls,[]);
});
