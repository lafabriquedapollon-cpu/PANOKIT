import {createServer} from 'node:http';
import {randomBytes,createHash} from 'node:crypto';
const token=()=>randomBytes(32).toString('hex');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const statementVersion='lab-visual-v1',visualVersion='lab-preview-v1';
const statement={fr:'Je confirme avoir vérifié cet aperçu de simulation LAB. Aucun paiement, aucune commande ni BAT.',ar:'أؤكد أنني راجعت هذه المعاينة التجريبية. لا دفع ولا طلب ولا اعتماد للإنتاج.'};
// Loopback-only transport harness. No public route, actual customer data or commercial authority.
export async function startGuestUiLab({domain,connect,fixture,preview,ttlMs=900000,reactLabOrigin=null,renderVisual=null}){
 const sessions=new Map(),bytes=Buffer.from(preview),visualDigest=digest(bytes);
 let origin;
 const upstream=reactLabOrigin===null?null:new URL(reactLabOrigin);
 if(upstream&&typeof renderVisual!=='function')throw Error('RENDERER_REQUIRED');
 if(upstream&&(upstream.protocol!=='http:'||upstream.hostname!=='127.0.0.1'||!upstream.port||upstream.pathname!=='/'||upstream.search||upstream.hash||upstream.username||upstream.password))throw Error('REACT_LAB_ORIGIN');
 const project=q=>{
  if(!q||q.scope!=='LAB'||q.orderable!==false||q.currency!=='MAD')throw Error('QUOTE');
  const a=q.amounts,keys=['kitNetMinor','optionsNetMinor','deliveryNetMinor','netMinor','vatMinor','totalMinor'];
  if(!a||!keys.every(k=>Number.isSafeInteger(a[k])&&a[k]>=0)||!Number.isSafeInteger(q.vatBps)||q.vatBps<0||q.vatBps>10000||a.netMinor!==a.kitNetMinor+a.optionsNetMinor+a.deliveryNetMinor||a.totalMinor!==a.netMinor+a.vatMinor)throw Error('AMOUNTS');
  return {amounts:Object.fromEntries(keys.map(k=>[k,a[k]])),vatBps:q.vatBps};
 };
 const headers={'cache-control':'no-store','x-content-type-options':'nosniff','cross-origin-resource-policy':'same-origin','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"};
 const send=(res,status,body)=>{res.writeHead(status,{...headers,'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
 const unavailable=(res,status=409)=>send(res,status,{state:'unavailable',orderable:false});
 const lookup=req=>{const cookies=(req.headers.cookie??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith('j07sid='));if(cookies.length!==1||!/^j07sid=[a-f0-9]{64}$/.test(cookies[0]))return null;return sessions.get(cookies[0].slice(7))??null;};
 const live=s=>s&&performance.now()<s.deadline;
 const cookie=id=>'j07sid='+id+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+Math.ceil(ttlMs/1000);
 const fresh=()=>{
  for(const [id,s] of sessions)if(!live(s)&&!s.busy)sessions.delete(id);
  if(sessions.size>=64)return null;
  const id=token(),s={id,cap:token(),deadline:performance.now()+ttlMs,stage:'new',busy:false};sessions.set(id,s);return s;
 };
 // Only a CI-created Next route and the exact assets needed by Studio may be proxied.
 const shellHeaders={...headers,'content-security-policy':"default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"};
 const proxy=async(req,res,path,extra={})=>{
  const target=new URL(path,upstream);
  if(target.origin!==upstream.origin)throw Error('PROXY_ORIGIN');
  const response=await fetch(target,{redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!response.ok){unavailable(res,503);return;}
  res.writeHead(200,{...shellHeaders,...extra,'content-type':response.headers.get('content-type')??'application/octet-stream'});
  res.end(Buffer.from(await response.arrayBuffer()));
 };
 const server=createServer(async(req,res)=>{
  try{
   if(req.socket.remoteAddress!=='127.0.0.1'||req.headers.host!==new URL(origin).host){unavailable(res,403);return;}
   let session=lookup(req);
   if(req.method==='GET'&&(!upstream&&req.url==='/'||upstream&&/^\/j07-lab(?:\?lang=(?:fr|ar))?$/.test(req.url))){
    if(req.headers['sec-fetch-site']==='cross-site'){unavailable(res,403);return;}
    const out={...headers,'content-type':'text/html; charset=utf-8'};
    if(!live(session)){
     session=fresh();if(!session){unavailable(res,503);return;}
     out['set-cookie']=cookie(session.id);
    }
    if(upstream){await proxy(req,res,req.url,out['set-cookie']?{'set-cookie':out['set-cookie']}:{ });return;}
    res.writeHead(200,out);res.end('<!doctype html><html lang="fr"><meta charset="utf-8"><title>J07 LAB transport</title><main>LAB — aucun paiement ni commande</main></html>');return;
   }
   if(upstream&&req.method==='GET'&&(/^\/_next\/static\/[A-Za-z0-9._%/()\-]+$/.test(req.url)||/^\/studio-v4\/STU-ENV-01-master-(?:day|night)\.svg$/.test(req.url))){
    const decoded=decodeURIComponent(req.url);
    if(decoded.split('/').some(x=>x==='.'||x==='..')||decoded.includes('\\')||decoded.includes('?')||decoded.includes('#')||decoded.startsWith('//')){unavailable(res,403);return;}
    await proxy(req,res,req.url);return;
   }
   if(req.method==='GET'&&req.url==='/preview.svg'){
    if(!live(session)||session.busy||(session.stage!=='contact'&&!(upstream&&session.stage==='acknowledged'))||req.headers['sec-fetch-site']==='cross-site'){unavailable(res,403);return;}
    const rendered=upstream?session.visualBytes:bytes;if(!rendered){unavailable(res,403);return;}
    session.previewServed=true;res.writeHead(200,{...headers,'content-type':'image/svg+xml'});res.end(rendered);return;
   }
   if(req.method!=='POST'||req.url!=='/action'||req.headers.origin!==origin||req.headers['content-type']!=='application/json'||req.headers['content-encoding']!==undefined ){unavailable(res,403);return;}
   if(session?.busy){unavailable(res);return;}
   if(session)session.busy=true;
   try{
    let size=0;const chunks=[];for await(const part of req){size+=part.length;if(size>4096){unavailable(res,413);return;}chunks.push(part);}
    let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{unavailable(res,400);return;}
    if(exact(body,['action'])&&body.action==='reset'&&upstream){
     if(session)sessions.delete(session.id);
     const next=fresh();if(!next){unavailable(res,503);return;}
     res.setHeader('set-cookie',cookie(next.id));send(res,200,{state:'new',orderable:false});return;
    }
    if(!live(session)){unavailable(res,403);return;}
    if(exact(body,upstream?['action','mode','configuration']:['action','mode'])&&body.action==='issue'&&['pickup','delivery'].includes(body.mode)&&session.stage==='new'){
     if(upstream){
      const svg=renderVisual(body.configuration);
      if(typeof svg!=='string'||Buffer.byteLength(svg)>2_000_000){send(res,422,{state:'visual_unavailable',orderable:false});return;}
      session.visualBytes=Buffer.from(svg,'utf8');session.visualDigest=digest(session.visualBytes);session.visualVersion='lab-config-v1';
     }
     const fulfillment=body.mode==='pickup'?{mode:'pickup',depotId:'test-depot'}:{mode:'delivery',destinationRef:'lab-destination'};
     const result=await domain.issueGuestLabLease({...fixture,expectedTariffRevision:null,fulfillment},session.cap,connect);
     if(result.status!=='lab_lease'||result.orderable!==false||!live(session)){unavailable(res);return;}
     session.lease=result.leaseToken;session.fingerprint=result.quote.fingerprint;session.stage='quote';
     send(res,200,{state:'quote',mode:body.mode,orderable:false,...(upstream?{quote:project(result.quote)}:{})});return;
    }
    if(exact(body,['action','contact','locale'])&&body.action==='contact'&&['fr','ar'].includes(body.locale)&&session.stage==='quote'){
     const result=await domain.admitLabGuest({leaseToken:session.lease,contact:body.contact},session.cap,connect);
     if(result.status==='unavailable'&&result.reason==='contact_invalid'){send(res,422,{state:'contact_invalid',fields:result.fields,orderable:false});return;}
     if(result.status!=='lab_guest_admitted'||result.orderable!==false||!live(session)){session.stage='closed';unavailable(res);return;}
     session.receipt=result.receiptId;session.locale=body.locale;session.stage='contact';
     send(res,200,{state:'contact',visualVersion:upstream?session.visualVersion:visualVersion,visualDigest:upstream?session.visualDigest:visualDigest,statementVersion,statement:statement[body.locale],orderable:false});return;
    }
    if(exact(body,['action','accepted','visualVersion','visualDigest','statementVersion'])&&body.action==='visual'&&body.accepted===true&&session.stage==='contact'&&session.previewServed&&body.visualVersion===(upstream?session.visualVersion:visualVersion)&&body.visualDigest===(upstream?session.visualDigest:visualDigest)&&body.statementVersion===statementVersion){
     const version=upstream?session.visualVersion:visualVersion,hash=upstream?session.visualDigest:visualDigest;
     const input={leaseToken:session.lease,receiptId:session.receipt,visualVersion:version,visualDigest:hash,statementVersion,locale:session.locale,accepted:true};
     const manifest={receiptId:session.receipt,fingerprint:session.fingerprint,visualVersion:version,visualDigest:hash};
     const result=await domain.acknowledgeLabVisual(input,session.cap,manifest,connect);
     session.stage='closed';
     if(result.status!=='lab_visual_acknowledged'||result.orderable!==false||!live(session)){unavailable(res);return;}
     if(upstream)session.stage='acknowledged';send(res,200,{state:'acknowledged',orderable:false});return;
    }
    unavailable(res,400);
   }finally{if(session)session.busy=false;}
  }catch{if(!res.headersSent)unavailable(res,503);else res.end();}
 });
 server.requestTimeout=10000;server.headersTimeout=5000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 origin='http://127.0.0.1:'+server.address().port;
 return {origin,close:()=>new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))};
}
