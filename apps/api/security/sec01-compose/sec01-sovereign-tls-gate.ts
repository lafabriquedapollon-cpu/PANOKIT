/**
 * RECOVERY R3 — reconstructed, not byte-identical to PR #34.
 * LAB only, not registered in AppModule. No actual Better Auth verifier yet.
 */
import { Body, Controller, ForbiddenException, Inject, Post, Req, Res } from "@nestjs/common";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export const SEC01_LAB_DEPS = Symbol("SEC01_LAB_DEPS");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX = /^[0-9a-f]{64}$/;
const OPAQUE = /^[A-Za-z0-9_-]{32,160}$/;
export type IssueContext = {proof: string; csrf: string; authCookie: string};
export type VerifiedProof = {subject: string; proofDigest: Uint8Array};
export type LabDeps = {
  origin: string;
  tokenKey: Uint8Array;
  // MUST authenticate a real fresh MFA ceremony and its session-bound
  // initial CSRF challenge. A mere Better Auth getSession is insufficient.
  verifyIssue(context: IssueContext): Promise<VerifiedProof>;
  issue(subject: string, proof: Uint8Array, id: string, digest: Uint8Array, expires: Date): Promise<void>;
  write(id: string, digest: Uint8Array, operation: string, revision: number, config: Record<string, unknown>): Promise<{revision: number; replayed: boolean}>;
  logout(id: string, digest: Uint8Array): Promise<void>;
};
function deny(): never { throw new ForbiddenException("SEC01 denied"); }
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exact(value: string, expected: string): boolean {
  return HEX.test(value) && HEX.test(expected) &&
    timingSafeEqual(Buffer.from(value, "hex"), Buffer.from(expected, "hex"));
}

@Controller("sec01-lab")
export class Sec01SovereignHttpGate {
  private readonly key: Buffer;
  private readonly cookieName = "pk_admin_lab";
  constructor(@Inject(SEC01_LAB_DEPS) private readonly deps: LabDeps) {
    const url = new URL(deps.origin);
    if (url.origin !== deps.origin || url.protocol !== "https:" ||
      url.hostname !== "127.0.0.1" || !url.port || deps.tokenKey.byteLength < 32)
      throw new Error("SEC01 loopback LAB configuration required");
    this.key = Buffer.from(deps.tokenKey);
  }
  private hmac(domain: string, value: string): Buffer {
    return createHmac("sha256", this.key).update(domain + ":" + value).digest();
  }
  private preflight(req: IncomingMessage, res: ServerResponse): string {
    res.setHeader("Cache-Control", "no-store");
    const protectedHeaders = new Set(["origin","content-type","cookie","x-sec01-csrf","sec-fetch-site"]);
    const seen = new Set<string>();
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i].toLowerCase();
      if (protectedHeaders.has(name)) {
        if (seen.has(name)) deny();
        seen.add(name);
      }
    }
    const contentType = req.headers["content-type"];
    if (req.headers.origin !== this.deps.origin ||
        typeof contentType !== "string" ||
        !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType) ||
        req.headers["sec-fetch-site"] === "cross-site") deny();
    const csrf = req.headers["x-sec01-csrf"];
    if (typeof csrf !== "string" || !OPAQUE.test(csrf)) deny();
    return csrf;
  }
  private credential(req: IncomingMessage, csrf: string): {id: string; digest: Buffer} {
    const raw = req.headers.cookie;
    if (typeof raw !== "string" || raw.length > 8192) deny();
    const matches = raw.split(";").map(v => v.trim()).filter(v => v.startsWith(this.cookieName + "="));
    if (matches.length !== 1) deny();
    const value = matches[0].slice(this.cookieName.length + 1);
    const parts = value.split(".");
    if (parts.length !== 2 || !HEX.test(parts[0]) || !UUID.test(parts[1])) deny();
    if (!exact(csrf, this.hmac("csrf", value).toString("hex"))) deny();
    return {id: parts[1], digest: this.hmac("session", value)};
  }
  @Post("issue")
  async issue(@Req() req: IncomingMessage, @Res({passthrough:true}) res: ServerResponse, @Body() body: unknown) {
    const csrf = this.preflight(req, res);
    if (!record(body) || typeof body.proof !== "string" || !OPAQUE.test(body.proof) ||
        typeof req.headers.cookie !== "string" || req.headers.cookie.length > 8192) deny();
    try {
      const proof = await this.deps.verifyIssue({proof: body.proof, csrf, authCookie: req.headers.cookie});
      if (typeof proof.subject !== "string" || proof.subject.length < 6 ||
          proof.subject.length > 150 || proof.proofDigest.byteLength !== 32) deny();
      const id = randomUUID();
      const value = randomBytes(32).toString("hex") + "." + id;
      await this.deps.issue(proof.subject, proof.proofDigest, id, this.hmac("session", value), new Date(Date.now()+240000));
      res.setHeader("Set-Cookie", this.cookieName + "=" + value + "; Path=/sec01-lab; Max-Age=240; HttpOnly; Secure; SameSite=Strict");
      return {ok: true, csrf: this.hmac("csrf", value).toString("hex")};
    } catch { deny(); }
  }
  @Post("write")
  async write(@Req() req: IncomingMessage, @Res({passthrough:true}) res: ServerResponse, @Body() body: unknown) {
    const csrf = this.preflight(req, res);
    const cred = this.credential(req, csrf);
    if (!record(body) || typeof body.operation !== "string" || !UUID.test(body.operation) ||
        typeof body.revision !== "number" || !Number.isInteger(body.revision) ||
        body.revision < 1 || body.revision >= 2147483647 || !record(body.config) ||
        Buffer.byteLength(JSON.stringify(body.config),"utf8") > 65536) deny();
    try { return await this.deps.write(cred.id, cred.digest, body.operation, body.revision, body.config); }
    catch { deny(); }
  }
  @Post("logout")
  async logout(@Req() req: IncomingMessage, @Res({passthrough:true}) res: ServerResponse) {
    const cred = this.credential(req, this.preflight(req, res));
    try {
      await this.deps.logout(cred.id, cred.digest);
      res.setHeader("Set-Cookie", this.cookieName + "=; Path=/sec01-lab; Max-Age=0; HttpOnly; Secure; SameSite=Strict");
      return {ok:true};
    } catch { deny(); }
  }
}
