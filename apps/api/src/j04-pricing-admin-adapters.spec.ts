import assert from "node:assert/strict";
import { test } from "node:test";
import { PricingAdminIdentityGate, PricingIdentityError } from "./j04/pricing-admin-identity-gate";
import { SupabaseSdkClaimsVerifier, type VerifiedClaimsSdk } from "./j04/supabase-claims-verifier";
import {
  PostgresPricingAccessReader, J04_CURRENT_ACCESS_SQL,
  type PgReadPort,
} from "./j04/pricing-admin-access-reader";

const issuer = "https://panokit-recovery-fixture.supabase.co/auth/v1";
const user = "c3f2036c-cace-4f0a-a0fe-45ee148e3bca";
const session = "4a277ba6-d999-4616-a6de-22fc28e2b1e9";
const time = 1_800_000_000;
const fakeJwt = "header.payload.signature";

function mockSdk(claims: unknown, error: unknown = null): VerifiedClaimsSdk {
  return {async getClaims(jwt) {
    assert.equal(jwt, fakeJwt);
    return {data: claims===null?null:{claims},error};
  }};
}
function claims(patch: Record<string, unknown> = {}) {
  return {
    iss: issuer, aud:"authenticated",role:"authenticated",sub:user,
    session_id:session, exp:time+300,iat:time-30,is_anonymous:false,aal:"aal2",
    ...patch,
  };
}
function makePort(
  patch: Record<string,unknown> = {}, throwQuery=false,
): PgReadPort {
  return {async query(sql, params) {
    assert.equal(sql,J04_CURRENT_ACCESS_SQL);
    assert.deepEqual(params,[user,session]);
    assert.ok(sql.includes("auth.users"));
    assert.ok(sql.includes("auth.sessions"));
    assert.ok(sql.includes("panokit_private.pricing_admin_acl"));
    assert.ok(sql.includes("$1::uuid")&&sql.includes("$2::uuid"));
    assert.ok(!sql.includes(user));
    if(throwQuery)throw Error("postgres://internal-host-secret");
    return {rows:[{
      user_id:user,session_id:session,user_active:true,session_active:true,
      session_aal:"aal2",can_view:true,can_edit:true,...patch,
    }]};
  }};
}
async function fails(code: PricingIdentityError["code"], fn:()=>Promise<unknown>) {
  await assert.rejects(fn(), e=>e instanceof PricingIdentityError&&e.code===code);
}
test("J04 official getClaims adapter accepts only structurally verified SDK responses",async()=>{
  const verifier = new SupabaseSdkClaimsVerifier(mockSdk(claims()));
  assert.equal((await verifier.verifyAccessToken(fakeJwt))?.sub,user);
  assert.equal(await verifier.verifyAccessToken("bad-token"),null);
  assert.equal(await new SupabaseSdkClaimsVerifier(mockSdk(claims(),"bad-signature")).verifyAccessToken(fakeJwt),null);
  assert.equal(await new SupabaseSdkClaimsVerifier(mockSdk(null)).verifyAccessToken(fakeJwt),null);
  assert.equal(await new SupabaseSdkClaimsVerifier(mockSdk({sub:user})).verifyAccessToken(fakeJwt),null);
  assert.equal(await new SupabaseSdkClaimsVerifier({
    async getClaims(){throw Error("sensitive signing-key material");},
  }).verifyAccessToken(fakeJwt),null);
});
test("J04 session SQL reader binds UUIDs and enforces exact permissions",async()=>{
  const reader=new PostgresPricingAccessReader(makePort());
  const access=await reader.readAccess(user,session);
  assert.deepEqual(access,{
    userId:user,sessionId:session,userActive:true,sessionActive:true,
    sessionAal:"aal2",permissions:["pricing:view","pricing:edit"],
  });
});
test("J04 never accepts unknown row shape, arbitrary session or duplicate results",async()=>{
  assert.equal(await new PostgresPricingAccessReader(makePort()).readAccess("bad",session),null);
  const malformed:PgReadPort={async query(){return {rows:[{user_id:user}]};}};
  await assert.rejects(()=>new PostgresPricingAccessReader(malformed).readAccess(user,session));
  const dup:PgReadPort={async query(){return {rows:[{},{}]};}};
  await assert.rejects(()=>new PostgresPricingAccessReader(dup).readAccess(user,session));
});
test("J04 real adapter boundary works end-to-end with injectable SDK and DB ports",async()=>{
  const gate=new PricingAdminIdentityGate(
    issuer,
    new SupabaseSdkClaimsVerifier(mockSdk(claims())),
    new PostgresPricingAccessReader(makePort()),
    ()=>time,
  );
  assert.deepEqual(await gate.requireEditor("Bearer "+fakeJwt,"pricing:edit"),{
    actorId:user,permissions:["pricing:edit"],
  });
});
test("J04 fresh session AAL downgrade denies write even for signed AAL2 JWT",async()=>{
  const gate=new PricingAdminIdentityGate(
    issuer,new SupabaseSdkClaimsVerifier(mockSdk(claims())),
    new PostgresPricingAccessReader(makePort({session_aal:"aal1"})),()=>time,
  );
  await fails("mfa_required",()=>gate.requireEditor("Bearer "+fakeJwt,"pricing:edit"));
  assert.equal((await gate.requireEditor("Bearer "+fakeJwt,"pricing:view")).actorId,user);
});
test("J04 revocation and permissions cannot be bypassed with forged app_metadata",async()=>{
  const gate=new PricingAdminIdentityGate(
    issuer,new SupabaseSdkClaimsVerifier(mockSdk(claims({
      app_metadata:{pricing_admin:true,role:"superuser"},
      user_metadata:{is_admin:true},
    }))),
    new PostgresPricingAccessReader(makePort({can_edit:false})),()=>time,
  );
  await fails("permission_denied",()=>gate.requireEditor("Bearer "+fakeJwt,"pricing:edit"));
});
test("J04 DB failures never fall back to claims roles or leak secrets",async()=>{
  const gate=new PricingAdminIdentityGate(
    issuer,new SupabaseSdkClaimsVerifier(mockSdk(claims({
      app_metadata:{role:"admin"},
    }))),
    new PostgresPricingAccessReader(makePort({},true)),()=>time,
  );
  await fails("access_unavailable",()=>gate.requireEditor("Bearer "+fakeJwt,"pricing:edit"));
});
test("J04 revoked session and disabled user fail closed on fresh read",async()=>{
  for(const patch of [{session_active:false},{user_active:false}]){
    const gate=new PricingAdminIdentityGate(
      issuer,new SupabaseSdkClaimsVerifier(mockSdk(claims())),
      new PostgresPricingAccessReader(makePort(patch)),()=>time,
    );
    await fails("permission_denied",()=>gate.requireEditor("Bearer "+fakeJwt,"pricing:edit"));
  }
});
