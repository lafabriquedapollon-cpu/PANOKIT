import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {startGuestUiLab} from './guest-ui-broker.mjs';
export async function runGuestTransportLab({browser,domain,connect,fixture,preview,admin}){
 const lab=await startGuestUiLab({domain,connect,fixture,preview});
 const contexts=[];let passed=0;
 const test=async(name,fn)=>{await fn();passed++;console.log('J07_TRANSPORT '+JSON.stringify({name,status:'PASS'}));};
 const page=async(origin=lab.origin)=>{const ctx=await browser.newContext();contexts.push(ctx);const p=await ctx.newPage();await p.goto(origin);return {ctx,p};};
 const act=(p,body)=>p.evaluate(async body=>{const r=await fetch('/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};},body);
 const img=p=>p.evaluate(async()=>{const r=await fetch('/preview.svg');return {status:r.status,bytes:[...new Uint8Array(await r.arrayBuffer())]};});
 const counts=async()=>{const r=await admin.query('select (select count(*)::int from j06_private.guest_admissions) as contacts,(select count(*)::int from j06_private.guest_visual_consents) as consents');return r.rows[0];};
 const consent=b=>({action:'visual',accepted:true,visualVersion:b.visualVersion,visualDigest:b.visualDigest,statementVersion:b.statementVersion});
 const clean=b=>assert.ok(!/leaseToken|receiptId|fingerprint|sessionToken|j07sid|phone|address|name/.test(JSON.stringify(b)));
 let short;
 try{
  const a=await page(),b=await page(),guest={name:'Client Test',phone:'0600000000'};
  let fr,ar;
  await test('T01 cookies distinct, HttpOnly, SameSite strict, no browser JS access',async()=>{
   const ca=(await a.ctx.cookies(lab.origin)).find(x=>x.name==='j07sid'),cb=(await b.ctx.cookies(lab.origin)).find(x=>x.name==='j07sid');
   assert.ok(ca&&cb&&ca.httpOnly&&cb.httpOnly&&ca.sameSite==='Strict'&&cb.sameSite==='Strict');assert.notEqual(ca.value,cb.value);
   assert.equal(await a.p.evaluate(()=>document.cookie),'');
  });
  await test('T02 missing cookie and cross-origin POST denied',async()=>{
   const bad=await fetch(lab.origin+'/action',{method:'POST',headers:{origin:lab.origin,'content-type':'application/json'},body:'{"action":"issue","mode":"pickup"}'});assert.equal(bad.status,403);
   const cross=await a.ctx.request.post(lab.origin+'/action',{headers:{origin:'https://example.invalid','content-type':'application/json'},data:{action:'issue',mode:'pickup'}});assert.equal(cross.status(),403);
  });
  await test('T03 injected fields and cross-session progression denied',async()=>{
   assert.equal((await act(a.p,{action:'issue',mode:'pickup',price:1})).status,400);
   assert.equal((await act(b.p,{action:'contact',contact:guest,locale:'fr'})).status,400);
   assert.equal((await img(b.p)).status,403);
  });
  await test('T04 double issue has one success, no secret in response',async()=>{
   const results=await Promise.all([act(a.p,{action:'issue',mode:'pickup'}),act(a.p,{action:'issue',mode:'pickup'})]);
   assert.equal(results.filter(x=>x.status===200).length,1);for(const x of results)clean(x.body);
   assert.deepEqual(await counts(),{contacts:0,consents:0});
  });
  await test('T05 invalid contact shows field IDs without persistence',async()=>{
   const r=await act(a.p,{action:'contact',contact:{name:'Client Test'},locale:'fr'});assert.equal(r.status,422);assert.deepEqual(r.body.fields,['phone']);
   assert.deepEqual(await counts(),{contacts:0,consents:0});
  });
  await test('T06 French contact admission returns no private capability or receipt',async()=>{
   const r=await act(a.p,{action:'contact',contact:guest,locale:'fr'});assert.equal(r.status,200);fr=r.body;clean(fr);assert.equal(fr.state,'contact');assert.equal(fr.orderable,false);assert.deepEqual(await counts(),{contacts:1,consents:0});
  });
  await test('T07 acknowledgement before preview or from other context denied',async()=>{
   assert.equal((await act(a.p,consent(fr))).status,400);assert.equal((await act(b.p,consent(fr))).status,400);assert.equal((await img(b.p)).status,403);
   assert.deepEqual(await counts(),{contacts:1,consents:0});
  });
  await test('T08 served SVG bytes match server manifest digest',async()=>{
   const r=await img(a.p);assert.equal(r.status,200);assert.equal(createHash('sha256').update(Buffer.from(r.bytes)).digest('hex'),fr.visualDigest);assert.deepEqual(Buffer.from(r.bytes),Buffer.from(preview));
  });
  await test('T09 implicit or tampered acknowledgement denied',async()=>{
   for(const patch of [{accepted:false},{visualDigest:'0'.repeat(64)},{visualVersion:'lab-preview-v0'},{sessionToken:'test'}])assert.equal((await act(a.p,{...consent(fr),...patch})).status,400);
   assert.deepEqual(await counts(),{contacts:1,consents:0});
  });
  await test('T10 concurrent consent exactly one durable proof',async()=>{
   const results=await Promise.all([act(a.p,consent(fr)),act(a.p,consent(fr))]);assert.equal(results.filter(x=>x.status===200).length,1);for(const x of results)clean(x.body);assert.deepEqual(await counts(),{contacts:1,consents:1});
   assert.equal((await act(a.p,consent(fr))).status,400);
  });
  await test('T11 delivery requires address in independent Arabic context',async()=>{
   assert.equal((await act(b.p,{action:'issue',mode:'delivery'})).status,200);
   assert.equal((await act(b.p,{action:'contact',contact:guest,locale:'ar'})).status,422);
   const r=await act(b.p,{action:'contact',contact:{name:'عميل تجريبي',phone:'٠٦٠٠٠٠٠٠٠٠',city:'Ville Test',address:'12 rue Exemple'},locale:'ar'});
   assert.equal(r.status,200);ar=r.body;clean(ar);assert.equal(ar.state,'contact');
  });
  await test('T12 Arabic consent separate durable row, no commercial authority',async()=>{
   assert.equal((await img(b.p)).status,200);const r=await act(b.p,consent(ar));assert.deepEqual(r,{status:200,body:{state:'acknowledged',orderable:false}});
   assert.deepEqual(await counts(),{contacts:2,consents:2});
   const rows=await admin.query('select locale from j06_private.guest_visual_consents order by locale');assert.deepEqual(rows.rows.map(x=>x.locale),['ar','fr']);
  });
  await test('T13 expired server session denied without new database write',async()=>{
   short=await startGuestUiLab({domain,connect,fixture,preview,ttlMs:100});
   const c=await page(short.origin);await c.p.waitForTimeout(150);assert.equal((await act(c.p,{action:'issue',mode:'pickup'})).status,403);
   assert.deepEqual(await counts(),{contacts:2,consents:2});
  });
  assert.equal(passed,13);console.log('J07_TRANSPORT_RESULT '+JSON.stringify({passed,failed:0,notRun:0}));
 }finally{for(const ctx of contexts)await ctx.close();if(short)await short.close();await lab.close();}
}
