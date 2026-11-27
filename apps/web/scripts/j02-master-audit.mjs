#!/usr/bin/env node
/**
 * J02 provenance audit. This script NEVER generates or modifies visual assets.
 * Report mode is nonblocking for absent originals; --require-approved is a
 * strict release gate requiring verified, independently provided SHA-256s.
 */
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const visualDir = resolve(scriptDir, "../public/visuals/accueil");
const manifestPath = resolve(scriptDir, "j02-approved-manifest.json");
const strict = process.argv.includes("--require-approved");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const expectedIds = ["ACC-HERO-01", "ACC-CAT-01", "ACC-CAT-02", "ACC-CAT-03", "ACC-CAT-04", "ACC-CAT-05", "ACC-CAT-06"];
if (!Array.isArray(manifest.assets) ||
    manifest.assets.length !== expectedIds.length ||
    expectedIds.some((id, i) => manifest.assets[i]?.id !== id || manifest.assets[i]?.filename !== `${id}.webp`)) {
  console.error("J02 asset manifest schema or order mismatch.");
  process.exit(1);
}
const results = [];
for (const item of manifest.assets) {
  const filePath = join(visualDir, item.filename);
  let state = "MISSING";
  let sha256 = null;
  let bytes = null;
  try {
    const data = await readFile(filePath);
    bytes = data.length;
    const riff = data.subarray(0, 4).toString("ascii") === "RIFF";
    const webp = data.subarray(8, 12).toString("ascii") === "WEBP";
    const chunk = data.subarray(12, 16).toString("ascii");
    const validChunk = ["VP8 ", "VP8L", "VP8X"].includes(chunk);
    const riffSize = data.length >= 8 ? data.readUInt32LE(4) + 8 : 0;
    if (data.length < 30 || data.length > 20 * 1024 * 1024 || !riff || !webp || !validChunk || riffSize !== data.length) {
      state = "INVALID_WEBP";
    } else {
      sha256 = createHash("sha256").update(data).digest("hex");
      const approved = item.approved_sha256;
      if (!approved || !/^[a-f0-9]{64}$/.test(approved) || !item.source_ref) {
        state = "UNATTESTED";
      } else {
        state = approved === sha256 ? "APPROVED" : "HASH_MISMATCH";
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  results.push({ id: item.id, status: state, bytes, sha256 });
}
const counts = Object.fromEntries([...new Set(results.map(r => r.status))].map(status =>
  [status, results.filter(r => r.status === status).length]
));
console.log(JSON.stringify({ gate: "J02_MASTER_ASSET_PROVENANCE", strict, counts, results }, null, 2));
const invalid = results.some(r => ["INVALID_WEBP", "HASH_MISMATCH"].includes(r.status));
if (invalid || (strict && results.some(r => r.status !== "APPROVED"))) {
  console.error("J02 NO-GO: visual files cannot be considered approved.");
  process.exit(1);
}
if (results.some(r => r.status !== "APPROVED")) {
  console.warn("J02 PENDING: report-only audit. Missing/unattested masters are NOT a completed J02 asset gate.");
} else {
  console.log("J02: all seven masters are present, valid, and match the recorded approval hashes.");
}
