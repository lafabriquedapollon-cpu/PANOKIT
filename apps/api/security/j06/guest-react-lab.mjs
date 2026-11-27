import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {startGuestUiLab} from './guest-ui-broker.mjs';
export async function runGuestReactLab({browser,domain,connect,fixture,preview,admin,out}){
 const require=createRequire(import.meta.url);
 const {renderConfiguredLabVisual}=require(process.env.J07_RENDERER);
 const masters={jour:'data:image/svg+xml;base64,'+Buffer.from(preview).toString('base64'),nuit:'data:image/svg+xml;base64,'+readFileSync(process.env.J07_MASTER_NIGHT).toString('base64')};
 const renderVisual=config=>renderConfiguredLabVisual(config,masters);
 const sharp=createRequire(process.env.J07_RENDERER)('sharp');
 const lab=await startGuestUiLab({domain,connect,fixture,preview,reactLabOrigin:process.env.J07_REACT_ORIGIN,renderVisual});
 const contexts=[],checks=[],captures=[];
 const check=(name,ok)=>{checks.push({name,pass:!!ok});assert.ok(ok,name);};
 const state=(p,value)=>p.locator('[data-testid=j07-lab][data-stage='+value+']').waitFor();
 const amount=(p)=>p.getByTestId('j07-total').innerText();
 const mainAction=p=>p.locator('[data-main-action]');
 const count=async()=>Number((await admin.query('select count(*)::int as n from j06_private.guest_admissions')).rows[0].n);
 const consentCount=async()=>Number((await admin.query('select count(*)::int as n from j06_private.guest_visual_consents')).rows[0].n);
 const before=await count(),consentsBefore=await consentCount();
 const archiveCount=async()=>Number((await admin.query('select count(*)::int as n from j06_private.guest_visual_archive')).rows[0].n);
 const archivesBefore=await archiveCount();
 const archived=async(hash)=>{const r=await admin.query('select svg_bytes,visual_digest from j06_private.guest_visual_archive where visual_digest=$1',[hash]);return r.rows.length===1&&createHash('sha256').update(r.rows[0].svg_bytes).digest('hex')===hash;};
 const manifestBytes=async(p,svg)=>{
  const result=await p.evaluate(async original=>{
   const r=await fetch('/preview.svg'),server=await r.text();
   const doc=new DOMParser().parseFromString(server,'image/svg+xml');
   const src=new DOMParser().parseFromString(original,'text/html').querySelector('svg');
   const canon=node=>node?{tag:node.localName,attrs:[...node.attributes].filter(a=>a.name!=='xmlns').map(a=>[a.name,a.value]).sort((a,b)=>a[0].localeCompare(b[0])),children:[...node.childNodes].filter(n=>n.nodeType===1||n.nodeType===3).map(n=>n.nodeType===3?n.textContent:canon(n))}:null;
   return {status:r.status,server,same:JSON.stringify(canon(doc.documentElement))===JSON.stringify(canon(src))};
  },svg);
  assert.equal(result.status,200);return {same:result.same,hash:createHash('sha256').update(result.server).digest('hex')};
 };
 const lastHash=async()=>String((await admin.query("select visual_digest from j06_private.guest_visual_consents order by recorded_at desc limit 1")).rows[0].visual_digest);
 const visualReady=async(p)=>{await p.getByTestId('j07-server-visual').waitFor();await p.waitForFunction(()=>{const x=document.querySelector('[data-testid=j07-server-visual]');return x?.complete&&x.naturalWidth>0&&!document.querySelector('[data-main-action]')?.disabled;});};
 async function capture(p,key,stage){
  await state(p,stage);await p.evaluate(()=>document.fonts.ready);
  const file='j07-react-'+key+'-'+stage+'.png';await p.screenshot({path:join(out,file),fullPage:true,animations:'disabled'});captures.push(file);
 }
 async function setup(lang,width,variant='plat',suffix=''){
  const ctx=await browser.newContext({viewport:{width,height:844}});contexts.push(ctx);const p=await ctx.newPage();
  await p.goto(lab.origin+'/j07-lab');await p.locator('#studio-name').waitFor();
  // A real edit proves hydration; no static screenshot can satisfy this.
  if(lang==='ar')await p.locator('.studio-language button').nth(1).click();
  const label=(lang==='ar'?'محل تجريبي':'LAB DEMO FR')+suffix;
  await p.locator('#studio-name').fill(label);
  await p.locator('.studio-template').nth(2).click();
  await p.locator('.studio-views button').nth({plat:0,jour:1,nuit:2}[variant]).click();
  await p.locator('.studio-main-sign-scroll [data-studio-name=line]').filter({hasText:label}).waitFor();
  const svg=await p.locator('.studio-main-sign-scroll svg').evaluate(x=>x.outerHTML);
  await p.locator('#studio-price-review').click();await state(p,'selection');
  const actual=await p.getByTestId('j07-preview').locator('svg').evaluate(x=>x.outerHTML);
  check(lang+'/same-configured-svg',svg===actual);
  check(lang+'/locale',await p.getByTestId('j07-lab').getAttribute('dir')===(lang==='ar'?'rtl':'ltr'));
  return {p,ctx,svg};
 }
 async function select(p,mode){
  await p.getByTestId('j07-select-'+mode).click();await state(p,'coordinates');
 }
 async function layout(p,key){
  const m=await p.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,actions:[...document.querySelectorAll('[data-main-action]')].filter(x=>x.getBoundingClientRect().height>0).map(x=>x.getBoundingClientRect().height),fields:[...document.querySelectorAll('input,textarea')].filter(x=>x.getBoundingClientRect().height>0).map(x=>({height:x.getBoundingClientRect().height,label:!!document.querySelector('label[for="'+x.id+'"]')})),mobile:document.querySelector('[data-testid=j07-mobile-total]')?.textContent,total:document.querySelector('[data-testid=j07-total]')?.textContent}));
  check(key+'/reflow',m.scroll<=m.width+1);check(key+'/one-action',m.actions.length===1&&m.actions[0]>=44);
  check(key+'/targets',m.fields.every(x=>x.height>=44&&x.label));if(m.width<=760)check(key+'/mobile-total',m.mobile===m.total);
 }
 async function contact(p,mode){
  await p.locator('#j07-name').fill('Client Test');await p.locator('#j07-phone').fill('0600000000');
  if(mode==='delivery'){await p.locator('#j07-city').fill('Ville Test');await p.locator('#j07-address').fill('12 rue Exemple');}
 }
 try{
  const base={data:{name:'LAB DEMO',activity:'',phone:'',slogan:'',logo:null},template:1,view:'plat',palette:{board:'#204947',night:'#16413e',lettering:'#fff9ef',accent:'#f49b48'},lang:'fr',defaultBoard:true};
  check('renderer/flat',(await renderVisual(base))?.includes('LAB DEMO'));
  check('renderer/day-embedded',(await renderVisual({...base,view:'jour'}))?.includes(masters.jour));
  check('renderer/night-embedded',(await renderVisual({...base,view:'nuit'}))?.includes(masters.nuit));
  check('renderer/deny-logo',await renderVisual({...base,data:{...base.data,logo:'data:image/png;base64,AA=='}})===null);
  check('renderer/deny-href',await renderVisual({...base,href:'https://example.invalid'})===null);
  check('renderer/escaped-text',!(await renderVisual({...base,data:{...base.data,name:'<script>test</script>'}}))?.includes('<script>'));
  check('renderer/deny-adaptation',await renderVisual({...base,data:{...base.data,name:'a'.repeat(50)}})===null);
  const png=await sharp({create:{width:64,height:32,channels:3,background:'#e77924'}}).png().toBuffer();
  const jpeg=await sharp(png).jpeg().toBuffer();
  const pngLogo='data:image/png;base64,'+png.toString('base64'),jpegLogo='data:image/jpeg;base64,'+jpeg.toString('base64');
  for(const [format,logo] of [['png',pngLogo],['jpeg',jpegLogo]]){const svg=await renderVisual({...base,template:2,data:{...base.data,logo}});check('renderer/normalized-'+format,!!svg&&svg.includes('data:image/png;base64,')&&!svg.includes('data:image/jpeg;base64,'));}
  check('renderer/deny-external-logo',await renderVisual({...base,template:2,data:{...base.data,logo:'https://example.invalid/logo.png'}})===null);
  check('renderer/deny-svg-logo',await renderVisual({...base,template:2,data:{...base.data,logo:'data:image/svg+xml;base64,PHN2Zy8+'}})===null);
  check('renderer/deny-mismatched-mime',await renderVisual({...base,template:2,data:{...base.data,logo:'data:image/jpeg;base64,'+png.toString('base64')}})===null);
  check('renderer/deny-truncated-png',await renderVisual({...base,template:2,data:{...base.data,logo:'data:image/png;base64,'+png.subarray(0,20).toString('base64')}})===null);
  const fr=await setup('fr',1440),p=fr.p;
  await select(p,'pickup');check('fr/pickup-fields',await p.locator('#j07-city,#j07-address').count()===0);check('fr/server-total',(await amount(p)).replace(/\s/g,'')==='1,26MAD');
  await layout(p,'fr-1440');await capture(p,'fr-1440','coordinates');
  await mainAction(p).click();await p.locator('#j07-name[aria-invalid=true]').waitFor();check('fr/server-errors',await p.locator('#j07-phone').getAttribute('aria-invalid')==='true');
  const errorFile='j07-react-fr-1440-error.png';await p.screenshot({path:join(out,errorFile),fullPage:true,animations:'disabled'});captures.push(errorFile);
  check('fr/no-invalid-write',await count()===before);
  // Expire exactly the most recently issued guest lease in the isolated fixture database.
  const expired=await admin.query("with target as (select token_hash from j06_private.leases where guest_session_hash is not null order by issued_at desc limit 1), now_value as (select clock_timestamp()-interval '16 minutes' as t) update j06_private.leases l set issued_at=n.t,expires_at=n.t+interval '15 minutes' from target x,now_value n where l.token_hash=x.token_hash returning l.token_hash");
  assert.equal(expired.rowCount,1);
  await contact(p,'pickup');await mainAction(p).click();await state(p,'stale');
  check('fr/stale-no-amount',await p.locator('[data-amount]').count()===0);check('fr/stale-no-write',await count()===before);await capture(p,'fr-1440','stale');
  await mainAction(p).click();await state(p,'coordinates');check('fr/recalculated',(await amount(p)).replace(/\s/g,'')==='1,26MAD');
  await contact(p,'pickup');await mainAction(p).click();await state(p,'review');
  check('fr/contact-durable',await count()===before+1);await visualReady(p);const frProof=await manifestBytes(p,fr.svg);check('fr/server-render-equals-studio',frProof.same);
  check('fr/no-pii-in-url-storage',await p.evaluate(()=>!location.href.includes('Client')&&!location.href.includes('0600000000')&&localStorage.length===0&&sessionStorage.length===0));
  await capture(p,'fr-1440','review');await mainAction(p).click();await state(p,'acknowledged');check('fr/consent-durable',await consentCount()===consentsBefore+1);check('fr/consent-exact-bytes',await lastHash()===frProof.hash);check('fr/archive-exact-bytes',await archived(frProof.hash));await capture(p,'fr-1440','acknowledged');
  const ar=await setup('ar',390),q=ar.p;
  await select(q,'delivery');check('ar/delivery-fields',await q.locator('#j07-city[required],#j07-address[required]').count()===2);check('ar/server-total',(await amount(q)).replace(/\s/g,'')==='1,35MAD');
  await layout(q,'ar-390');await capture(q,'ar-390','coordinates');
  await contact(q,'delivery');await q.locator('#j07-phone').fill('٠٦٠٠٠٠٠٠٠٠');await mainAction(q).click();await state(q,'review');
  check('ar/contact-durable',await count()===before+2);await visualReady(q);const arProof=await manifestBytes(q,ar.svg);check('ar/server-render-equals-studio',arProof.same);check('ar/distinct-visual',arProof.hash!==frProof.hash);
  await capture(q,'ar-390','review');
  const forged=await q.evaluate(async()=>{const r=await fetch('/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'visual',accepted:true,visualVersion:'lab-config-v1',visualDigest:'0'.repeat(64),statementVersion:'lab-visual-v1'})});return r.status;});
  check('ar/forged-digest-denied',forged===400);check('no-forged-consent',await consentCount()===consentsBefore+1);
  await mainAction(q).click();await state(q,'acknowledged');check('ar/consent-durable',await consentCount()===consentsBefore+2);check('ar/consent-exact-bytes',await lastHash()===arProof.hash);check('ar/archive-exact-bytes',await archived(arProof.hash));await capture(q,'ar-390','acknowledged');
  const logoCtx=await browser.newContext({viewport:{width:390,height:844}});contexts.push(logoCtx);const lp=await logoCtx.newPage();await lp.goto(lab.origin+'/j07-lab');
  await lp.locator('#studio-name').fill('LAB LOGO');await lp.locator('#studio-logo-panel summary').click();await lp.locator('#studio-logo').setInputFiles({name:'fixture.jpg',mimeType:'image/jpeg',buffer:jpeg});
  await lp.locator('.studio-main-sign-scroll [data-studio-logo=true]').waitFor({state:'attached'});
  await lp.locator('.studio-views button').first().click();await lp.locator('#studio-price-review').click();await state(lp,'selection');await select(lp,'pickup');await contact(lp,'pickup');await mainAction(lp).click();await state(lp,'review');await visualReady(lp);
  const logoBytes=await lp.evaluate(async()=>await (await fetch('/preview.svg')).text()),logoHash=createHash('sha256').update(logoBytes).digest('hex');
  check('logo/server-normalized-image',logoBytes.includes('data:image/png;base64,')&&!logoBytes.includes('data:image/jpeg;base64,'));
  await capture(lp,'logo-390','review');await mainAction(lp).click();await state(lp,'acknowledged');check('logo/archive-exact-bytes',await archived(logoHash));await capture(lp,'logo-390','acknowledged');
  check('archive/three-configured-only',await archiveCount()===archivesBefore+3);
  const c=await browser.newContext();contexts.push(c);const z=await c.newPage();await z.goto(lab.origin+'/j07-lab');const route=await z.evaluate(async()=>{const r=await fetch('/preview.svg');return r.status;});check('foreign-preview-denied',route===403);
  check('ten-captures',captures.length===10);
  // D2: exercise the approved four states and the two downstream screens at every width/locale.
  const matrix={checks:[],captures:[],measurements:[]};
  const audit=(name,ok)=>{matrix.checks.push({name,pass:!!ok});assert.ok(ok,name);};
  async function evidence(p,key,expected,screen){
   await state(p,expected);await p.evaluate(()=>document.fonts.ready);
   const m=await p.evaluate(()=>{
    const root=document.querySelector('[data-testid=j07-lab]'),action=root.querySelector('[data-main-action]'),preview=root.querySelector('[data-testid=j07-preview]'),mobile=root.querySelector('[data-testid=j07-mobile-total]'),total=root.querySelector('[data-testid=j07-total]');
    const rect=e=>e?{top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom,height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width}:null;
    const luminance=c=>{const v=c.match(/[0-9.]+/g)?.slice(0,3).map(x=>Number(x)/255);return v?.map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0)??0;};
    const contrast=e=>{const style=getComputedStyle(e),a=luminance(style.color),b=luminance(style.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
    return {lang:root.lang,dir:root.dir,width:innerWidth,scroll:document.documentElement.scrollWidth,heading:root.querySelectorAll('h1').length,actionCount:root.querySelectorAll('[data-main-action]').length,action:rect(action),actionContrast:action?contrast(action):0,preview:rect(preview),mobile:mobile?.textContent,total:total?.textContent,fields:[...root.querySelectorAll('input,textarea')].map(e=>({height:rect(e).height,label:!!root.querySelector('label[for="'+e.id+'"]'),described:!e.getAttribute('aria-describedby')||!!document.getElementById(e.getAttribute('aria-describedby')),invalid:e.getAttribute('aria-invalid')==='true'})),amounts:root.querySelectorAll('[data-amount]').length,image:root.querySelector('[data-testid=j07-server-visual]')?.naturalWidth??0};
   });
   matrix.measurements.push({key,screen,...m});
   audit(key+'/'+screen+'/reflow',m.scroll<=m.width+1);audit(key+'/'+screen+'/heading',m.heading===1);audit(key+'/'+screen+'/action',m.actionCount===1&&m.action.height>=44&&m.actionContrast>=4.5);
   audit(key+'/'+screen+'/labels-targets',m.fields.every(f=>f.label&&f.described&&f.height>=44));
   if(m.width<=760&&(screen==='pickup'||screen==='delivery'||screen==='error')){audit(key+'/'+screen+'/mobile-total',m.mobile===m.total);audit(key+'/'+screen+'/form-before-detail',m.action.bottom<=m.preview.top+1);}
   if(screen==='stale')audit(key+'/stale/no-amount',m.amounts===0);
   if(screen==='review'||screen==='acknowledged'){audit(key+'/'+screen+'/visual-first',m.image>0&&m.preview.bottom<=m.action.top+1);audit(key+'/'+screen+'/reviewed-quote',m.amounts===6&&m.total?.replace(/\s/g,'')==='1,35MAD');}
   const file='j07-d2-'+key+'-'+screen+'.png';await p.screenshot({path:join(out,file),fullPage:true,animations:'disabled'});matrix.captures.push(file);
  }
  try{
   for(const lang of ['fr','ar'])for(const width of [320,390,768,1440]){
    const key=lang+'-'+width,variant=width===320||width===768?'jour':width===390?'nuit':'plat';
    const {p,ctx}=await setup(lang,width,variant,' '+width);
    try{
     await select(p,'pickup');audit(key+'/pickup/fields',await p.locator('#j07-city,#j07-address').count()===0);await evidence(p,key,'coordinates','pickup');
     await p.locator('button').filter({hasText:lang==='ar'?'العودة إلى عرض السعر':'Retour au devis'}).first().click();await state(p,'selection');
     await select(p,'delivery');audit(key+'/delivery/fields',await p.locator('#j07-city[required],#j07-address[required]').count()===2);await evidence(p,key,'coordinates','delivery');
     await mainAction(p).focus();await p.keyboard.press('Enter');await p.locator('#j07-name[aria-invalid=true]').waitFor();await p.waitForFunction(()=>document.activeElement?.id==='j07-name');audit(key+'/error/focus',await p.locator('#j07-name').getAttribute('aria-describedby')==='j07-name-error');await evidence(p,key,'coordinates','error');
     const expired=await admin.query("with target as (select token_hash from j06_private.leases where guest_session_hash is not null order by issued_at desc limit 1), now_value as (select clock_timestamp()-interval '16 minutes' as t) update j06_private.leases l set issued_at=n.t,expires_at=n.t+interval '15 minutes' from target x,now_value n where l.token_hash=x.token_hash returning l.token_hash");
     audit(key+'/expiry/fixture',expired.rowCount===1);await contact(p,'delivery');await mainAction(p).click();await state(p,'stale');await evidence(p,key,'stale','stale');
     await mainAction(p).click();await state(p,'coordinates');await contact(p,'delivery');await mainAction(p).click();await state(p,'review');await visualReady(p);
     const served=await p.evaluate(async()=>await (await fetch('/preview.svg')).text());
     audit(key+'/review/configured',served.includes(String(width))&&(variant==='plat'||served.includes('data:image/svg+xml;base64,')));
     const hash=createHash('sha256').update(served).digest('hex');await evidence(p,key,'review','review');
     await mainAction(p).focus();await p.keyboard.press('Enter');await state(p,'acknowledged');await visualReady(p);audit(key+'/archive',await archived(hash));await evidence(p,key,'acknowledged','acknowledged');
    }finally{await ctx.close();}
   }
   audit('matrix/48-captures',matrix.captures.length===48);audit('matrix/11-configured-archives',await archiveCount()===archivesBefore+11);
  }finally{writeFileSync(join(out,'j07-d2-report.json'),JSON.stringify({sha:process.env.GITHUB_SHA,...matrix},null,2));console.log('J07_D2_RESULT '+JSON.stringify({passed:matrix.checks.filter(x=>x.pass).length,total:matrix.checks.length,captures:matrix.captures.length}));}

 }finally{for(const ctx of contexts)await ctx.close();await lab.close();writeFileSync(join(out,'j07-react-report.json'),JSON.stringify({checks,captures},null,2));console.log('J07_REACT_RESULT '+JSON.stringify({passed:checks.filter(x=>x.pass).length,total:checks.length,captures:captures.length}));}
}
