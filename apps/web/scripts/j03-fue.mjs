import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from 'file:///tmp/panokit-playwright/node_modules/playwright/index.mjs';
const out=process.env.J03_EVIDENCE,origin='http://127.0.0.1:3000';assert(out);mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true}),report=[];
const models=['lettres-frontales','lettres-retroeclairees','caisson-rectangulaire','neon-led-flexible'];
async function shot(p,name){await p.evaluate(()=>document.fonts.ready);await p.screenshot({path:join(out,name+'.jpeg'),type:'jpeg',quality:92,fullPage:true,animations:'disabled'})}
async function checkLocale(p,locale){assert.equal(await p.locator('.j03-main').getAttribute('lang'),locale);assert.equal(await p.locator('.j03-main').getAttribute('dir'),locale==='ar'?'rtl':'ltr');assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))}
async function step(p,loc,mobile){await loc.scrollIntoViewIfNeeded();if(mobile)await loc.tap();else await loc.click();await p.waitForTimeout(850)}
try{
for(const locale of ['fr','ar'])for(const width of [390,1440]){
 const mobile=width===390,height=mobile?844:1000,key=locale+'-'+width;
 const ctx=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce',recordVideo:{dir:join(out,'raw'),size:{width,height}}});
 const p=await ctx.newPage();const errors=[],external=[];p.on('pageerror',e=>errors.push(e.name));
 await ctx.route('**/*',r=>{if(new URL(r.request().url()).origin!==origin){external.push(new URL(r.request().url()).origin);return r.abort()}return r.continue()});
 try{
  const home=origin+(locale==='ar'?'/ar':'/');
  assert.equal((await p.goto(home,{waitUntil:'networkidle'})).status(),200);
  await p.locator('.card-artwork.has-photo').first().waitFor();assert.equal(await p.locator('.category-card').count(),6);await shot(p,key+'-01-home');await p.waitForTimeout(1000);
  const first=p.locator('.category-card').first();
  if(mobile)await first.locator('.category-title-row').tap();else await first.hover();
  assert.equal(await first.locator('.category-title-row').getAttribute('aria-expanded'),'true');
  await step(p,first.locator('.family-option').first(),mobile);
  await p.waitForURL(u=>u.pathname==='/catalogue/enseignes');await checkLocale(p,locale);
  assert.equal(await p.locator('.j03-family-card--disabled a').count(),0);await shot(p,key+'-02-family');
  await step(p,p.locator('.j03-family-card[href*="/lumineuses"]'),mobile);await p.waitForURL(u=>u.pathname.endsWith('/lumineuses'));await checkLocale(p,locale);
  assert.equal(await p.locator('.j03-model-card').count(),4);
  assert.deepEqual(await p.locator('.j03-model-card__link').evaluateAll(a=>a.map(x=>new URL(x.href).pathname.split('/').pop())),models);
  await p.locator('.j03-art__image').first().waitFor();await p.evaluate(async()=>await Promise.all([...document.querySelectorAll('.j03-art__image')].map(img=>img.decode())));
  await shot(p,key+'-03-gallery');await p.waitForTimeout(1300);
  await step(p,p.locator('.j03-model-card__link[href*="caisson-rectangulaire"]'),mobile);await p.waitForURL(u=>u.pathname.endsWith('/caisson-rectangulaire'));await checkLocale(p,locale);
  assert.equal(await p.locator('.j03-action').isDisabled(),true);await shot(p,key+'-04-activity-empty');
  await p.locator('input[value="liberal"]').check();assert.equal(await p.locator('.j03-action').isDisabled(),true);
  await p.locator('.j03-activity-select').selectOption('chirurgien-dentiste');assert.equal(await p.locator('.j03-action').isEnabled(),true);
  await shot(p,key+'-05-activity-selected');await p.waitForTimeout(900);
  await step(p,p.locator('.j03-action'),mobile);
  assert.equal(await p.locator('.j03-no-format').count(),1);assert.equal(await p.locator('.j03-form-panel a[href*="studio"],.j03-form-panel a[href*="devis"]').count(),0);
  assert.match(await p.locator('.j03-activity-summary').innerText(),locale==='ar'?/أسنان/:/Chirurgien-dentiste/);
  await shot(p,key+'-06-blocked');await p.waitForTimeout(1800);
  await step(p,p.locator('.j03-back'),mobile);assert.equal(await p.locator('.j03-activity-select').inputValue(),'chirurgien-dentiste');
  await step(p,p.locator('.j03-return__link'),mobile);await p.waitForURL(home);assert.equal(await p.locator('.category-card').count(),6);await p.waitForTimeout(800);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);report.push({key,status:'PASS',steps:6,scope:'model/activity selected; format blocked; no order or connected DB'});console.log('J03_FUE '+JSON.stringify(report.at(-1)));
 }finally{const v=p.video();await ctx.close();await v.saveAs(join(out,key+'.webm'));}
}
const p=await browser.newPage();
for(const locale of ['fr','ar']){
 for(const family of ['drapeaux','signaletique','plv','impression','habillage']){
  assert.equal((await p.goto(origin+'/catalogue/'+family+'?lang='+locale)).status(),200);await checkLocale(p,locale);
  assert.equal(await p.locator('.j03-family-card,.j03-model-card,.j03-action').count(),0);assert(await p.locator('.j03-disclaimer').isVisible());
 }
 for(const model of models){
  assert.equal((await p.goto(origin+'/catalogue/enseignes/lumineuses/'+model+'?lang='+locale)).status(),200);await checkLocale(p,locale);
  await p.locator('input[value="other"]').check();assert.equal(await p.locator('.j03-action').isDisabled(),true);await p.locator('.j03-other input').fill('TEST_ONLY');await p.locator('.j03-action').click();assert(await p.locator('.j03-no-format').isVisible());assert.equal(await p.locator('.j03-form-panel a[href*="studio"],.j03-form-panel a[href*="devis"]').count(),0);
 }
}
await p.close();console.log('J03_FUE_NEGATIVE PASS 10 inactive family pages + 8 model blocked scenarios');assert.equal(report.length,4);
}finally{await browser.close();writeFileSync(join(out,'fue-report.json'),JSON.stringify({scope:'actual existing catalogue UI; LAB PG separate, no commercial transaction',report},null,2)+'\n')}
