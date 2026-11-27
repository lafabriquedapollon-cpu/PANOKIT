import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PricingAdminIdentityGate, PricingIdentityError,
  type CurrentAccessReader, type CurrentPricingAccess,
  type SupabaseTokenVerifier, type VerifiedSupabaseClaims,
} from "./j04/pricing-admin-identity-gate";

const issuer = "https://panokit-recovery-fixture.supabase.co/auth/v1";
const userId = "c3f2036c-cace-4f0a-a0fe-45ee148e3bca";
const sessionId = "4a277ba6-d999-4616-a6de-22fc28e2b1e9";
const now = 1_800_000_000;
const bearer = "Bearer header.payload.signature";
const validClaims: VerifiedSupabaseClaims = {
  iss: issuer, aud: "authenticated", role: "authenticated",
  sub: userId, session_id: sessionId, exp: now + 900,
  iat: now - 60, is_anonymous: false, aal: "aal2",
};
type Fixture = {
  claims?: VerifiedSupabaseClaims | null;
  permissions?: readonly string[];
  sessionActive?: boolean;
  userActive?: boolean;
  throwVerification?: boolean;
  throwAccess?: boolean;
  sessionAal?: string;
};
function fixture(f: Fixture = {}) {
  let verifyCalls = 0, accessCalls = 0;
  const verifier: SupabaseTokenVerifier = {
    async verifyAccessToken(token) {
      verifyCalls++;
      assert.equal(token, "header.payload.signature");
      if (f.throwVerification) throw Error("secret verifier endpoint");
      return f.claims === undefined ? { ...validClaims } : f.claims;
    },
  };
  const accessReader: CurrentAccessReader = {
    async readAccess(uid, sid): Promise<CurrentPricingAccess> {
      accessCalls++;
      if (f.throwAccess) throw Error("postgres://secret-db-host");
      assert.equal(uid, userId);
      assert.equal(sid, sessionId);
      return {
        userId: uid, sessionId: sid, userActive: f.userActive ?? true,
        sessionActive: f.sessionActive ?? true,
        sessionAal: f.sessionAal ?? "aal2",
        permissions: f.permissions ?? ["pricing:view", "pricing:edit"],
      };
    },
  };
  const gate = new PricingAdminIdentityGate(issuer, verifier, accessReader, () => now);
  return { gate, counts: () => ({verifyCalls, accessCalls}) };
}
async function fails(
  code: PricingIdentityError["code"],
  action: () => Promise<unknown>,
) {
  await assert.rejects(action(), (error: unknown) =>
    error instanceof PricingIdentityError && error.code === code &&
    !error.message.includes("secret"));
}
test("J04 denies absent, duplicate, malformed and oversized Bearer headers before verification", async () => {
  const f = fixture();
  await fails("missing_credentials", () => f.gate.requireEditor(undefined, "pricing:edit"));
  await fails("missing_credentials", () => f.gate.requireEditor([bearer,bearer], "pricing:edit"));
  await fails("missing_credentials", () => f.gate.requireEditor("x".repeat(8193), "pricing:edit"));
  for (const header of ["Basic abc", "Bearer abc", "Bearer a.b", "Bearer a.b.c extra", "Bearer a.b.c, Bearer x.y.z"]) {
    await fails("invalid_token", () => f.gate.requireEditor(header, "pricing:view"));
  }
  assert.deepEqual(f.counts(), {verifyCalls:0, accessCalls:0});
});

test("J04 permits edit only with verified identity, active session and DB permission plus aal2", async () => {
  const f = fixture();
  assert.deepEqual(await f.gate.requireEditor(bearer, "pricing:edit"), {
    actorId: userId, permissions:["pricing:edit"],
  });
  assert.deepEqual(f.counts(), {verifyCalls:1, accessCalls:1});
});

test("J04 never grants permissions from user_metadata or app_metadata JWT claims", async () => {
  const claims: VerifiedSupabaseClaims = {
    ...validClaims,
    user_metadata:{pricing_admin:true,role:"owner"},
    app_metadata:{pricing_admin:true,roles:["pricing:edit"]},
  };
  const f = fixture({claims,permissions:["pricing:view"]});
  await fails("permission_denied", () => f.gate.requireEditor(bearer,"pricing:edit"));
  assert.deepEqual(f.counts(), {verifyCalls:1, accessCalls:1});
});

test("J04 rejects revocation, disabled users and mismatched session in live permission source", async () => {
  await fails("permission_denied", () => fixture({sessionActive:false}).gate.requireEditor(bearer,"pricing:edit"));
  await fails("permission_denied", () => fixture({userActive:false}).gate.requireEditor(bearer,"pricing:edit"));
  await fails("permission_denied", () => fixture({permissions:[]}).gate.requireEditor(bearer,"pricing:edit"));
});

test("J04 enforces MFA aal2 for writing prices; valid aal1 may only view", async () => {
  const f = fixture({claims:{...validClaims,aal:"aal1"}});
  await fails("mfa_required", () => f.gate.requireEditor(bearer,"pricing:edit"));
  assert.deepEqual(await f.gate.requireEditor(bearer,"pricing:view"),{
    actorId:userId,permissions:["pricing:view"],
  });
});

test("J04 does not accept stale JWT AAL2 when current session is AAL1", async () => {
  const f = fixture({sessionAal:"aal1"});
  await fails("mfa_required",()=>f.gate.requireEditor(bearer,"pricing:edit"));
  assert.deepEqual(await f.gate.requireEditor(bearer,"pricing:view"),{
    actorId:userId,permissions:["pricing:view"],
  });
});

test("J04 rejects expired, not-yet-valid and impossible issued JWT claims", async () => {
  for(const patch of [
    {exp: now-1}, {iat: now+1000}, {nbf:now+1000},
    {exp: now-10,iat: now-20},
    {iat:now+90,exp:now+120},
  ]) {
    const f=fixture({claims:{...validClaims,...patch}});
    await fails("invalid_token",()=>f.gate.requireEditor(bearer,"pricing:edit"));
    assert.deepEqual(f.counts(),{verifyCalls:1,accessCalls:0});
  }
});

test("J04 binds identity to one trusted Supabase issuer, audience, role and session", async () => {
  for(const patch of [
    {iss:"https://wrong-project.supabase.co/auth/v1"},
    {aud:"service_role"},{role:"service_role"},
    {session_id:"not-a-uuid"},{sub:"invalid"},
    {is_anonymous:true},
  ]) {
    const f=fixture({claims:{...validClaims,...patch}});
    await fails("invalid_token",()=>f.gate.requireEditor(bearer,"pricing:view"));
    assert.equal(f.counts().accessCalls,0);
  }
});

test("J04 refuses verification failures and unknown/unsigned JWTs, without exposing providers", async () => {
  await fails("invalid_token",()=>fixture({throwVerification:true}).gate.requireEditor(bearer,"pricing:edit"));
  await fails("invalid_token",()=>fixture({claims:null}).gate.requireEditor(bearer,"pricing:edit"));
});

test("J04 DB failure is fail-closed rather than using stale JWT roles", async () => {
  const f=fixture({throwAccess:true,claims:{...validClaims,app_metadata:{role:"admin"}}});
  await fails("access_unavailable",()=>f.gate.requireEditor(bearer,"pricing:edit"));
});

test("J04 rejects unsafe issuer configuration and unknown permissions at construction/use", async () => {
  assert.throws(() => new PricingAdminIdentityGate(
    "https://evil.invalid/auth/v1",
    {verifyAccessToken:async()=>validClaims},
    {readAccess:async()=>null},
  ), (err:unknown)=>err instanceof PricingIdentityError&&err.code==="access_unavailable");
  const f=fixture();
  await fails("permission_denied",()=>f.gate.requireEditor(bearer,"pricing:delete" as "pricing:edit"));
  assert.deepEqual(f.counts(),{verifyCalls:0,accessCalls:0});
});
