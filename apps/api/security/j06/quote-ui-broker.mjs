import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
const states=new Set(['blocked','example','pickup','delivery','outside','stale','loading','unavailable']);
const safeState=(state,quote=null)=>({state,quote});
const validMoney=n=>Number.isSafeInteger(n)&&n>=0;
function projection(q){
 if(!q||q.scope!=='LAB'||q.orderable!==false||q.currency!=='MAD')throw Error('INVALID_QUOTE');
 const a=q.amounts,keys=['kitNetMinor','optionsNetMinor','deliveryNetMinor','netMinor','vatMinor','totalMinor'];
 if(!a||!keys.every(k=>validMoney(a[k]))||!validMoney(q.vatBps)||q.vatBps>10000)throw Error('INVALID_AMOUNTS');
 return {amounts:Object.fromEntries(keys.map(k=>[k,a[k]])),vatBps:q.vatBps};
}
export async function startPriceUiLab({api,fixture,css,master,clientSource,delayPickup=0}){
 const sessions=new Map();
 let origin;
 const json=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body));};
 const call=async(path,input)=>{const r=await fetch(api.url.replace(/quote$/,path),{method:'POST',headers:{authorization:'Bearer '+api.token,'content-type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(5000)});return await r.json();};
 const server=createServer(async(req,res)=>{
  try{
   if(req.socket.remoteAddress!=='127.0.0.1'||req.headers.host!==new URL(origin).host){json(res,403,{});return;}
   const u=new URL(req.url,origin);
   if(req.method==='GET'&&u.pathname==='/'){
    if(sessions.size>=64){json(res,503,{});return;}
    const sid=randomBytes(32).toString('hex');sessions.set(sid,{epoch:0,token:null,selection:null});
    const lang=u.searchParams.get('lang')==='ar'?'ar':'fr';
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','set-cookie':'j06sid='+sid+'; HttpOnly; SameSite=Strict; Path=/','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",'x-content-type-options':'nosniff'});
    res.end('<!doctype html><html lang="'+lang+'" dir="'+(lang==='ar'?'rtl':'ltr')+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PANOKIT · LAB</title><link rel="stylesheet" href="/style.css"></head><body><main id="app"></main><script src="/client.js" defer></script></body></html>');return;
   }
   if(req.method==='GET'&&['/style.css','/master.svg','/client.js'].includes(u.pathname)){
    const [type,body]=u.pathname==='/style.css'?['text/css',css]:u.pathname==='/master.svg'?['image/svg+xml',master]:['text/javascript',clientSource];
    res.writeHead(200,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(body);return;
   }
   const sid=(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>/^j06sid=[a-f0-9]{64}$/.test(x))?.slice(7),session=sessions.get(sid);
   if(req.method!=='POST'||u.pathname!=='/action'||u.search||req.headers.origin!==origin||req.headers['content-type']!=='application/json'||!session){json(res,403,{});return;}
   let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>1024){json(res,413,{});return;}chunks.push(chunk);}
   let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{json(res,400,{});return;}
   if(!body||Object.keys(body).length!==1||!['blocked','pickup','delivery','outside','revalidate','refresh'].includes(body.action)){json(res,400,{});return;}
   const epoch=++session.epoch,previous=session.token,previousSelection=session.selection;
   const action=body.action==='refresh'?(previousSelection??'pickup'):body.action;
   session.token=null;
   let response=safeState('unavailable'),newToken=null;
   try{
    if(action==='pickup'&&delayPickup)await new Promise(r=>setTimeout(r,delayPickup));
    const selection=action==='pickup'?{mode:'pickup',depotId:'test-depot'}:{mode:'delivery',destinationRef:action==='outside'?'lab-outside':'lab-destination'};
    const raw=action==='revalidate'?(previous?await call('revalidate',{leaseToken:previous}):{status:'unavailable',reason:'lease_unavailable'}):await call('lease',{...fixture,formatId:action==='blocked'?'unapproved':fixture.formatId,expectedTariffRevision:null,fulfillment:selection});
    if(raw.status==='lab_lease'||raw.status==='lab_valid'){
     const selected=action==='revalidate'?previousSelection:action;
     if(raw.scope!=='LAB'||raw.orderable!==false||!['pickup','delivery'].includes(selected))throw Error('INVALID_RESULT');
     newToken=raw.status==='lab_lease'?raw.leaseToken:previous;
     if(typeof newToken!=='string'||!/^[a-f0-9]{64}$/.test(newToken))throw Error('INVALID_TOKEN');
     response={...safeState(selected,projection(raw.quote)),validated:raw.status==='lab_valid'};
    }else if(raw.status==='unavailable'){
     response=safeState(raw.reason==='industrial_unavailable'?'blocked':raw.reason==='delivery_unavailable'?'outside':['stale_selection','lease_unavailable','tariff_unavailable'].includes(raw.reason)?'stale':'unavailable');
    }
   }catch{response=safeState('unavailable');}
   if(epoch!==session.epoch){json(res,409,safeState('unavailable'));return;}
   session.token=newToken;session.selection=action==='revalidate'?previousSelection:action;
   if(!states.has(response.state))throw Error('STATE');
   json(res,200,response);
  }catch{if(!res.headersSent)json(res,503,safeState('unavailable'));else res.end();}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 origin='http://127.0.0.1:'+server.address().port;
 return {origin,close:()=>new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))};
}
