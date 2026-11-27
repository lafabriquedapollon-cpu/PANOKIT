import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import { createServerSupabaseClaimsVerifier } from "./j04/server-supabase-claims-client";
import { PricingIdentityError } from "./j04/pricing-admin-identity-gate";

const url = "https://pk-sdk-lab.supabase.co";
const issuer = url + "/auth/v1";
const key = "sb_publishable_synthetic_public_key_only";
const sub = "4d4a21f2-047d-4c29-98f2-7e483e02a62d";
const sid = "b5a6f970-f294-4e07-882b-76055b7fc177";
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function signedFixture() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const jwk = publicKey.export({ format: "jwk" });
  const now = Math.floor(Date.now() / 1000);
  const header = b64({alg: "ES256",typ: "JWT",kid: "synthetic-es256-key"});
  const payload = b64({
    iss: issuer, aud: "authenticated",role: "authenticated",sub,
    session_id: sid,aal: "aal2",is_anonymous: false, iat: now - 30,
    exp: now + 600,
  });
  const body = header + "." + payload;
  const signature = sign("sha256", Buffer.from(body), {
    key: privateKey, dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  const jwt = body + "." + signature;

  const requests: string[] = [];
  const fetchJwks: typeof fetch = async (resource) => {
    const endpoint = String(resource);
    requests.push(endpoint);
    if (endpoint !== issuer + "/.well-known/jwks.json") {
      throw Error("Unexpected network request in isolated JWT fixture");
    }
    return new Response(JSON.stringify({
      keys: [{...jwk, kid: "synthetic-es256-key", use: "sig",
        key_ops: ["verify"],alg: "ES256"}],
    }), {status: 200, headers: {"content-type": "application/json"}});
  };
  return {jwt, requests, fetchJwks};
}

test("J04 SDK configuration fails closed before contacting any Supabase environment", () => {
  for (const config of [
    {url: "http://pk-sdk-lab.supabase.co", publishableKey: key},
    {url: "https://evil.example.com", publishableKey: key},
    {url, publishableKey: "sb_secret_not_allowed_123"},
    {url, publishableKey: "service_role"},
    {url, publishableKey: ""},
  ]) {
    assert.throws(() => createServerSupabaseClaimsVerifier(config),
      (error: unknown) => error instanceof PricingIdentityError &&
        error.code === "access_unavailable");
  }
});

test("J04 official Supabase JS getClaims verifies signed synthetic ES256 JWT through isolated JWKS", async () => {
  const {jwt, fetchJwks, requests} = signedFixture();
  const verifier = createServerSupabaseClaimsVerifier({
    url, publishableKey: key, fetch: fetchJwks,
  });
  const claims = await verifier.verifyAccessToken(jwt);
  assert.equal(claims?.iss, issuer);
  assert.equal(claims?.sub, sub);
  assert.equal(claims?.session_id, sid);
  assert.equal(claims?.aal, "aal2");
  assert.ok(requests.length > 0, "SDK must retrieve the isolated public JWKS");
  assert.ok(requests.every((request) => request.endsWith("/.well-known/jwks.json")));
});

test("J04 official SDK rejects a tampered signed JWT without using a custom verifier", async () => {
  const {jwt, fetchJwks} = signedFixture();
  const verifier = createServerSupabaseClaimsVerifier({
    url, publishableKey: key, fetch: fetchJwks,
  });
  const [header,, signature] = jwt.split(".");
  const tampered = header + "." + b64({
    iss: issuer, aud: "authenticated",role: "authenticated",sub,
    session_id: sid,aal:"aal2",is_anonymous:false,
    iat: Math.floor(Date.now() / 1000) - 30, exp: Math.floor(Date.now() / 1000)+600,
    app_metadata: {role: "superuser"},
  }) + "." + signature;
  assert.equal(await verifier.verifyAccessToken(tampered), null);
});
