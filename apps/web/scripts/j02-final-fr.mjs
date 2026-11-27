import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'file:///tmp/panokit-playwright/node_modules/playwright/index.mjs';
const out=process.env.J02_EVIDENCE;assert(out);
mkdirSync(out,{recursive:true});const origin='http://127.0.0.1:3000';
const browser=await chromium.launch({headless:true});const report=[];
try {
 for(const width of [320,375,390,414,768,1440]){
  const mobile=width<=600,height=mobile?844:1000;
  const ctx=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce',...(width===390||width===1440?{recordVideo:{dir:join(out,'raw'),size:{width,height}}}:{})});
  const p=await ctx.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.name));
  await ctx.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  try{
   const res=await p.goto(origin,{waitUntil:'networkidle'});assert.equal(res.status(),200);
   await p.locator('.card-artwork.has-photo').first().waitFor({timeout:10000});
   await p.evaluate(()=>document.fonts.ready);await p.mouse.move(1,1);
   const data=await p.evaluate(()=>{const h=document.querySelector('h1'),c=[...document.querySelectorAll('.category-title-row')];return {title:document.title,lang:document.documentElement.lang,dir:getComputedStyle(document.documentElement).direction,columns:getComputedStyle(document.querySelector('.category-grid')).gridTemplateColumns.split(' ').length,cards:document.querySelectorAll('.category-card').length,icons:document.querySelectorAll('[data-family-icon]').length,masters:document.querySelectorAll('[data-asset-id]').length,atlas:document.querySelectorAll('.card-artwork.has-photo').length,headlineLines:Math.round(h.getBoundingClientRect().height/parseFloat(getComputedStyle(h).lineHeight)),overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,minTouch:Math.min(...c.map(x=>x.getBoundingClientRect().height)),labelsFit:c.every(x=>x.scrollWidth<=x.clientWidth+1),height:document.documentElement.scrollHeight};});
   await p.screenshot({path:join(out,'fr-'+width+'.jpeg'),type:'jpeg',quality:92,fullPage:true,animations:'disabled'});
   assert.equal(data.cards,6);assert.equal(data.icons,6);assert.equal(data.columns,width>900?3:2);assert(data.overflow<=1);assert(data.labelsFit);assert(data.minTouch>=44);assert.equal(data.masters,0);assert.equal(data.atlas,6);if(mobile)assert.equal(data.headlineLines,2);
   if(width===390||width===1440){
    await p.waitForTimeout(1200);
    if(mobile){const toggle=p.locator('.mobile-menu-toggle');await toggle.tap();assert.equal(await toggle.getAttribute('aria-expanded'),'true');await p.waitForTimeout(900);await toggle.tap();await p.locator('.mobile-hero-action').tap();}
    else{await p.locator('.desktop-nav a').first().click();}
    await p.waitForTimeout(1000);const card=p.locator('.category-card').first(),btn=card.locator('.category-title-row');
    if(mobile)await btn.tap();else await card.hover();assert.equal(await btn.getAttribute('aria-expanded'),'true');
    await p.waitForTimeout(1300);if(mobile)await btn.tap();else await p.mouse.move(1,1);
    await p.locator('.home-secondary').scrollIntoViewIfNeeded();await p.waitForTimeout(1300);
    await p.locator('.site-footer').scrollIntoViewIfNeeded();await p.waitForTimeout(1000);
   }
   assert.deepEqual(errors,[]);report.push({width,...data,errors,status:'PASS'});console.log('J02_VIEWPORT '+JSON.stringify(report.at(-1)));
  } finally {const video=p.video();await ctx.close();if(video)await video.saveAs(join(out,'fr-'+width+'.webm'));}
 }
}finally{await browser.close();writeFileSync(join(out,'viewport-report.json'),JSON.stringify({scope:'FR candidate with approved atlas; human final page acceptance pending',viewports:report},null,2)+'\n');}
