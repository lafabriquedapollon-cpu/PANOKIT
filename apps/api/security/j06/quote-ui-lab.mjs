import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import EmbeddedPostgres from 'embedded-postgres';
import pgDriver from 'pg';
import {startPriceUiLab} from './quote-ui-broker.mjs';
import {runGuestTransportLab} from './guest-ui-lab.mjs';
import {runGuestReactLab} from './guest-react-lab.mjs';
import {chromium} from '/tmp/panokit-playwright/node_modules/playwright/index.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
const {Client}=pgDriver;
assert.deepEqual(process.argv.slice(2),['--disposable-lab']);assert(process.getuid()!==0);
const require=createRequire(import.meta.url),{PILOT_MODEL,REQUIRED_EVIDENCE,industrialDigest}=require(process.env.J03_ADMISSION),{tariffLabDigest}=require(process.env.J06_ENGINE),{persistLabQuote}=require(process.env.J06_PORT),{startQuoteHttpLab}=require(process.env.J06_HTTP);
const guestDomain=require(process.env.J06_PORT.replace(/quote-pg-lab\.js$/,'quote-validity-lab.js'));
const dir=mkdtempSync(join(tmpdir(),'panokit-j06-')),db='panokit_j03_industrial_lab',port=55450,pw=randomBytes(32).toString('hex');
const pg=new EmbeddedPostgres({databaseDir:dir,user:'postgres',password:pw,port,authMethod:'scram-sha-256',persistent:true,postgresFlags:['-c','listen_addresses=127.0.0.1'],autoRehydrateSymlinks:true,onLog:()=>{},onError:()=>{}});
const roles=['j03_editor','j03_approver','j03_revoker','j03_reader','j06_editor','j06_approver','j06_revoker','j06_runtime','j06_outsider'],creds={},clients=new Set();let started=false,listener,passed=0,cPassed=0,lease,ui,browser;const contexts=[];
async function connect(user,password,database=db){const c=new Client({host:'127.0.0.1',port,database,user,password,connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:15000});await c.connect();clients.add(c);return c;}
async function close(c){clients.delete(c);await c.end();}
const login=role=>connect(role,creds[role]);const scalar=async(c,q,a=[])=>Object.values((await c.query(q,a)).rows[0])[0];
const denied=f=>assert.rejects(f,e=>e?.code==='42501');
async function test(name,fn){await fn();passed++;console.log('J06_B '+JSON.stringify({name,status:'PASS'}));}
async function ctest(name,fn){await fn();cPassed++;console.log('J06_C '+JSON.stringify({name,status:'PASS'}));}
const leaseCall=async(path,body)=>{const res=await fetch(listener.url.replace(/quote$/,path),{method:'POST',headers:{authorization:'Bearer '+listener.token,'content-type':'application/json'},body:JSON.stringify(body)});return {status:res.status,body:await res.json()};};
const industrial={modelId:PILOT_MODEL,formatId:'test-only',revision:1,widthMm:101,heightMm:202,depthMm:30,labelFr:'TEST_ONLY',labelAr:'اختبار',evidence:REQUIRED_EVIDENCE.map((kind,i)=>({kind,privateRef:'fixture_evidence_'+i,sha256:String(i+1).repeat(64)}))};
const digest=industrialDigest(industrial),tariff=revision=>({scope:'LAB',modelId:PILOT_MODEL,formatId:'test-only',industrialRevision:1,industrialDigest:digest,revision,currency:'MAD',vatBps:1250,baseNetMinor:101,options:[{id:'test-a',netMinor:2},{id:'test-b',netMinor:9}],pickupDepots:['test-depot','test-other'],zones:[{zoneId:'test-zone',depotId:'test-other',netMinor:8}]}),dest={'lab-destination':{zoneId:'test-zone',depotId:'test-other'}};
const request={modelId:PILOT_MODEL,formatId:'test-only',industrialRevision:1,expectedTariffRevision:1,options:['test-b','test-a'],fulfillment:{mode:'pickup',depotId:'test-depot'}};
const delivery={...request,fulfillment:{mode:'delivery',destinationRef:'lab-destination'}};
const save=(c,t,d=tariffLabDigest(t),map=dest)=>scalar(c,'select j06_private.save_tariff($1,$2,$3,$4,$5)',[t.formatId,t.revision-1,JSON.stringify(t),d,JSON.stringify(map)]);
const decide=(c,t,event,d=tariffLabDigest(t))=>scalar(c,'select j06_private.decide($1,$2,$3,$4)',[t.formatId,t.revision,d,event]);
const adapter=async()=>{const c=await login('j06_runtime');return {query:(q,a)=>c.query(q,a),close:()=>close(c)}};
const calc=r=>persistLabQuote(r,adapter);
const call=async(body,patch={})=>{const res=await fetch(listener.url,{method:'POST',headers:{authorization:'Bearer '+listener.token,'content-type':'application/json'},body:JSON.stringify(body),...patch});return {status:res.status,body:await res.json()}};
let admin,editor,approver,revoker,runtime,outsider,ie,ia,ir,t1=tariff(1),t2=tariff(2);
try{
 await pg.initialise();await pg.start();started=true;
 const boot=await connect('postgres',pw,'postgres');assert.equal(await scalar(boot,"select current_setting('server_version_num')::int"),170012);assert.equal(await scalar(boot,"select current_setting('listen_addresses')"),'127.0.0.1');
 await boot.query('create database '+db);
 for(const role of roles){creds[role]=randomBytes(32).toString('hex');await boot.query("create role "+role+" login password '"+creds[role]+"' nosuperuser nocreatedb nocreaterole noreplication nobypassrls");}
 admin=await connect('postgres',pw);await admin.query('revoke connect,temporary on database '+db+' from public');await admin.query('grant connect on database '+db+' to '+roles.join(','));await admin.query('revoke create on schema public from public');
 await admin.query(readFileSync(new URL('./industrial-lab.sql',import.meta.url),'utf8'));await admin.query(readFileSync(new URL('./quote-lab.sql',import.meta.url),'utf8'));await admin.query(readFileSync(new URL('./quote-validity-lab.sql',import.meta.url),'utf8'));await admin.query(readFileSync(new URL('./guest-admission-lab.sql',import.meta.url),'utf8'));
 [editor,approver,revoker,runtime,outsider,ie,ia,ir]=await Promise.all(['j06_editor','j06_approver','j06_revoker','j06_runtime','j06_outsider','j03_editor','j03_approver','j03_revoker'].map(login));
 listener=await startQuoteHttpLab(adapter);
 await scalar(ie,'select j03_private.save_draft($1,$2,$3,$4)',[industrial.formatId,0,JSON.stringify(industrial),digest]);
 await scalar(ia,'select j03_private.record_decision($1,$2,$3,$4)',[industrial.formatId,1,digest,'approved']);
 await save(editor,t1);await decide(approver,t1,'approved');
 const css=readFileSync(process.env.J06_CSS,'utf8')+'\n.figure img{display:block;width:100%;height:auto}.choice{text-align:start;font:inherit;cursor:pointer}.choice[aria-pressed=true]{border-color:#b64709;background:#fff4e5;color:#292725}.choice[aria-pressed=true] .radio{border:5px solid #b64709}.labControls{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.labControls button{border:1px solid #ded8ce;background:#fff;color:#9a3e0b;min-height:44px;border-radius:7px;padding:8px;font:inherit;font-size:12px}.page a:focus-visible,.page button:focus-visible{outline:3px solid #b64709;outline-offset:2px}.page h1,.page h2{font-family:inherit}.page button{box-sizing:border-box}.page .action:not(:disabled){background:#b64709;color:#fff;cursor:pointer}.page .action:not(:disabled):hover{background:#963908}.page .action:disabled{cursor:not-allowed}.page #lab-status:focus-visible{outline:3px solid #b64709;outline-offset:2px}body{margin:0}';
 const out=process.env.J06_UI_EVIDENCE;mkdirSync(out,{recursive:true});
 ui=await startPriceUiLab({api:listener,fixture:request,css,master:readFileSync(process.env.J06_MASTER),clientSource:readFileSync(new URL('./quote-ui-client.js',import.meta.url),'utf8'),delayPickup:500});
 browser=await chromium.launch({headless:true});
 // J08 nonvisual browser transport qualification; intercepted blank test document
 // exists only inside Playwright, not a server route or product design.
 {
  const {fixtureSource,fixtureDigest,rasterizePinnedFixture}=await import('./bat-raster-fixture-lab.mjs');
  const {startBatStatusBroker}=require(process.env.J06_PORT.replace(/quote-pg-lab\.js$/,'../j08/bat-status-broker-lab.js'));
  const {createBatPreviewGate}=require(process.env.J06_PORT.replace(/quote-pg-lab\.js$/,'../j08/bat-preview-gate-lab.js'));
  const webRoot=join(process.env.J06_PORT,'../../../../web');
  const ts=createRequire(join(webRoot,'package.json'))('typescript');
  const source=readFileSync(join(webRoot,'src/lib/j08/bat-lab-transport.ts'),'utf8');
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const moduleUrl='data:text/javascript;base64,'+Buffer.from(js).toString('base64');
  const binding={caseId:'11111111-1111-4111-8111-111111111111',version:1,sourceSession:'a'.repeat(64),linkToken:'b'.repeat(64),expectedDigest:fixtureDigest};
  let status='review',reads=0;
  const exact=(c,s)=>c.caseId===binding.caseId&&c.version===1&&c.linkToken===binding.linkToken&&s===binding.sourceSession;
  const adapter={status:async(c,s)=>exact(c,s)?{status:'ok',value:{scope:'LAB',manufacturable:false,version:1,status}}:{status:'unavailable'},review:async(c,s)=>{reads++;return exact(c,s)&&status==='review'?{status:'ok',value:{scope:'LAB',manufacturable:false,version:1,digest:fixtureDigest,bytesBase64:fixtureSource().toString('base64')}}:{status:'unavailable'};}};
  const broker=await startBatStatusBroker(adapter,120000,createBatPreviewGate(adapter,[fixtureDigest],rasterizePinnedFixture));
  const report={sha:process.env.GITHUB_SHA,checks:[]};
  const check=async(name,fn)=>{await fn();report.checks.push({name,status:'PASS'});console.log('J08_BROWSER_TRANSPORT '+JSON.stringify({name,status:'PASS'}));};
  const contexts=[];
  try{
   async function setup(session){
    const ctx=await browser.newContext();contexts.push(ctx);
    if(session){const pair=session.cookie.split(';')[0],i=pair.indexOf('=');await ctx.addCookies([{name:pair.slice(0,i),value:pair.slice(i+1),domain:'127.0.0.1',path:'/bat',httpOnly:true,sameSite:'Strict',secure:false}]);}
    const p=await ctx.newPage();
    await p.route(broker.origin+'/bat/browser-proof',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><title>LAB transport proof</title><body>LAB</body></html>'}));
    await p.goto(broker.origin+'/bat/browser-proof');
    await p.evaluate(async url=>{window.batProof=await import(url);},moduleUrl);
    return p;
   }
   const session=broker.provision(binding),p=await setup(session),foreign=await setup();
   await check('W01 actual Chromium same-origin POST and HttpOnly session',async()=>{
    assert.equal(await p.evaluate(()=>window.isSecureContext&&!!crypto.subtle&&document.cookie===''),true);
    assert.deepEqual(await p.evaluate(()=>window.batProof.readBatLabStatus()),{status:'ok',value:{scope:'LAB',manufacturable:false,version:1,status:'review'}});
   });
   await check('W02 verified browser Blob decodes to exact fixture dimensions',async()=>{
    const result=await p.evaluate(async()=>{const r=await window.batProof.readBatLabPreview();if(r.status!=='ok')return r;const bitmap=await createImageBitmap(r.value.blob);try{return {status:'ok',mime:r.value.blob.type,width:bitmap.width,height:bitmap.height,sourceDigest:r.value.sourceDigest};}finally{bitmap.close();}});
    assert.deepEqual(result,{status:'ok',mime:'image/png',width:64,height:32,sourceDigest:fixtureDigest});
   });
   await check('W03 independent browser without cookie fails closed',async()=>{
    const before=reads;
    assert.deepEqual(await foreign.evaluate(()=>window.batProof.readBatLabPreview()),{status:'unavailable'});assert.equal(reads,before);
   });
   await check('W04 replaced state denies PNG and reports status',async()=>{
    status='replaced';
    assert.deepEqual(await p.evaluate(()=>window.batProof.readBatLabStatus()),{status:'ok',value:{scope:'LAB',manufacturable:false,version:1,status:'replaced'}});
    assert.deepEqual(await p.evaluate(()=>window.batProof.readBatLabPreview()),{status:'unavailable'});
   });
   await check('W05 revoked browser session denies both reads',async()=>{
    session.revoke();assert.deepEqual(await p.evaluate(()=>window.batProof.readBatLabStatus()),{status:'unavailable'});assert.deepEqual(await p.evaluate(()=>window.batProof.readBatLabPreview()),{status:'unavailable'});
   });
   assert.equal(report.checks.length,5);
  }finally{for(const ctx of contexts)await ctx.close();await broker.close();writeFileSync(join(out,'j08-browser-transport-report.json'),JSON.stringify(report,null,2));console.log('J08_BROWSER_TRANSPORT_RESULT '+JSON.stringify({passed:report.checks.length,total:5}));}
 }

 await runGuestTransportLab({browser,domain:guestDomain,connect:adapter,fixture:request,preview:readFileSync(process.env.J06_MASTER),admin});
 await runGuestReactLab({browser,domain:guestDomain,connect:adapter,fixture:request,preview:readFileSync(process.env.J06_MASTER),admin,out});
 const report={sha:process.env.GITHUB_SHA,checks:[],captures:[]};
 const check=(id,ok)=>{report.checks.push({id,ok:!!ok});assert.ok(ok,id);};
 const wait=(p,state)=>p.locator('#app[data-state='+state+']').waitFor({state:'visible'});
 const capture=async(p,key,state)=>{
  await wait(p,state);await p.evaluate(()=>document.fonts.ready);
  const m=await p.evaluate(()=>({w:innerWidth,scroll:document.documentElement.scrollWidth,actions:[...document.querySelectorAll('[data-main-action]')].filter(x=>x.getBoundingClientRect().height>0).map(x=>({bottom:x.getBoundingClientRect().bottom,height:x.getBoundingClientRect().height,disabled:x.disabled,bg:getComputedStyle(x).backgroundColor,fg:getComputedStyle(x).color})),total:document.querySelector('[data-total]').textContent,mobile:document.querySelector('[data-total-mobile]').textContent}));
  check(key+'/'+state+'/reflow',m.scroll<=m.w+1);check(key+'/'+state+'/one-action',m.actions.length===1&&m.actions[0].height>=44);if(m.w<=760)check(key+'/'+state+'/first-viewport',m.actions[0].bottom<=844&&m.mobile===m.total);
  const priced=['pickup','delivery'].includes(state);check(key+'/'+state+'/amount',priced?m.total===(state==='pickup'?'1.26 MAD':'1.35 MAD'):!m.total.includes('MAD'));check(key+'/'+state+'/action',m.actions[0].disabled===!['pickup','delivery','stale','unavailable'].includes(state));
  check(key+'/'+state+'/action-visual',(m.actions[0].disabled?m.actions[0].bg==='rgb(233, 229, 223)':['rgb(182, 71, 9)','rgb(150, 57, 8)'].includes(m.actions[0].bg)&&m.actions[0].fg==='rgb(255, 255, 255)'));
  const file=key+'-'+state+'.png';await p.screenshot({path:join(out,file),fullPage:true,animations:'disabled'});report.captures.push(file);
 };
 try{
 for(const lang of ['fr','ar'])for(const width of [320,390,768,1440]){
  const key=lang+'-'+width,ctx=await browser.newContext({viewport:{width,height:844}}),p=await ctx.newPage();contexts.push({ctx,p,key});
  const responses=[];p.on('response',r=>{if(r.url().endsWith('/action'))responses.push(r);});
  await p.goto(ui.origin+'/?lang='+lang);check(key+'/locale',await p.locator('html').getAttribute('dir')===(lang==='ar'?'rtl':'ltr'));await capture(p,key,'example');
  await p.locator('[data-action=blocked]').click();await capture(p,key,'blocked');
  await p.locator('[data-action=pickup]').focus();await p.keyboard.press('Enter');await capture(p,key,'loading');await capture(p,key,'pickup');check(key+'/keyboard-focus',await p.evaluate(()=>document.activeElement?.getAttribute('data-action'))==='pickup');
  await p.locator('[data-action=outside]').click();await capture(p,key,'outside');
  await p.locator('[data-action=pickup]').click();await wait(p,'loading');await p.locator('[data-action=delivery]').click();await capture(p,key,'delivery');
  await p.waitForTimeout(650);check(key+'/race',await p.locator('#app').getAttribute('data-state')==='delivery');
  await p.locator('[data-main-action]:visible').click();await wait(p,'delivery');check(key+'/revalidated',await p.locator('[role=status]').innerText()===(lang==='ar'?'تمت مراجعة العرض التجريبي · لا طلب':'Devis LAB revalidé · aucune commande'));check(key+'/main-focus',await p.evaluate(()=>document.activeElement?.hasAttribute('data-main-action'))===true);
  for(const resp of responses){const body=await resp.text();check(key+'/no-secret',!body.includes(listener.token)&&!body.includes('leaseToken')&&!body.includes('fingerprint')&&!body.includes('industrialDigest'));}
 }
 await save(editor,t2);await decide(approver,t2,'approved');
 for(const {p,key} of contexts){await p.locator('[data-main-action]:visible').click();await capture(p,key,'stale');await p.locator('[data-main-action]:visible').click();await wait(p,'delivery');}
 await listener.close();listener=undefined;
 for(const {p,key} of contexts){await p.locator('[data-action=delivery]').click();await capture(p,key,'unavailable');}
 check('all-64-captures',report.captures.length===64);
 const archiveProof=async(c)=>(await c.query("select receipt_id::text,visual_digest,encode(sha256(svg_bytes),'hex') as actual,octet_length(svg_bytes) as size from j06_private.guest_visual_archive order by receipt_id")).rows;
 const original=await archiveProof(admin);assert.equal(original.length,11);assert(original.every(x=>x.visual_digest===x.actual&&x.size>0));
 for(const c of [editor,approver,revoker,runtime,outsider]){
  await denied(()=>c.query('select * from j06_private.guest_visual_archive'));
  await denied(()=>c.query('delete from j06_private.guest_visual_archive'));
 }
 await ui.close();ui=undefined;for(const c of [...clients])await close(c);await pg.stop();started=false;await pg.start();started=true;admin=await connect('postgres',pw);
 assert.deepEqual(await archiveProof(admin),original);console.log('J07_ARCHIVE_RESTART PASS');

 }finally{writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));console.log('J06_UI_RESULT '+JSON.stringify({checks:report.checks.length,passed:report.checks.filter(x=>x.ok).length,captures:report.captures.length}));}
}finally{for(const {ctx} of contexts)await ctx.close();if(browser)await browser.close();if(ui)await ui.close();if(listener)await listener.close();for(const c of [...clients])await close(c);if(started)await pg.stop();rmSync(dir,{recursive:true,force:true});}
