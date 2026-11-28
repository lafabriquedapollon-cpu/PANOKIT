import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from '/tmp/panokit-playwright/node_modules/playwright/index.mjs';
import {fixtureSource,fixtureDigest,rasterizePinnedFixture} from './bat-raster-fixture-lab.mjs';
const require=createRequire(import.meta.url);
const {startBatStatusBroker}=require('../../dist/j08/bat-status-broker-lab.js');
const {createBatPreviewGate}=require('../../dist/j08/bat-preview-gate-lab.js');
const origin=process.env.J08_REACT_ORIGIN,out=process.env.J08_EVIDENCE;
assert.equal(origin,'http://127.0.0.1:39178');assert(out);mkdirSync(out,{recursive:true});
const checks=[],captures=[],contexts=[];
const check=(name,ok)=>{checks.push({name,pass:!!ok});assert.ok(ok,name);};
const binding={caseId:'11111111-1111-4111-8111-111111111111',version:2,sourceSession:'a'.repeat(64),linkToken:'b'.repeat(64),expectedDigest:fixtureDigest};
let status='review';let reads=0;const exact=(c,s)=>c.caseId===binding.caseId&&c.version===binding.version&&c.linkToken===binding.linkToken&&s===binding.sourceSession;
const adapter={status:async(c,s)=>exact(c,s)?{status:'ok',value:{scope:'LAB',manufacturable:false,version:binding.version,status}}:{status:'unavailable'},review:async(c,s)=>{reads++;return exact(c,s)&&status==='review'?{status:'ok',value:{scope:'LAB',manufacturable:false,version:binding.version,digest:fixtureDigest,bytesBase64:fixtureSource().toString('base64')}}:{status:'unavailable'};}};
const broker=await startBatStatusBroker(adapter,120000,createBatPreviewGate(adapter,[fixtureDigest],rasterizePinnedFixture));
const browser=await chromium.launch({headless:true});
const ids=['01-attente','02-revue','03-otp','04-approuve','05-refuse','06-expire','07-remplace','08-verrouille','09-atelier','10-correction','11-invalide','12-renouvellement','13-demande','14-confirm-refus'];
const capture=async(p,name)=>{await p.evaluate(()=>document.fonts.ready);const file=name+'.png';await p.screenshot({path:join(out,file),fullPage:true,animations:'disabled'});captures.push(file);};
const state=(p,s)=>p.locator('[data-testid=j08-r2][data-state="'+s+'"]').waitFor({state:'visible'});
async function setup(lang,width,session,fixture){
 const ctx=await browser.newContext({viewport:{width,height:844}});contexts.push(ctx);
 if(session){const pair=session.cookie.split(';')[0],i=pair.indexOf('=');await ctx.addCookies([{name:pair.slice(0,i),value:pair.slice(i+1),domain:'127.0.0.1',path:'/bat',httpOnly:true,sameSite:'Strict',secure:false}]);}
 const p=await ctx.newPage();
 // Serve only temporary Next page/assets via Playwright. Never intercept BAT broker POSTs.
 await p.route(u=>u.origin===broker.origin&&(u.pathname==='/bat/react-proof'||u.pathname.startsWith('/_next/')),async route=>{
  const u=new URL(route.request().url());const headers={...route.request().headers()};delete headers.cookie;delete headers.authorization;delete headers.host;
  const response=await route.fetch({url:origin+u.pathname+u.search,headers,maxRedirects:0});await route.fulfill({response});
 });
 await p.goto(broker.origin+'/bat/react-proof?lang='+lang+(fixture?'&fixture='+fixture:''),{waitUntil:'domcontentloaded'});return {ctx,p};
}
async function layout(p,key,lang){
 const root=p.getByTestId('j08-r2');
 check(key+'/locale',await root.getAttribute('dir')===(lang==='ar'?'rtl':'ltr')&&await root.getAttribute('lang')===lang);
 const m=await p.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,h1:document.querySelectorAll('[data-testid=j08-r2] h1').length,enabled:[...document.querySelectorAll('[data-testid=j08-r2] button,[data-testid=j08-r2] input,[data-testid=j08-r2] textarea')].filter(x=>!x.disabled&&!x.matches('.runtime-refresh')).length}));
 check(key+'/layout',m.scroll<=m.width+1&&m.h1===1);check(key+'/no-actions',m.enabled===0);
 const weights=await root.locator('h1,h2').evaluateAll(nodes=>nodes.map(n=>Number(getComputedStyle(n).fontWeight)));check(key+'/approved-heading-weight',weights.length>0&&weights.every(w=>w>=700));
 const live=await root.getAttribute('data-mode')==='live';
 const bar=p.getByTestId('j08-runtime-toolbar');
 if(live){
  const m=await bar.evaluate(el=>{const b=el.querySelector('button'),r=b.getBoundingClientRect(),header=el.previousElementSibling,main=el.nextElementSibling;return {height:r.height,bottom:r.bottom,viewport:innerHeight,position:header?.tagName==='HEADER'&&main?.tagName==='MAIN',enabled:!b.disabled&&b.getAttribute('aria-disabled')==='false',count:el.querySelectorAll('button').length};});
  check(key+'/toolbar-placement',m.position&&m.bottom<=m.viewport);
  check(key+'/toolbar-single-target',m.count===1&&m.enabled&&m.height>=48);
 }else check(key+'/no-runtime-toolbar-in-fixture',await bar.count()===0);
}
try{
 // Explicit static gallery is independent from live state: no broker capability provisioned.
 for(const lang of ['fr','ar'])for(const width of [320,390,768,1440]){
  const {ctx,p}=await setup(lang,width,undefined,ids[0]);let requests=0;p.on('request',r=>{if(/\/bat\/(status|preview)$/.test(r.url()))requests++;});
  for(const id of ids){const key='fixture-'+id+'-'+lang+'-'+width;
   await p.goto(broker.origin+'/bat/react-proof?lang='+lang+'&fixture='+id,{waitUntil:'domcontentloaded'});await state(p,id);await layout(p,key,lang);
   if(width===390||width===1440)await capture(p,key);
  }
  check(lang+'/'+width+'/fixture-no-broker',requests===0);await ctx.close();
 }
 for(const lang of ['fr','ar'])for(const width of [320,390,768,1440]){
  status='review';const session=broker.provision(binding),{ctx,p}=await setup(lang,width,session);const key='live-'+lang+'-'+width;
  await state(p,'review');await p.locator('img.verified-image').waitFor();await p.waitForFunction(()=>{const i=document.querySelector('img.verified-image');return i?.complete&&i.naturalWidth===64&&i.naturalHeight===32;});
  await layout(p,key,lang);check(key+'/real-png',await p.locator('img.verified-image').getAttribute('src').then(x=>x?.startsWith('blob:')));check(key+'/no-synthetic',await p.locator('[data-preview] svg').count()===0&&!((await p.locator('body').innerText()).includes('LAB-008')));
  check(key+'/cookie',await p.evaluate(()=>document.cookie===''&&localStorage.length===0&&sessionStorage.length===0));if(width===390||width===1440)await capture(p,key+'-review');
  for(const next of ['waiting','approved','refused','expired','replaced','locked']){status=next;const refresh=p.locator('.runtime-refresh');await refresh.focus();await p.keyboard.press('Enter');await state(p,next);check(key+'/'+next+'/keyboard-focus',await refresh.evaluate(b=>document.activeElement===b));check(key+'/'+next+'/no-image',await p.locator('[data-preview],img.verified-image').count()===0);await layout(p,key+'/'+next,lang);}
  status='review';await p.locator('.runtime-refresh').click();await state(p,'review');await p.locator('img.verified-image').waitFor();session.revoke();await p.locator('.runtime-refresh').click();await state(p,'unavailable');check(key+'/revoked',await p.locator('[data-preview],img.verified-image').count()===0);if(width===390||width===1440)await capture(p,key+'-revoked');await ctx.close();
 }
 const before=reads,{ctx,p}=await setup('fr',390);await state(p,'unavailable');check('foreign/no-preview',await p.locator('[data-preview]').count()===0&&reads===before);await ctx.close();
 check('captures',captures.length===64);
}finally{for(const ctx of contexts)await ctx.close().catch(()=>{});await browser.close();await broker.close();writeFileSync(join(out,'j08-r2-report.json'),JSON.stringify({sha:process.env.GITHUB_SHA,checks,captures},null,2));console.log('J08_R2_RESULT '+JSON.stringify({passed:checks.filter(x=>x.pass).length,total:checks.length,captures:captures.length}));}
