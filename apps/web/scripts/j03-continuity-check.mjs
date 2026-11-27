import assert from 'node:assert/strict';
import {chromium} from 'file:///tmp/panokit-playwright/node_modules/playwright/index.mjs';
const b=await chromium.launch({headless:true}), origin='http://127.0.0.1:3000';
try {
 for(const width of [390,1440]){
  const p=await b.newPage({viewport:{width,height:844},hasTouch:width===390,isMobile:width===390});
  await p.goto(origin+'/ar',{waitUntil:'networkidle'});
  assert.match(await p.locator('h1').innerText(),/لافتتك التجارية،\s*بكل سهولة\./);
  await p.screenshot({path:'proof/j03-accroche-ar-'+width+'.jpeg',type:'jpeg',quality:92,fullPage:true});
  const card=p.locator('.category-card').first();
  if(width===390)await card.locator('button').tap();else await card.hover();
  await card.locator('.family-option').first().click();
  await p.waitForURL(u=>u.pathname==='/catalogue/enseignes'&&u.searchParams.get('lang')==='ar');
  assert.equal(await p.locator('.j03-main').getAttribute('dir'),'rtl');
  await p.locator('.j03-family-card[href*="/lumineuses"]').click();
  await p.waitForURL(u=>u.pathname.endsWith('/lumineuses')&&u.searchParams.get('lang')==='ar');
  assert.equal(await p.locator('.j03-model-card').count(),4);
  await p.locator('.j03-model-card__link[href*="caisson-rectangulaire"]').click();
  await p.waitForURL(u=>u.pathname.endsWith('/caisson-rectangulaire')&&u.searchParams.get('lang')==='ar');
  await p.locator('input[value="liberal"]').check();
  await p.locator('.j03-activity-select').selectOption('chirurgien-dentiste');
  await p.locator('.j03-action').click();
  assert.equal(await p.locator('.j03-no-format').count(),1);
  assert.equal(await p.locator('.j03-form-panel a[href*="studio"], .j03-form-panel a[href*="devis"]').count(),0);
  await p.locator('.j03-return__link').click();
  await p.waitForURL(origin+'/ar');
  console.log('J03_CONTINUITY PASS '+width);
  await p.close();
 }
}finally{await b.close();}
