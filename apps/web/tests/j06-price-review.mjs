import assert from "node:assert/strict";
import {mkdirSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {chromium} from "/tmp/panokit-playwright/node_modules/playwright/index.mjs";
const origin="http://127.0.0.1:3000",out=process.env.J06_EVIDENCE;
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true}),report={sha:process.env.GITHUB_SHA,checks:[],errors:[],captures:[]};
const check=(label,ok)=>{report.checks.push({label,ok:Boolean(ok)});assert.ok(ok,label)};
async function capture(p,key){await p.evaluate(()=>document.fonts.ready);const file=key+".png";await p.screenshot({path:join(out,file),fullPage:true});report.captures.push(file)}
async function blocked(p,lang,width,key){
 const view=p.getByTestId("price-review");await view.waitFor();
 check(key+" locale",await view.getAttribute("lang")===lang&&await view.getAttribute("dir")===(lang==="ar"?"rtl":"ltr"));
 await p.waitForFunction(l=>document.documentElement.lang===l,lang);
 check(key+" total closed",await p.getByTestId("price-total").textContent()===(lang==="ar"?"غير متاح":"Non disponible"));
 check(key+" both CTA disabled",await p.getByTestId("price-action-mobile").isDisabled()&&await p.getByTestId("price-action-desktop").isDisabled());
 check(key+" no synthetic amount",!(/1[.,](26|35)|TEST_ONLY|LAB ·/.test(await view.innerText())));
 const m=await p.evaluate(()=>({w:innerWidth,scroll:document.documentElement.scrollWidth,cta:document.querySelector('[data-testid=price-action-mobile]').getBoundingClientRect().bottom,height:document.querySelector('[data-testid=price-action-mobile]').getBoundingClientRect().height}));
 check(key+" no overflow",m.scroll<=m.w+1);
 if(width<=760)check(key+" first viewport mobile",m.cta<=844&&m.height>=44);
 await capture(p,key);
}
try{
 for(const lang of ["fr","ar"])for(const width of [320,390,768,1440]){
  const key=lang+"-"+width,p=await browser.newPage({viewport:{width,height:844}});
  try{const res=await p.goto(origin+"/prix-livraison?lang="+lang+"&price=1&mode=LAB",{waitUntil:"domcontentloaded"});check(key+" direct HTTP",res?.ok());await blocked(p,lang,width,key+"-direct");check(key+" direct master",await p.getByTestId("price-preview").locator("image").getAttribute("href")==="/studio-v4/STU-ENV-01-master-day.svg");
  const back=p.getByTestId("price-review").locator("a[href^='/studio']").first();await back.click();await p.locator("#studio-name").waitFor();
  const name=lang==="ar"?"اختبار":"TEST J06";await p.locator("#studio-name").fill(name);
  await p.locator(".studio-views button").nth(2).click();
  const original=await p.locator(".studio-main-sign-scroll svg").evaluate(n=>n.outerHTML);
  await p.locator("#studio-price-review").click();await blocked(p,lang,width,key+"-studio");
  check(key+" exact live SVG",await p.getByTestId("price-preview").locator("svg").evaluate(n=>n.outerHTML)===original);
  await p.getByTestId("price-review").locator("a[href^='/studio']").first().click();await p.locator("#studio-name").waitFor();
  check(key+" draft retained",await p.locator("#studio-name").inputValue()===name);
  check(key+" Studio gate still closed",await p.locator(".studio-gate button").isDisabled());
  check(key+" return focus",await p.evaluate(()=>document.activeElement?.id)==="studio-price-review");
  }catch(e){report.errors.push({key,error:String(e)});await capture(p,key+"-error").catch(()=>{});}finally{await p.close()}
 }
}finally{await browser.close();writeFileSync(join(out,"report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks.length,passed:report.checks.filter(x=>x.ok).length,errors:report.errors,captures:report.captures.length}));}
assert.equal(report.errors.length,0);assert.equal(report.checks.filter(x=>!x.ok).length,0);
