import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from 'file:///tmp/panokit-playwright/node_modules/playwright/index.mjs';
const out=process.env.J02_EVIDENCE,origin='http://127.0.0.1:3000';assert(out);mkdirSync(out,{recursive:true});
const b=await chromium.launch({headless:true}),report=[];
try{
 for(const width of [320,375,390,414,768,1024,1440]){
  const mobile=width<=600,height=mobile?844:1000,record=width===390||width===1440;
  const c=await b.newContext({viewport:{width,height},deviceScaleFactor:1,isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce',...(record?{recordVideo:{dir:join(out,'raw'),size:{width,height}}}:{})});
  const p=await c.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.name));
  await c.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  try{
   assert.equal((await p.goto(origin+'/ar',{waitUntil:'networkidle'})).status(),200);
   await p.waitForFunction(()=>document.documentElement.lang==='ar'&&document.documentElement.dir==='rtl');
   await p.locator('.card-artwork.has-photo').first().waitFor();
   const q=await p.evaluate(()=>{const c=[...document.querySelectorAll('.category-title-row')],a=[...document.querySelectorAll('.category-card')],r=a.map(x=>x.getBoundingClientRect()),nav=document.querySelector('.site-header-inner');return {lang:document.documentElement.lang,dir:document.documentElement.dir,title:document.title,cards:a.length,icons:document.querySelectorAll('[data-family-icon]').length,atlas:document.querySelectorAll('.card-artwork.has-photo').length,columns:getComputedStyle(document.querySelector('.category-grid')).gridTemplateColumns.split(' ').length,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,headerFits:nav.scrollWidth<=nav.clientWidth+1,labelsFit:c.every(x=>x.scrollWidth<=x.clientWidth+1),minTouch:Math.min(...c.map(x=>x.getBoundingClientRect().height)),rtlOrder:r[0].left>r[1].left,labels:c.map(x=>x.innerText.trim())};});
   assert.equal(q.lang,'ar');assert.equal(q.dir,'rtl');assert.match(q.title,/اللافتات/);assert.equal(q.cards,6);assert.equal(q.icons,6);assert.equal(q.atlas,6);assert.equal(q.columns,width>900?3:2);assert(q.overflow<=1&&q.headerFits&&q.labelsFit&&q.minTouch>=44&&q.rtlOrder);assert(q.labels.every(x=>/[\u0600-\u06ff]/.test(x)));
   await p.screenshot({path:join(out,'ar-'+width+'.jpeg'),type:'jpeg',quality:92,fullPage:true,animations:'disabled'});
   const card=p.locator('.category-card').first(),btn=card.locator('.category-title-row');
   if(record){
    await p.waitForTimeout(1000);
    if(mobile){const toggle=p.locator('.mobile-menu-toggle');await toggle.tap();assert.equal(await toggle.getAttribute('aria-expanded'),'true');assert.equal(await p.locator('.mobile-nav a').count(),5);await p.waitForTimeout(750);await toggle.tap();await p.locator('.mobile-hero-action').tap();}
    else await p.locator('.desktop-nav a').first().click();
    await p.waitForTimeout(650);
   }
   if(mobile)await btn.tap();else{await btn.focus();await btn.press('Enter');}
   assert.equal(await btn.getAttribute('aria-expanded'),'true');const links=card.locator('.family-option');assert.equal(await links.count(),2);assert.equal(await links.first().getAttribute('href'),'/catalogue/enseignes?categorie=lumineuses');assert.match(await links.first().innerText(),/مضيئة/);
   if(record){await p.waitForTimeout(1100);await p.locator('.site-footer').scrollIntoViewIfNeeded();await p.waitForTimeout(800);}
   await p.locator('.home-language-switch').click();await p.waitForURL(origin+'/');await p.waitForFunction(()=>document.documentElement.lang==='fr'&&document.documentElement.dir==='ltr');
   assert.match(await p.locator('h1').innerText(),/Avoir son enseigne/);
   await p.locator('.home-language-switch').click();await p.waitForURL(origin+'/ar');await p.waitForFunction(()=>document.documentElement.dir==='rtl');
   assert.deepEqual(errors,[]);report.push({width,...q,status:'PASS'});console.log('J02_AR '+JSON.stringify(report.at(-1)));
  }finally{const v=p.video();await c.close();if(v)await v.saveAs(join(out,'ar-'+width+'.webm'));}
 }
 const c=await b.newContext({viewport:{width:1440,height:1000}}),p=await c.newPage();
 await p.goto(origin+'/ar',{waitUntil:'networkidle'});
 const card=p.locator('.category-card').first();await card.hover();await card.locator('.family-option').first().click();await p.waitForURL('**/catalogue/enseignes?categorie=lumineuses');assert.match(await p.locator('h1').innerText(),/Enseignes/i);assert.equal(await p.locator('html').getAttribute('lang'),'fr');
 await c.close();console.log('J02_AR_CATALOGUE_HANDOFF PASS');
}finally{await b.close();writeFileSync(join(out,'ar-report.json'),JSON.stringify({scope:'Arabic homepage only; catalogue remains French',viewports:report},null,2)+'\n');}
