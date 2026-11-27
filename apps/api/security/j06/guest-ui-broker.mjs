import {createServer} from 'node:http';
import {randomBytes,createHash} from 'node:crypto';
const token=()=>randomBytes(32).toString('hex');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const statementVersion='lab-visual-v1',visualVersion='lab-preview-v1';
const statement={fr:'Je confirme avoir vérifié cet aperçu de simulation LAB. Aucun paiement, aucune commande ni BAT.',ar:'أؤكد أنني راجعت هذه المعاينة التجريبية. لا دفع ولا طلب ولا اعتماد للإنتاج.'};
// Loopback-only transport harness. No public route, actual customer data or commercial authority.
export async function startGuestUiLab({domain,connect,fixture,preview,ttlMs=900000}){
 const sessions=new Map(),bytes=Buffer.from(preview),visualDigest=digest(bytes);
 let origin;
 const headers={'cache-control':'no-store','x-content-type-options':'nosniff','cross-origin-resource-policy':'same-origin','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"};
 const send=(res,status,body)=>{res.writeHead(status,{...headers,'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
 const unavailable=(res,status=409)=>send(res,status,{state:'unavailable',orderable:false});
 const lookup=req=>{const cookies=(req.headers.cookie??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith('j07sid='));if(cookies.length!==1||!/^j07sid=[a-f0-9]{64}$/.test(cookies[0]))return null;return sessions.get(cookies[0].slice(7))??null;};
 const live=s=>s&&performance.now()<s.deadline;
 const server=createServer(async(req,res)=>{
  try{
   if(req.socket.remoteAddress!=='127.0.0.1'||req.headers.host!==new URL(origin).host){unavailable(res,403);return;}
   let session=lookup(req);
   if(req.method==='GET'&&req.url==='/'){
    if(req.headers['sec-fetch-site']==='cross-site'){unavailable(res,403);return;}
    const out={...headers,'content-type':'text/html; charset=utf-8'};
    if(!live(session)){
     for(const [id,s] of sessions)if(!live(s)&&!s.busy)sessions.delete(id);
     if(sessions.size>=64){unavailable(res,503);return;}
     const id=token();session={cap:token(),deadline:performance.now()+ttlMs,stage:'new',busy:false};sessions.set(id,session);
     out['set-cookie']='j07sid='+id+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+Math.ceil(ttlMs/1000);
    }
    res.writeHead(200,out);res.end('<!doctype html><html lang="fr"><meta charset="utf-8"><title>J07 LAB transport</title><main>LAB — aucun paiement ni commande</main></html>');return;
   }
   if(req.method==='GET'&&req.url==='/preview.svg'){
    if(!live(session)||session.busy||session.stage!=='contact'||req.headers['sec-fetch-site']==='cross-site'){unavailable(res,403);return;}
    session.previewServed=true;res.writeHead(200,{...headers,'content-type':'image/svg+xml'});res.end(bytes);return;
   }
   if(req.method!=='POST'||req.url!=='/action'||req.headers.origin!==origin||req.headers['content-type']!=='application/json'||req.headers['content-encoding']!==undefined||!live(session)){unavailable(res,403);return;}
   if(session.busy){unavailable(res);return;}
   session.busy=true;
   try{
    let size=0;const chunks=[];for await(const part of req){size+=part.length;if(size>4096){unavailable(res,413);return;}chunks.push(part);}
    let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{unavailable(res,400);return;}
    if(!live(session)){unavailable(res,403);return;}
    if(exact(body,['action','mode'])&&body.action==='issue'&&['pickup','delivery'].includes(body.mode)&&session.stage==='new'){
     const fulfillment=body.mode==='pickup'?{mode:'pickup',depotId:'test-depot'}:{mode:'delivery',destinationRef:'lab-destination'};
     const result=await domain.issueGuestLabLease({...fixture,expectedTariffRevision:null,fulfillment},session.cap,connect);
     if(result.status!=='lab_lease'||result.orderable!==false||!live(session)){unavailable(res);return;}
     session.lease=result.leaseToken;session.fingerprint=result.quote.fingerprint;session.stage='quote';
     send(res,200,{state:'quote',mode:body.mode,orderable:false});return;
    }
    if(exact(body,['action','contact','locale'])&&body.action==='contact'&&['fr','ar'].includes(body.locale)&&session.stage==='quote'){
     const result=await domain.admitLabGuest({leaseToken:session.lease,contact:body.contact},session.cap,connect);
     if(result.status==='unavailable'&&result.reason==='contact_invalid'){send(res,422,{state:'contact_invalid',fields:result.fields,orderable:false});return;}
     if(result.status!=='lab_guest_admitted'||result.orderable!==false||!live(session)){session.stage='closed';unavailable(res);return;}
     session.receipt=result.receiptId;session.locale=body.locale;session.stage='contact';
     send(res,200,{state:'contact',visualVersion,visualDigest,statementVersion,statement:statement[body.locale],orderable:false});return;
    }
    if(exact(body,['action','accepted','visualVersion','visualDigest','statementVersion'])&&body.action==='visual'&&body.accepted===true&&session.stage==='contact'&&session.previewServed&&body.visualVersion===visualVersion&&body.visualDigest===visualDigest&&body.statementVersion===statementVersion){
     const input={leaseToken:session.lease,receiptId:session.receipt,visualVersion,visualDigest,statementVersion,locale:session.locale,accepted:true};
     const manifest={receiptId:session.receipt,fingerprint:session.fingerprint,visualVersion,visualDigest};
     const result=await domain.acknowledgeLabVisual(input,session.cap,manifest,connect);
     session.stage='closed';
     if(result.status!=='lab_visual_acknowledged'||result.orderable!==false||!live(session)){unavailable(res);return;}
     send(res,200,{state:'acknowledged',orderable:false});return;
    }
    unavailable(res,400);
   }finally{session.busy=false;}
  }catch{if(!res.headersSent)unavailable(res,503);else res.end();}
 });
 server.requestTimeout=10000;server.headersTimeout=5000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 origin='http://127.0.0.1:'+server.address().port;
 return {origin,close:()=>new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))};
}
