import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPublicKey, generateKeyPairSync, sign, verify,
  type KeyObject,
} from "node:crypto";
import {
  PricingAdminIdentityGate, PricingIdentityError,
  type VerifiedSupabaseClaims, type CurrentAccessReader,
} from "./j04/pricing-admin-identity-gate";
import {
  SupabaseSdkClaimsVerifier,
  type VerifiedClaimsSdk,
} from "./j04/supabase-claims-verifier";

/**
 * Cryptographic ES256 rehearsal with ephemeral P-256 keys generated during
 * this test. This is NOT Supabase's SDK or a live PANOKIT JWT test.
 * The production verifier continues to delegate to official auth.getClaims.
 */
const issuer = "https://panokit-recovery-fixture.supabase.co/auth/v1";
const userId = "c3f2036c-cace-4f0a-a0fe-45ee148e3bca";
const sessionId = "4a277ba6-d999-4616-a6de-22fc28e2b1e9";
const now = 1_800_000_000;
const e = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
function keyPair(kid: string) {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = pair.publicKey.export({ format: "jwk" });
  assert.equal(jwk.kty, "EC");
  assert.equal(jwk.crv, "P-256");
  return {
    kid,
    privateKey: pair.privateKey,
    publicKey: createPublicKey({ key: { ...jwk, kid, alg: "ES256", use: "sig" }, format: "jwk" }),
  };
}
function payload(patch: Record<string, unknown> = {}): VerifiedSupabaseClaims {
  return {
    iss: issuer, aud: "authenticated", role: "authenticated", sub: userId,
    session_id: sessionId, exp: now + 3600, iat: now - 30,
    is_anonymous: false, aal: "aal2", ...patch,
  };
}
function makeJwt(
  claims: VerifiedSupabaseClaims, kid: string, privateKey: KeyObject,
  alg = "ES256",
): string {
  const message = e({ typ: "JWT", alg, kid }) + "." + e(claims);
  const signature = sign("sha256", Buffer.from(message), {
    key: privateKey, dsaEncoding: "ieee-p1363",
  });
  return message + "." + signature.toString("base64url");
}
type Key = ReturnType<typeof keyPair>;
function cryptographicTestSdk(keys: readonly Key[]): VerifiedClaimsSdk {
  const known = new Map(keys.map(k => [k.kid, k.publicKey]));
  return {
    async getClaims(token: string) {
      const parts = token.split(".");
      if (parts.length !== 3 || parts.some(p=>!p)) {
        return { data: null, error: "malformed" };
      }
      try {
        const header = JSON.parse(Buffer.from(parts[0], "base64url").toString()) as
          Record<string, unknown>;
        // Algorithm downgrade, unexpected kid, untrusted JWKS = fail closed.
        if (header.alg !== "ES256" || typeof header.kid !== "string" ||
          !known.has(header.kid)) return { data: null, error: "untrusted header" };
        const publicKey = known.get(header.kid);
        if (!publicKey || !verify("sha256", Buffer.from(parts[0]+"."+parts[1]), {
          key: publicKey, dsaEncoding: "ieee-p1363",
        }, Buffer.from(parts[2], "base64url")))
          return { data: null, error: "invalid signature" };
        return {
          data: { claims: JSON.parse(Buffer.from(parts[1], "base64url").toString()) },
          error: null,
        };
      } catch {
        return { data: null, error: "malformed" };
      }
    },
  };
}
const validAccess: CurrentAccessReader = {
  async readAccess(userIdActual, sessionIdActual) {
    return {
      userId: userIdActual, sessionId: sessionIdActual,
      sessionActive: true, userActive: true, sessionAal: "aal2",
      permissions: ["pricing:view", "pricing:edit"],
    };
  },
};
const gate = (sdk: VerifiedClaimsSdk, access = validAccess) =>
  new PricingAdminIdentityGate(
    issuer, new SupabaseSdkClaimsVerifier(sdk), access, ()=>now,
  );
async function fails(code: PricingIdentityError["code"], fn:()=>Promise<unknown>) {
  await assert.rejects(fn(), (err:unknown) =>
    err instanceof PricingIdentityError && err.code === code);
}

test("J04 crypto lab verifies real ES256 P-256 signatures before issuing edit rights", async()=>{
  const key=keyPair("lab-key-current");
  const sdk=cryptographicTestSdk([key]);
  const jwt=makeJwt(payload(),key.kid,key.privateKey);
  const claims=await new SupabaseSdkClaimsVerifier(sdk).verifyAccessToken(jwt);
  assert.equal(claims?.sub,userId);
  assert.deepEqual(await gate(sdk).requireEditor("Bearer "+jwt,"pricing:edit"),{
    actorId:userId, permissions:["pricing:edit"],
  });
});
test("J04 crypto lab rejects tampered payload even if metadata claims admin",async()=>{
  const key=keyPair("lab-key");
  const sdk=cryptographicTestSdk([key]);
  const jwt=makeJwt(payload(),key.kid,key.privateKey);
  const [head,,sig]=jwt.split(".");
  const forged=head+"."+e(payload({user_metadata:{role:"owner",is_admin:true}}))+"."+sig;
  await fails("invalid_token",()=>gate(sdk).requireEditor("Bearer "+forged,"pricing:edit"));
});
test("J04 crypto lab rejects alg=none, HS256 algorithm confusion and bad kid",async()=>{
  const key=keyPair("lab-key");
  const sdk=cryptographicTestSdk([key]);
  for (const alg of ["none","HS256"]) {
    const jwt=makeJwt(payload(),key.kid,key.privateKey,alg);
    await fails("invalid_token",()=>gate(sdk).requireEditor("Bearer "+jwt,"pricing:edit"));
  }
  const missingKid=makeJwt(payload(),"unknown-key",key.privateKey);
  await fails("invalid_token",()=>gate(sdk).requireEditor("Bearer "+missingKid,"pricing:edit"));
});
test("J04 crypto lab rejects token signed by attacker even with legitimate kid",async()=>{
  const trusted=keyPair("lab-key");
  const attacker=keyPair("lab-key");
  const jwt=makeJwt(payload(),trusted.kid,attacker.privateKey);
  await fails("invalid_token",()=>gate(cryptographicTestSdk([trusted]))
    .requireEditor("Bearer "+jwt,"pricing:edit"));
});
test("J04 crypto lab supports JWKS signing-key rotation without hardcoding one kid",async()=>{
  const old=keyPair("lab-old"),next=keyPair("lab-new");
  const during=cryptographicTestSdk([old,next]);
  const oldJwt=makeJwt(payload(),old.kid,old.privateKey);
  const nextJwt=makeJwt(payload(),next.kid,next.privateKey);
  assert.equal((await gate(during).requireEditor("Bearer "+oldJwt,"pricing:view")).actorId,userId);
  assert.equal((await gate(during).requireEditor("Bearer "+nextJwt,"pricing:view")).actorId,userId);
  const after=cryptographicTestSdk([next]);
  await fails("invalid_token",()=>gate(after).requireEditor("Bearer "+oldJwt,"pricing:view"));
  assert.equal((await gate(after).requireEditor("Bearer "+nextJwt,"pricing:view")).actorId,userId);
});
test("J04 crypto lab still denies expired, wrong issuer or AAL1 signed tokens",async()=>{
  const k=keyPair("lab-key");
  const sdk=cryptographicTestSdk([k]);
  for (const invalid of [
    payload({ exp: now-10 }),payload({ iss:"https://evil.supabase.co/auth/v1" }),
  ]) await fails("invalid_token",
    ()=>gate(sdk).requireEditor("Bearer "+makeJwt(invalid,k.kid,k.privateKey),"pricing:edit"));
  await fails("mfa_required",()=>gate(sdk).requireEditor(
    "Bearer "+makeJwt(payload({aal:"aal1"}),k.kid,k.privateKey),"pricing:edit",
  ));
});
test("J04 crypto lab signed JWT cannot override freshly revoked server permission",async()=>{
  const k=keyPair("lab-key"),sdk=cryptographicTestSdk([k]);
  const deny: CurrentAccessReader={
    async readAccess(userIdActual,sessionIdActual){
      return {
        userId:userIdActual,sessionId:sessionIdActual,
        sessionActive:true,userActive:true,sessionAal:"aal2",permissions:["pricing:view"],
      };
    },
  };
  const signed=makeJwt(payload({app_metadata:{role:"owner"}}),k.kid,k.privateKey);
  await fails("permission_denied",()=>gate(sdk,deny).requireEditor("Bearer "+signed,"pricing:edit"));
});
