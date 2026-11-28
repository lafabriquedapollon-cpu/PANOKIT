import {createHash} from "node:crypto";
import {inflateSync} from "node:zlib";
import type {createBatLabAdapter} from "./bat-pg-lab";

type ReviewAdapter=Pick<ReturnType<typeof createBatLabAdapter>,"review">;
type Rasterizer=(trustedSvg:Buffer)=>Promise<Buffer>;
type Binding=Readonly<{caseId:string;version:number;linkToken:string;sourceSession:string;expectedDigest:string}>;
const digest=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
const hex=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
const pngSignature=Buffer.from([137,80,78,71,13,10,26,10]);
const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(b:Buffer){let c=0xffffffff;for(const x of b)c=crcTable[(c^x)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
// Deliberately narrow canonical PNG profile: RGBA8, no interlace or metadata.
// Verify chunk bounds, CRC, ordering and bounded decoded scanline lengths.
function pngDimensions(b:Buffer):{width:number;height:number}|null{
 if(!Buffer.isBuffer(b)||b.length<57||b.length>4_000_000||!b.subarray(0,8).equals(pngSignature))return null;
 let off=8,width=0,height=0,ended=false;const idat:Buffer[]=[];
 while(off+12<=b.length){
  const size=b.readUInt32BE(off);if(size>b.length-off-12)return null;
  const end=off+12+size,type=b.toString("ascii",off+4,off+8),data=b.subarray(off+8,end-4);
  if(crc32(b.subarray(off+4,end-4))!==b.readUInt32BE(end-4))return null;
  if(type==="IHDR"){
   if(off!==8||size!==13)return null;
   width=data.readUInt32BE(0);height=data.readUInt32BE(4);
   if(width<1||height<1||width>2048||height>2048||width*height>2_000_000||data[8]!==8||data[9]!==6||data[10]!==0||data[11]!==0||data[12]!==0)return null;
  }else if(type==="IDAT"){if(!width||ended||size===0||idat.length>=128)return null;idat.push(data);}
  else if(type==="IEND"){if(!width||!idat.length||size!==0||end!==b.length)return null;ended=true;off=end;break;}
  else return null;
  off=end;
 }
 if(!ended||off!==b.length)return null;
 const stride=width*4+1,expected=stride*height;
 try{const decoded=inflateSync(Buffer.concat(idat),{maxOutputLength:expected});if(decoded.length!==expected)return null;for(let i=0;i<decoded.length;i+=stride)if(decoded[i]>4)return null;}catch{return null;}
 return {width,height};
}
/** LAB ONLY. The digest allowlist must be independently pinned by trusted
 * fixture provisioning; digest equality alone does not sanitize user SVG.
 * Never register customer uploads or caller-provided hashes here.
 * Rasterizer is a trusted, bounded, separately qualified server-side port. */
export function createBatPreviewGate(adapter:ReviewAdapter,approvedFixtureDigests:readonly string[],rasterize:Rasterizer){
 if(approvedFixtureDigests.length<1||approvedFixtureDigests.length>64||!approvedFixtureDigests.every(hex))throw Error("LAB_PREVIEW_FIXTURES");
 const allowed=new Set(approvedFixtureDigests);
 return async(binding:Binding)=>{
  const fail={status:"unavailable" as const};
  try{
   if(!hex(binding.expectedDigest)||!allowed.has(binding.expectedDigest)||!Number.isSafeInteger(binding.version)||binding.version<1)return fail;
   const r=await adapter.review({caseId:binding.caseId,version:binding.version,linkToken:binding.linkToken},binding.sourceSession);
   if(r.status!=="ok")return fail;
   const v=r.value;
   if(v.scope!=="LAB"||v.manufacturable!==false||v.version!==binding.version||v.digest!==binding.expectedDigest||typeof v.bytesBase64!=="string"||v.bytesBase64.length>2_666_668||!/^[A-Za-z0-9+/]+={0,2}$/.test(v.bytesBase64))return fail;
   const source=Buffer.from(v.bytesBase64,"base64");
   if(!source.length||source.length>2_000_000||source.toString("base64")!==v.bytesBase64||digest(source)!==binding.expectedDigest)return fail;
   const result=await rasterize(Buffer.from(source));
   // Copy before checking to avoid mutation of the trusted port's output.
   if(!Buffer.isBuffer(result)||result.length>4_000_000)return fail;
   const png=Buffer.from(result),dimensions=pngDimensions(png);
   if(!dimensions)return fail;
   return {status:"ok" as const,value:{scope:"LAB" as const,manufacturable:false as const,version:binding.version,sourceDigest:binding.expectedDigest,previewDigest:digest(png),mime:"image/png" as const,pngBase64:png.toString("base64"),...dimensions}};
  }catch{return fail;}
 };
}
