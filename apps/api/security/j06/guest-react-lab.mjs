import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {startGuestUiLab} from './guest-ui-broker.mjs';
export async function runGuestReactLab({browser,domain,connect,fixture,preview,admin,out}){
 const lab=await startGuestUiLab({domain,connect,fixture,preview,reactLabOrigin:process.env.J07_REACT_ORIGIN});
 const contexts=[],checks=[],captures=[];
 const check=(name,ok)=>{checks.push({name,pass:!!ok});assert.ok(ok,name);};
 const state=(p,value)=>p.locator('[data-testid=j07-lab][data-stage='+value+']').waitFor();
 const amount=(p)=>p.getByTestId('j07-total').innerText();
 const mainAction=p=>p.locator('[data-main-action]');
 const count=async()=>Number((await admin.query('select count(*)::int as n from j06_private.guest_admissions')).rows[0].n);
 const consentCount=async()=>Number((await admin.query('select count(*)::int as n from j06_private.guest_visual_consents')).rows[0].n);
 const before=await count(),consentsBefore=await consentCount();
 async function capture(p,key,stage){
  await state(p,stage);await p.evaluate(()=>document.fonts.ready);
  const file='j07-react-'+key+'-'+stage+'.png';await p.screenshot({path:join(out,file),fullPage:true,animations:'disabled'});captures.push(file);
 }
 async function setup(lang,width){
  const ctx=await browser.newContext({viewport:{width,height:844}});contexts.push(ctx);const p=await ctx.newPage();
  await p.goto(lab.origin+'/j07-lab');await p.locator('#studio-name').waitFor();
  // A real edit proves hydration; no static screenshot can satisfy this.
  if(lang==='ar')await p.locator('.studio-language button').nth(1).click();
  const label=lang==='ar'?'محل تجريبي':'LAB DEMO FR';
  await p.locator('#studio-name').fill(label);
  await p.locator('.studio-template').nth(2).click();
  await p.locator('.studio-views button').first().click();
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
  check('fr/contact-durable',await count()===before+1);check('fr/review-gate',await mainAction(p).isDisabled());check('fr/preview-still-exact',await p.getByTestId('j07-preview').locator('svg').evaluate(x=>x.outerHTML)===fr.svg);
  check('fr/no-pii-in-url-storage',await p.evaluate(()=>!location.href.includes('Client')&&!location.href.includes('0600000000')&&localStorage.length===0&&sessionStorage.length===0));
  await capture(p,'fr-1440','review');
  const ar=await setup('ar',390),q=ar.p;
  await select(q,'delivery');check('ar/delivery-fields',await q.locator('#j07-city[required],#j07-address[required]').count()===2);check('ar/server-total',(await amount(q)).replace(/\s/g,'')==='1,35MAD');
  await layout(q,'ar-390');await capture(q,'ar-390','coordinates');
  await contact(q,'delivery');await q.locator('#j07-phone').fill('٠٦٠٠٠٠٠٠٠٠');await mainAction(q).click();await state(q,'review');
  check('ar/contact-durable',await count()===before+2);check('ar/review-gate',await mainAction(q).isDisabled());check('ar/preview-still-exact',await q.getByTestId('j07-preview').locator('svg').evaluate(x=>x.outerHTML)===ar.svg);
  await capture(q,'ar-390','review');check('no-consent-mismatched-master',await consentCount()===consentsBefore);
  const route=await q.evaluate(async()=>{const r=await fetch('/preview.svg');return r.status;});check('fixed-master-denied',route===403);
  check('six-captures',captures.length===6);
 }finally{for(const ctx of contexts)await ctx.close();await lab.close();writeFileSync(join(out,'j07-react-report.json'),JSON.stringify({checks,captures},null,2));console.log('J07_REACT_RESULT '+JSON.stringify({passed:checks.filter(x=>x.pass).length,total:checks.length,captures:captures.length}));}
}
