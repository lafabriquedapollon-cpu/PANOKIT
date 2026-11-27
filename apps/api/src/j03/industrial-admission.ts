/**
 * J03-B: isolated industrial catalogue admission policy. No routes, credentials,
 * persistence, price engine or production authorization. The repository below
 * is a TRUSTED server-side port, never a client request body.
 */
export const PILOT_MODEL = "caisson-rectangulaire" as const;
export type EvidenceKind = "dimensions" | "bom" | "electrical" | "mounting" | "artwork" | "packaging" | "commercial" | "quality";
export const REQUIRED_EVIDENCE: readonly EvidenceKind[] = Object.freeze(["dimensions","bom","electrical","mounting","artwork","packaging","commercial","quality"]);
export type EvidenceRef = Readonly<{kind: EvidenceKind; privateRef: string; sha256: string}>;
export type IndustrialRevision = Readonly<{
  modelId: typeof PILOT_MODEL; formatId: string; revision: number;
  widthMm: number; heightMm: number; depthMm: number;
  labelFr: string; labelAr: string;
  // Technical and commercial evidence is PRIVATE; never projected to the public.
  evidence: readonly EvidenceRef[];
}>;
export type ApprovedRevision = Readonly<{modelId: typeof PILOT_MODEL; formatId: string; revision: number; digest: string; status: "approved" | "withdrawn";}>;
export type IndustrialReadPort = {
  // Both operations MUST use the same consistent server-side read snapshot.
  readSnapshot(): Promise<{revision: unknown; approval: unknown} | null>;
};
export type PublicFormat = Readonly<{id: string; revision: number; widthMm: number; heightMm: number; depthMm: number; labelFr: string; labelAr: string; orderable: false;}>;
import { createHash } from "node:crypto";
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v,k));
const id = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(v);
const positive = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const label = (v: unknown): v is string => typeof v === "string" && v.length <= 120 && v.trim() === v && v.length > 0 && !/[\p{Cc}\p{Cf}]/u.test(v);
const opaqueRef = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9_-]{16,128}$/.test(v);
export function parseIndustrialRevision(v: unknown): IndustrialRevision | null {
  if (!object(v) || !exact(v,["modelId","formatId","revision","widthMm","heightMm","depthMm","labelFr","labelAr","evidence"])) return null;
  if (v.modelId !== PILOT_MODEL || !id(v.formatId) || !positive(v.revision) || !positive(v.widthMm) || !positive(v.heightMm) || !positive(v.depthMm) || !label(v.labelFr) || !label(v.labelAr) || !/[\u0600-\u06ff]/.test(v.labelAr)) return null;
  if (!Array.isArray(v.evidence) || v.evidence.length !== REQUIRED_EVIDENCE.length) return null;
  const evidence: EvidenceRef[] = [];
  for (const kind of REQUIRED_EVIDENCE) {
    const entries: unknown[] = v.evidence.filter((e: unknown) => object(e) && e.kind === kind);
    if (entries.length !== 1) return null;
    const e = entries[0];
    if (!object(e) || !exact(e,["kind","privateRef","sha256"]) || !opaqueRef(e.privateRef) || !hash(e.sha256)) return null;
    evidence.push(Object.freeze({kind,privateRef:e.privateRef,sha256:e.sha256}));
  }
  return Object.freeze({modelId:PILOT_MODEL,formatId:v.formatId,revision:v.revision,widthMm:v.widthMm,heightMm:v.heightMm,depthMm:v.depthMm,labelFr:v.labelFr,labelAr:v.labelAr,evidence:Object.freeze(evidence)});
}
// Canonical field order and evidence order are established by the parser.
export function industrialDigest(revision: IndustrialRevision): string {
  const normalized = parseIndustrialRevision(revision);
  if (!normalized) throw new Error("INVALID_INDUSTRIAL_REVISION");
  return createHash("sha256").update(JSON.stringify(normalized),"utf8").digest("hex");
}
export async function readApprovedPilotFormat(port: IndustrialReadPort): Promise<PublicFormat | null> {
  try {
    const snapshot = await port.readSnapshot();
    if (!snapshot) return null;
    const r = parseIndustrialRevision(snapshot.revision), a = snapshot.approval;
    if (!r || !object(a) || !exact(a,["modelId","formatId","revision","digest","status"]) ||
        a.status !== "approved" || a.modelId !== r.modelId || a.formatId !== r.formatId ||
        a.revision !== r.revision || !hash(a.digest) || a.digest !== industrialDigest(r)) return null;
    // Even an industrial approval does NOT authorize orderability or pricing.
    return Object.freeze({id:r.formatId,revision:r.revision,widthMm:r.widthMm,heightMm:r.heightMm,depthMm:r.depthMm,labelFr:r.labelFr,labelAr:r.labelAr,orderable:false});
  } catch { return null; }
}
