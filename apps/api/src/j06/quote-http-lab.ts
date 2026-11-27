import {createServer,type IncomingMessage,type ServerResponse} from "node:http";
import {randomBytes,timingSafeEqual} from "node:crypto";
import {persistLabQuote,type QuoteLabConnection} from "./quote-pg-lab";
import {issueLabLease,revalidateLabLease} from "./quote-validity-lab";
const MAX=8192;
function respond(res:ServerResponse,status:number,body:unknown){res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"});res.end(JSON.stringify(body));}
/** Disposable test listener: random capability, loopback-only, ephemeral port, no CORS, no public route. */
export async function startQuoteHttpLab(connect:QuoteLabConnection){
 const token=randomBytes(32).toString("hex");
 const authenticated=(req:IncomingMessage)=>{const h=req.headers.authorization;return typeof h==="string"&&/^Bearer [a-f0-9]{64}$/.test(h)&&timingSafeEqual(Buffer.from(h),Buffer.from("Bearer "+token));};
 const server=createServer(async(req,res)=>{
  try{
   if(req.socket.remoteAddress!=="127.0.0.1"||req.headers.origin!==undefined||!authenticated(req)){respond(res,403,{status:"denied"});return;}
   if(req.method!=="POST"||!["/lab/j06/quote","/lab/j06/lease","/lab/j06/revalidate"].includes(req.url??"")){respond(res,404,{status:"not_found"});return;}
   if(req.headers["content-type"]!=="application/json"||req.headers["content-encoding"]!==undefined){respond(res,415,{status:"invalid_content"});return;}
   let bytes=0;const chunks:Buffer[]=[];
   for await(const chunk of req){const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);bytes+=b.length;if(bytes>MAX){respond(res,413,{status:"too_large"});return;}chunks.push(b);}
   let input:unknown;try{input=JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{respond(res,400,{status:"unavailable",reason:"invalid_request"});return;}
   const result=await (req.url==="/lab/j06/lease"?issueLabLease(input,connect):req.url==="/lab/j06/revalidate"?revalidateLabLease(input,connect):persistLabQuote(input,connect));
   respond(res,result.status!=="unavailable"?200:result.reason==="invalid_request"?400:result.reason==="calculation_unavailable"?503:409,result);
  }catch{if(!res.headersSent)respond(res,503,{status:"unavailable",reason:"calculation_unavailable"});else res.end();}
 });
 server.requestTimeout=10000;server.headersTimeout=5000;
 await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",()=>{server.off("error",reject);resolve();});});
 const addr=server.address();if(!addr||typeof addr==="string"||addr.address!=="127.0.0.1"){server.close();throw Error("LAB_BIND_FAILED");}
 return {url:"http://127.0.0.1:"+addr.port+"/lab/j06/quote",token,close:()=>new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()))};
}
