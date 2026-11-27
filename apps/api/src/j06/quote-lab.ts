import { createHash } from "node:crypto";
import { PILOT_MODEL, industrialDigest, parseIndustrialRevision, readApprovedPilotFormat } from "../j03/industrial-admission";

/** J06-A: isolated LAB domain, no route, DB credentials, real tariff or order admission. */
type Obj = Record<string, unknown>;
type Selection = Readonly<{mode:"pickup"; depotId:string} | {mode:"delivery"; destinationRef:string}>;
type Request = Readonly<{modelId:typeof PILOT_MODEL; formatId:string; industrialRevision:number; expectedTariffRevision:number|null; options:readonly string[]; fulfillment:Selection}>;
type Rate = Readonly<{id:string; netMinor:number}>;
type ZoneRate = Readonly<{zoneId:string; depotId:string; netMinor:number}>;
type Tariff = Readonly<{scope:"LAB"; modelId:typeof PILOT_MODEL; formatId:string; industrialRevision:number; industrialDigest:string; revision:number; currency:"MAD"; vatBps:number; baseNetMinor:number; options:readonly Rate[]; pickupDepots:readonly string[]; zones:readonly ZoneRate[]}>;
type Resolution = Readonly<{destinationRef:string; zoneId:string; depotId:string}>;
/** Trusted server-only repository; ALL values come from a single consistent snapshot.
 * No adapter is supplied; the caller must not populate it from browser JSON. */
export type QuoteLabPort = { readSnapshot(selection:Readonly<{modelId:typeof PILOT_MODEL;formatId:string;fulfillment:Selection}>):Promise<unknown> };
type Breakdown = Readonly<{kitNetMinor:number; optionsNetMinor:number; deliveryNetMinor:number; netMinor:number; vatMinor:number; totalMinor:number}>;
type Quote = Readonly<{scope:"LAB"; orderable:false; currency:"MAD"; modelId:typeof PILOT_MODEL; formatId:string; industrialRevision:number; industrialDigest:string; tariffRevision:number; tariffDigest:string; options:readonly string[]; fulfillment:Selection; resolvedDelivery:Resolution|null; amounts:Breakdown; vatBps:number; fingerprint:string}>;
export type QuoteResult = Readonly<{status:"lab_quote";quote:Quote} | {status:"unavailable";reason:"invalid_request"|"industrial_unavailable"|"tariff_unavailable"|"stale_selection"|"option_unavailable"|"delivery_unavailable"|"pickup_unavailable"|"calculation_unavailable"}>;
type Reason = Extract<QuoteResult,{status:"unavailable"}>["reason"];
const unavailable=(reason:Reason):QuoteResult=>Object.freeze({status:"unavailable",reason});
const obj=(v:unknown):v is Obj=>v!==null&&typeof v==="object"&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const exact=(v:Obj,keys:readonly string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const id=(v:unknown):v is string=>typeof v==="string"&&/^[a-z0-9][a-z0-9-]{0,63}$/.test(v);
const ref=(v:unknown):v is string=>typeof v==="string"&&/^lab-[a-z0-9-]{1,59}$/.test(v);
const pos=(v:unknown):v is number=>typeof v==="number"&&Number.isSafeInteger(v)&&v>0;
const money=(v:unknown):v is number=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=0&&!Object.is(v,-0);
const hash=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
const digest=(v:unknown)=>createHash("sha256").update(JSON.stringify(v),"utf8").digest("hex");
const ordered=(a:string,b:string)=>a<b?-1:a>b?1:0;
function ids(v:unknown,max:number):readonly string[]|null {
  if(!Array.isArray(v)||v.length>max||!v.every(id)||new Set(v).size!==v.length)return null;
  return Object.freeze([...v].sort(ordered));
}
function selection(v:unknown):Selection|null {
  if(!obj(v))return null;
  if(v.mode==="pickup"&&exact(v,["mode","depotId"])&&id(v.depotId))return Object.freeze({mode:"pickup",depotId:v.depotId});
  if(v.mode==="delivery"&&exact(v,["mode","destinationRef"])&&ref(v.destinationRef))return Object.freeze({mode:"delivery",destinationRef:v.destinationRef});
  return null;
}
function request(v:unknown):Request|null {
  if(!obj(v)||!exact(v,["modelId","formatId","industrialRevision","expectedTariffRevision","options","fulfillment"])||v.modelId!==PILOT_MODEL||!id(v.formatId)||!pos(v.industrialRevision)||!(v.expectedTariffRevision===null||pos(v.expectedTariffRevision)))return null;
  const options=ids(v.options,32),fulfillment=selection(v.fulfillment);
  if(!options||!fulfillment)return null;
  return Object.freeze({modelId:PILOT_MODEL,formatId:v.formatId,industrialRevision:v.industrialRevision,expectedTariffRevision:v.expectedTariffRevision,options,fulfillment});
}
function tariff(v:unknown):Tariff|null {
  if(!obj(v)||!exact(v,["scope","modelId","formatId","industrialRevision","industrialDigest","revision","currency","vatBps","baseNetMinor","options","pickupDepots","zones"])||v.scope!=="LAB"||v.modelId!==PILOT_MODEL||!id(v.formatId)||!pos(v.industrialRevision)||!hash(v.industrialDigest)||!pos(v.revision)||v.currency!=="MAD"||!money(v.vatBps)||v.vatBps>10000||!pos(v.baseNetMinor))return null;
  const pickupDepots=ids(v.pickupDepots,128);
  if(!pickupDepots||!Array.isArray(v.options)||v.options.length>128||!Array.isArray(v.zones)||v.zones.length>512)return null;
  const options:Rate[]=[],zones:ZoneRate[]=[];
  for(const x of v.options){
    if(!obj(x)||!exact(x,["id","netMinor"])||!id(x.id)||!money(x.netMinor)||options.some(o=>o.id===x.id))return null;
    options.push(Object.freeze({id:x.id,netMinor:x.netMinor}));
  }
  for(const x of v.zones){
    if(!obj(x)||!exact(x,["zoneId","depotId","netMinor"])||!id(x.zoneId)||!id(x.depotId)||!money(x.netMinor)||!pickupDepots.includes(x.depotId)||zones.some(o=>o.zoneId===x.zoneId&&o.depotId===x.depotId))return null;
    zones.push(Object.freeze({zoneId:x.zoneId,depotId:x.depotId,netMinor:x.netMinor}));
  }
  options.sort((a,b)=>ordered(a.id,b.id));zones.sort((a,b)=>ordered(a.zoneId,b.zoneId)||ordered(a.depotId,b.depotId));
  return Object.freeze({scope:"LAB",modelId:PILOT_MODEL,formatId:v.formatId,industrialRevision:v.industrialRevision,industrialDigest:v.industrialDigest,revision:v.revision,currency:"MAD",vatBps:v.vatBps,baseNetMinor:v.baseNetMinor,options:Object.freeze(options),pickupDepots,zones:Object.freeze(zones)});
}
/** Canonical digest is a consistency identifier, NOT a signature or authorization. */
export function tariffLabDigest(value:unknown):string {
  const t=tariff(value);if(!t)throw Error("INVALID_LAB_TARIFF");return digest(t);
}
function approvedTariff(t:Tariff,a:unknown):boolean{
  return obj(a)&&exact(a,["scope","status","revision","digest"])&&a.scope==="LAB"&&a.status==="approved"&&a.revision===t.revision&&a.digest===digest(t);
}
function resolution(v:unknown,destinationRef:string):Resolution|null{
  if(!obj(v)||!exact(v,["destinationRef","zoneId","depotId"])||v.destinationRef!==destinationRef||!id(v.zoneId)||!id(v.depotId))return null;
  return Object.freeze({destinationRef,zoneId:v.zoneId,depotId:v.depotId});
}
const safe=(n:bigint):number=>{if(n<0n||n>BigInt(Number.MAX_SAFE_INTEGER))throw Error("MONEY_OVERFLOW");return Number(n);};
/** LAB assumption: one configured VAT rate on combined net, round half-up once.
 * All amounts are integer minor units; no floats or implicit tax rate. */
function totals(t:Tariff,options:readonly Rate[],delivery:number):Breakdown{
  const opt=options.reduce((n,o)=>n+BigInt(o.netMinor),0n);
  const net=BigInt(t.baseNetMinor)+opt+BigInt(delivery);
  const vat=(net*BigInt(t.vatBps)+5000n)/10000n;
  return Object.freeze({kitNetMinor:t.baseNetMinor,optionsNetMinor:safe(opt),deliveryNetMinor:delivery,netMinor:safe(net),vatMinor:safe(vat),totalMinor:safe(net+vat)});
}
export async function calculateLabQuote(input:unknown,port:QuoteLabPort):Promise<QuoteResult>{
  let r:Request|null;
  try{r=request(input);}catch{return unavailable("invalid_request");}
  if(!r)return unavailable("invalid_request");
  try{
    const snap=await port.readSnapshot(Object.freeze({modelId:r.modelId,formatId:r.formatId,fulfillment:r.fulfillment}));
    if(!obj(snap)||!exact(snap,["industrial","industrialApproval","tariff","tariffApproval","resolvedDelivery"]))return unavailable("industrial_unavailable");
    const industrial=parseIndustrialRevision(snap.industrial);
    if(!industrial||industrial.formatId!==r.formatId)return unavailable("industrial_unavailable");
    const approved=await readApprovedPilotFormat({readSnapshot:async()=>({revision:industrial,approval:snap.industrialApproval})});
    if(!approved)return unavailable("industrial_unavailable");
    if(industrial.revision!==r.industrialRevision)return unavailable("stale_selection");
    const indDigest=industrialDigest(industrial),t=tariff(snap.tariff);
    if(!t||t.formatId!==r.formatId||t.industrialRevision!==industrial.revision||t.industrialDigest!==indDigest||!approvedTariff(t,snap.tariffApproval))return unavailable("tariff_unavailable");
    if(r.expectedTariffRevision!==null&&r.expectedTariffRevision!==t.revision)return unavailable("stale_selection");
    const options:Rate[]=[];
    for(const o of r.options){const rate=t.options.find(x=>x.id===o);if(!rate)return unavailable("option_unavailable");options.push(rate);}
    let delivery=0,resolvedDelivery:Resolution|null=null;
    if(r.fulfillment.mode==="pickup"){
      if(!t.pickupDepots.includes(r.fulfillment.depotId)||snap.resolvedDelivery!==null)return unavailable("pickup_unavailable");
    }else{
      resolvedDelivery=resolution(snap.resolvedDelivery,r.fulfillment.destinationRef);
      if(!resolvedDelivery)return unavailable("delivery_unavailable");
      const rate=t.zones.find(x=>x.zoneId===resolvedDelivery?.zoneId&&x.depotId===resolvedDelivery?.depotId);
      if(!rate)return unavailable("delivery_unavailable");delivery=rate.netMinor;
    }
    const quote=Object.freeze({scope:"LAB" as const,orderable:false as const,currency:t.currency,modelId:r.modelId,formatId:r.formatId,industrialRevision:industrial.revision,industrialDigest:indDigest,tariffRevision:t.revision,tariffDigest:digest(t),options:r.options,fulfillment:r.fulfillment,resolvedDelivery,amounts:totals(t,options,delivery),vatBps:t.vatBps});
    return Object.freeze({status:"lab_quote",quote:Object.freeze({...quote,fingerprint:digest(quote)})});
  }catch{return unavailable("calculation_unavailable");}
}
