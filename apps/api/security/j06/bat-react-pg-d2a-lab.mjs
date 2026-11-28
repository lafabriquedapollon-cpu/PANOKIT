import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from '/tmp/panokit-playwright/node_modules/playwright/index.mjs';

// Only invoked by the disposable PG17 harness. No synthetic adapter or intercepted
// BAT POST. The callback performs the original real SQL replacement assertions.
export async function runPgReactD2({broker,binding,otherSession,previewDigest,replace}){
 const origin=process.env.J08_D2_REACT_ORIGIN,out=process.env.J08_D2_EVIDENCE;
 assert.equal(origin,'http://127.0.0.1:39178');assert(out);
 const browser=await chromium.launch({headless:true}),contexts=[],checks=[],captures=[];
 const check=(name,ok)=>{checks.push({name,pass:!!ok});assert.ok(ok,name);};
 const capture=async(p,name)=>{await p.evaluate(()=>document.fonts.ready);const file='d2a-'+name+'.png';await p.screenshot({path:join(out,file),fullPage:true,animations:'disabled'});captures.push(file);};
 const state=(p,s)=>p.locator('[data-testid=j08-r2][data-state="'+s+'"]').waitFor({state:'visible'});
 async function setup(lang,width,session){
  const ctx=await browser.newContext({viewport:{width,height:844}});contexts.push(ctx);
  if(session){const pair=session.cookie.split(';')[0],i=pair.indexOf('=');await ctx.addCookies([{name:pair.slice(0,i),value:pair.slice(i+1),domain:'127.0.0.1',path:'/bat',httpOnly:true,sameSite:'Strict',secure:false}]);}
  const p=await ctx.newPage();
  await p.route(u=>u.origin===broker.origin&&(u.pathname==='/bat/react-proof'||u.pathname.startsWith('/_next/')),async route=>{
   const u=new URL(route.request().url()),headers={...route.request().headers()};delete headers.cookie;delete headers.authorization;delete headers.host;
   const response=await route.fetch({url:origin+u.pathname+u.search,headers,maxRedirects:0});await route.fulfill({response});
  });
  await p.goto(broker.origin+'/bat/react-proof?lang='+lang,{waitUntil:'domcontentloaded'});return {p,ctx};
 }
 const noImage=p=>p.locator('[data-preview],img.verified-image').count().then(n=>n===0);
 try{
  const active=[];
  for(const lang of ['fr','ar'])for(const width of [390,1440]){
   const key=lang+'-'+width,session=broker.provision(binding),{p,ctx}=await setup(lang,width,session);
   await state(p,'review');await p.locator('img.verified-image').waitFor();
   await p.waitForFunction(()=>{const i=document.querySelector('img.verified-image');return i?.complete&&i.naturalWidth===64&&i.naturalHeight===32;});
   const facts=await p.evaluate(async()=>{
    const root=document.querySelector('[data-testid=j08-r2]'),i=root.querySelector('img.verified-image');
    const bytes=await (await fetch(i.src)).arrayBuffer();
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
    return {digest,dir:root.dir,lang:root.lang,version:[...root.querySelectorAll('bdi')].map(x=>x.textContent),width:innerWidth,scroll:document.documentElement.scrollWidth,cookie:document.cookie,storage:localStorage.length+sessionStorage.length,actions:[...root.querySelectorAll('button,input,textarea')].filter(x=>!x.disabled&&!x.matches('.runtime-refresh')).length};
   });
   check(key+'/pg-exact-png',facts.digest===previewDigest);
   check(key+'/version',facts.version.includes('V'+String(binding.version).padStart(2,'0')));
   check(key+'/layout',facts.width+1>=facts.scroll&&facts.lang===lang&&facts.dir===(lang==='ar'?'rtl':'ltr'));
   check(key+'/readonly-and-private',facts.actions===0&&facts.cookie===''&&facts.storage===0);
   const toolbar=await p.getByTestId('j08-runtime-toolbar').evaluate(el=>{const b=el.querySelector('button'),r=b.getBoundingClientRect();return {height:r.height,bottom:r.bottom,viewport:innerHeight,position:el.previousElementSibling?.tagName==='HEADER'&&el.nextElementSibling?.tagName==='MAIN',count:el.querySelectorAll('button').length};});
   check(key+'/toolbar',toolbar.position&&toolbar.count===1&&toolbar.height>=48&&toolbar.bottom<=toolbar.viewport);
   await capture(p,key+'-review');active.push({key,p,ctx,session});
  }
  for(const [key,session] of [['no-cookie',undefined],['wrong-pg-session',broker.provision({...binding,sourceSession:otherSession})]]){
   const {p,ctx}=await setup('fr',390,session);await state(p,'unavailable');check(key,await noImage(p));await ctx.close();
  }
  await replace();
  for(const {key,p,session,ctx} of active){
   await p.locator('.runtime-refresh').focus();await p.keyboard.press('Enter');await state(p,'replaced');check(key+'/focus-retained',await p.locator('.runtime-refresh').evaluate(b=>document.activeElement===b));check(key+'/sql-replaced-no-png',await noImage(p));await capture(p,key+'-replaced');
   session.revoke();await p.locator('.runtime-refresh').click();await state(p,'unavailable');check(key+'/revoked-no-png',await noImage(p));await capture(p,key+'-revoked');await ctx.close();
  }
  check('twelve-captures',captures.length===12);assert.equal(checks.length,35);
 }finally{
  for(const ctx of contexts)await ctx.close().catch(()=>{});await browser.close();
  writeFileSync(join(out,'j08-d2a-report.json'),JSON.stringify({sha:process.env.GITHUB_SHA,checks,captures},null,2));
  console.log('J08_D2A_RESULT '+JSON.stringify({passed:checks.filter(x=>x.pass).length,total:checks.length,captures:captures.length}));
 }
}
