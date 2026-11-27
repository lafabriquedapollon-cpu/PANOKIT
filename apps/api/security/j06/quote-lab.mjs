import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import EmbeddedPostgres from 'embedded-postgres';
import pgDriver from 'pg';
const {Client}=pgDriver;
assert.deepEqual(process.argv.slice(2),['--disposable-lab']);assert(process.getuid()!==0);
const require=createRequire(import.meta.url),{PILOT_MODEL,REQUIRED_EVIDENCE,industrialDigest}=require(process.env.J03_ADMISSION),{tariffLabDigest}=require(process.env.J06_ENGINE),{persistLabQuote}=require(process.env.J06_PORT),{startQuoteHttpLab}=require(process.env.J06_HTTP);
const {admitLabGuest,issueGuestLabLease,acknowledgeLabVisual}=require(process.env.J06_PORT.replace(/quote-pg-lab\.js$/,'quote-validity-lab.js'));
const dir=mkdtempSync(join(tmpdir(),'panokit-j06-')),db='panokit_j03_industrial_lab',port=55450,pw=randomBytes(32).toString('hex');
const pg=new EmbeddedPostgres({databaseDir:dir,user:'postgres',password:pw,port,authMethod:'scram-sha-256',persistent:true,postgresFlags:['-c','listen_addresses=127.0.0.1'],autoRehydrateSymlinks:true,onLog:()=>{},onError:()=>{}});
const roles=['j03_editor','j03_approver','j03_revoker','j03_reader','j06_editor','j06_approver','j06_revoker','j06_runtime','j06_outsider'],creds={},clients=new Set();let started=false,listener,passed=0,cPassed=0,gPassed=0,hPassed=0,vPassed=0,lease,guestPickupToken,guestCurrentToken,pickupReceipt,deliveryReceipt,deliveryToken,deliveryFingerprint;
async function connect(user,password,database=db){const c=new Client({host:'127.0.0.1',port,database,user,password,connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:15000});await c.connect();clients.add(c);return c;}
async function close(c){clients.delete(c);await c.end();}
const login=role=>connect(role,creds[role]);const scalar=async(c,q,a=[])=>Object.values((await c.query(q,a)).rows[0])[0];
const denied=f=>assert.rejects(f,e=>e?.code==='42501');
async function test(name,fn){await fn();passed++;console.log('J06_B '+JSON.stringify({name,status:'PASS'}));}
async function ctest(name,fn){await fn();cPassed++;console.log('J06_C '+JSON.stringify({name,status:'PASS'}));}
async function gtest(name,fn){await fn();gPassed++;console.log('J07_D1B '+JSON.stringify({name,status:'PASS'}));}
async function htest(name,fn){await fn();hPassed++;console.log('J07_SESSION '+JSON.stringify({name,status:'PASS'}));}
async function vtest(name,fn){await fn();vPassed++;console.log('J07_VISUAL '+JSON.stringify({name,status:'PASS'}));}
const leaseCall=async(path,body)=>{const res=await fetch(listener.url.replace(/quote$/,path),{method:'POST',headers:{authorization:'Bearer '+listener.token,'content-type':'application/json'},body:JSON.stringify(body)});return {status:res.status,body:await res.json()};};
const industrial={modelId:PILOT_MODEL,formatId:'test-only',revision:1,widthMm:101,heightMm:202,depthMm:30,labelFr:'TEST_ONLY',labelAr:'اختبار',evidence:REQUIRED_EVIDENCE.map((kind,i)=>({kind,privateRef:'fixture_evidence_'+i,sha256:String(i+1).repeat(64)}))};
const digest=industrialDigest(industrial),tariff=revision=>({scope:'LAB',modelId:PILOT_MODEL,formatId:'test-only',industrialRevision:1,industrialDigest:digest,revision,currency:'MAD',vatBps:1250,baseNetMinor:101,options:[{id:'test-a',netMinor:2},{id:'test-b',netMinor:9}],pickupDepots:['test-depot','test-other'],zones:[{zoneId:'test-zone',depotId:'test-other',netMinor:8}]}),dest={'lab-destination':{zoneId:'test-zone',depotId:'test-other'}};
const request={modelId:PILOT_MODEL,formatId:'test-only',industrialRevision:1,expectedTariffRevision:1,options:['test-b','test-a'],fulfillment:{mode:'pickup',depotId:'test-depot'}};
const delivery={...request,fulfillment:{mode:'delivery',destinationRef:'lab-destination'}};
const save=(c,t,d=tariffLabDigest(t),map=dest)=>scalar(c,'select j06_private.save_tariff($1,$2,$3,$4,$5)',[t.formatId,t.revision-1,JSON.stringify(t),d,JSON.stringify(map)]);
const decide=(c,t,event,d=tariffLabDigest(t))=>scalar(c,'select j06_private.decide($1,$2,$3,$4)',[t.formatId,t.revision,d,event]);
const adapter=async()=>{const c=await login('j06_runtime');return {query:(q,a)=>c.query(q,a),close:()=>close(c)}};
const calc=r=>persistLabQuote(r,adapter);
const call=async(body,patch={})=>{const res=await fetch(listener.url,{method:'POST',headers:{authorization:'Bearer '+listener.token,'content-type':'application/json'},body:JSON.stringify(body),...patch});return {status:res.status,body:await res.json()}};
let admin,editor,approver,revoker,runtime,outsider,ie,ia,ir,t1=tariff(1),t2=tariff(2);
try{
 await pg.initialise();await pg.start();started=true;
 const boot=await connect('postgres',pw,'postgres');assert.equal(await scalar(boot,"select current_setting('server_version_num')::int"),170012);assert.equal(await scalar(boot,"select current_setting('listen_addresses')"),'127.0.0.1');
 await boot.query('create database '+db);
 for(const role of roles){creds[role]=randomBytes(32).toString('hex');await boot.query("create role "+role+" login password '"+creds[role]+"' nosuperuser nocreatedb nocreaterole noreplication nobypassrls");}
 admin=await connect('postgres',pw);await admin.query('revoke connect,temporary on database '+db+' from public');await admin.query('grant connect on database '+db+' to '+roles.join(','));await admin.query('revoke create on schema public from public');
 await admin.query(readFileSync(new URL('./industrial-lab.sql',import.meta.url),'utf8'));await admin.query(readFileSync(new URL('./quote-lab.sql',import.meta.url),'utf8'));await admin.query(readFileSync(new URL('./quote-validity-lab.sql',import.meta.url),'utf8'));await admin.query(readFileSync(new URL('./guest-admission-lab.sql',import.meta.url),'utf8'));
 [editor,approver,revoker,runtime,outsider,ie,ia,ir]=await Promise.all(['j06_editor','j06_approver','j06_revoker','j06_runtime','j06_outsider','j03_editor','j03_approver','j03_revoker'].map(login));
 listener=await startQuoteHttpLab(adapter);
 await test('B01 empty industrial fails closed',async()=>{assert.equal((await calc(request)).reason,'industrial_unavailable');});
 await test('B02 direct access and role bypass denied',async()=>{for(const c of [editor,approver,revoker,runtime,outsider]){await denied(()=>c.query('select * from j06_private.quotes'));await denied(()=>c.query("update j06_private.tariffs set digest='x'"));await denied(()=>c.query('delete from j06_private.decisions'));}await denied(()=>save(runtime,t1));await denied(()=>decide(editor,t1,'approved'));await denied(()=>decide(approver,t1,'withdrawn'));await denied(()=>outsider.query("select j06_private.read_snapshot('test-only',null)"));await denied(()=>runtime.query('set role j06_owner'));await denied(()=>runtime.query('select * from j03_private.revisions'));await denied(()=>runtime.query("select j06_private.persist_quote('{}')"));});
 await test('B03 J03 approval independent from tariff approval',async()=>{await scalar(ie,'select j03_private.save_draft($1,$2,$3,$4)',[industrial.formatId,0,JSON.stringify(industrial),digest]);await scalar(ia,'select j03_private.record_decision($1,$2,$3,$4)',[industrial.formatId,1,digest,'approved']);assert.equal((await calc(request)).reason,'tariff_unavailable');assert.equal(Number(await save(editor,t1)),1);assert.equal((await calc(request)).reason,'tariff_unavailable');});
 await test('B04 approval digest, role and immutable revision',async()=>{assert.equal(await decide(approver,t1,'approved','0'.repeat(64)),false);assert.equal(await decide(approver,t1,'approved'),true);assert.equal(await decide(approver,t1,'approved'),false);assert.equal(await scalar(admin,"select actor::text from j06_private.decisions where event='approved'"),'j06_approver');});
 await test('B05 HTTP denies missing capability and browser origin',async()=>{assert.equal((await call(request,{headers:{'content-type':'application/json'}})).status,403);assert.equal((await call(request,{headers:{authorization:'Bearer '+listener.token,'content-type':'application/json',origin:'https://example.invalid'}})).status,403);});
 await test('B06 HTTP exact pickup and durable idempotent fingerprint',async()=>{const a=await call(request),b=await call({...request,options:['test-a','test-b']});assert.equal(a.status,200);assert.equal(a.body.quote.amounts.totalMinor,126);assert.equal(a.body.quote.orderable,false);assert.deepEqual(a,b);assert.equal(Number(await scalar(admin,'select count(*) from j06_private.quotes')),1);assert.deepEqual(await scalar(admin,'select document from j06_private.quotes'),a.body.quote);});
 await test('B07 server delivery mapping and outside coverage',async()=>{const a=await call(delivery);assert.equal(a.status,200);assert.equal(a.body.quote.amounts.totalMinor,135);assert.equal(a.body.quote.resolvedDelivery.depotId,'test-other');const b=await call({...delivery,fulfillment:{mode:'delivery',destinationRef:'lab-outside'}});assert.equal(b.status,409);assert.equal(b.body.reason,'delivery_unavailable');assert.equal(Number(await scalar(admin,'select count(*) from j06_private.quotes')),2);});
 await ctest('C01 issue lease with server expiry and no order authority',async()=>{const a=await leaseCall('lease',request);assert.equal(a.status,200);lease=a.body;assert.equal(lease.status,'lab_lease');assert.equal(lease.orderable,false);assert.match(lease.leaseToken,/^[a-f0-9]{64}$/);assert.equal(lease.quote.amounts.totalMinor,126);const row=(await admin.query('select token_hash,extract(epoch from expires_at-issued_at)::int as seconds from j06_private.leases')).rows[0];assert.equal(row.seconds,900);assert.equal(row.token_hash,createHash('sha256').update(lease.leaseToken).digest('hex'));assert.notEqual(row.token_hash,lease.leaseToken);});
 await ctest('C02 revalidate exact quote without extending expiry',async()=>{const a=await leaseCall('revalidate',{leaseToken:lease.leaseToken});assert.equal(a.status,200);assert.equal(a.body.status,'lab_valid');assert.equal(a.body.orderable,false);assert.deepEqual(a.body.quote,lease.quote);assert.equal(a.body.expiresAt,lease.expiresAt);assert.equal(Number(await scalar(admin,'select count(*) from j06_private.leases')),1);});
 await ctest('C03 unknown token and injected fields refused',async()=>{assert.equal((await leaseCall('revalidate',{leaseToken:randomBytes(32).toString('hex')})).body.reason,'lease_unavailable');assert.equal((await leaseCall('revalidate',{leaseToken:lease.leaseToken,price:1})).status,400);assert.equal((await leaseCall('revalidate',{leaseToken:lease.quote.fingerprint})).status,409);});
 await ctest('C04 expired lease refused using DB clock',async()=>{const expired=randomBytes(32).toString('hex');await admin.query("insert into j06_private.leases(token_hash,fingerprint,issued_at,expires_at) select $1,$2,t,t+interval '15 minutes' from (select clock_timestamp()-interval '16 minutes' t) x",[createHash('sha256').update(expired).digest('hex'),lease.quote.fingerprint]);const a=await leaseCall('revalidate',{leaseToken:expired});assert.equal(a.status,409);assert.equal(a.body.reason,'lease_unavailable');});
 await ctest('C05 no table access or lease issuance by untrusted DB roles',async()=>{for(const c of [editor,approver,revoker,runtime,outsider]){await denied(()=>c.query('select * from j06_private.leases'));await denied(()=>c.query('delete from j06_private.leases'));}await denied(()=>editor.query("select j06_private.issue_lease($1,$2)",[lease.leaseToken,lease.quote.fingerprint]));await denied(()=>runtime.query("select j06_private.read_lease($1)",[lease.leaseToken]));});
 const guest={name:'Client Test',phone:'0600000000'};
 const admissionCount=async()=>Number(await scalar(admin,'select count(*) from j06_private.guest_admissions'));
 const session=randomBytes(32).toString('hex'),otherSession=randomBytes(32).toString('hex');
 const hashToken=t=>createHash('sha256').update(t).digest('hex');
 const issueGuest=(selection,cap=session,connection=adapter)=>issueGuestLabLease(selection,cap,connection);
 const admit=(token,contact=guest,connection=adapter,cap=session)=>admitLabGuest({leaseToken:token,contact},cap,connection);
 await htest('H01 issue guest lease with separate hashed session capability',async()=>{
  const bound=await issueGuest(request);assert.equal(bound.status,'lab_lease');guestPickupToken=bound.leaseToken;
  assert.notEqual(guestPickupToken,session);
  const row=(await admin.query('select token_hash,guest_session_hash from j06_private.leases where token_hash=$1',[hashToken(guestPickupToken)])).rows[0];
  assert.deepEqual(row,{token_hash:hashToken(guestPickupToken),guest_session_hash:hashToken(session)});
  assert.notEqual(row.guest_session_hash,session);
 });
 await htest('H02 cross-session, legacy read and unbound lease denied',async()=>{
  assert.equal((await admit(guestPickupToken,guest,adapter,otherSession)).reason,'lease_unavailable');
  assert.equal((await admit(guestPickupToken,{name:'invalid'},adapter,otherSession)).reason,'lease_unavailable');
  assert.equal((await leaseCall('revalidate',{leaseToken:guestPickupToken})).body.reason,'lease_unavailable');
  assert.equal((await admit(lease.leaseToken)).reason,'lease_unavailable');
  assert.equal(await admissionCount(),0);
 });
 await htest('H03 malformed and body-injected session denied',async()=>{
  assert.equal((await issueGuest(request,'invalid')).reason,'invalid_request');
  assert.equal((await admitLabGuest({leaseToken:guestPickupToken,contact:guest},undefined,adapter)).reason,'invalid_request');
  assert.equal((await admitLabGuest({leaseToken:guestPickupToken,contact:guest,sessionToken:session},otherSession,adapter)).reason,'invalid_request');
  assert.equal((await admit(guestPickupToken,guest,adapter,guestPickupToken)).reason,'lease_unavailable');
 });
 await htest('H04 SQL session binding enforced independently of JS',async()=>{
  await runtime.query('begin isolation level serializable');
  try{
   assert.equal(await scalar(runtime,'select j06_private.read_guest_lease($1,$2)',[hashToken(guestPickupToken),hashToken(otherSession)]),null);
   assert.equal(await scalar(runtime,'select j06_private.record_guest_admission($1,$2,$3,$4::uuid)',[hashToken(guestPickupToken),hashToken(otherSession),lease.quote.fingerprint,'00000000-0000-4000-8000-000000000002']),false);
   assert.equal(await scalar(runtime,'select j06_private.read_lease($1)',[hashToken(guestPickupToken)]),null);
  }finally{await runtime.query('rollback');}
  await denied(()=>editor.query('select j06_private.read_guest_lease($1,$2)',[hashToken(guestPickupToken),hashToken(session)]));
  await denied(()=>runtime.query('select guest_session_hash from j06_private.leases'));
  assert.equal(await admissionCount(),0);
 });
 await htest('H05 issuance failure rolls back session binding and lease',async()=>{
  const before=await scalar(admin,'select count(*) from j06_private.leases');
  const broken=async()=>{const c=await adapter();return {...c,query:async(q,a)=>{const result=await c.query(q,a);if(q.includes('issue_guest_lease'))throw Error('fixture rollback');return result;}}};
  assert.equal((await issueGuest(request,session,broken)).reason,'calculation_unavailable');
  assert.equal(await scalar(admin,'select count(*) from j06_private.leases'),before);
 });
 await gtest('G01 strict envelope, unknown token and invalid contact fail closed',async()=>{
  assert.equal((await admitLabGuest({leaseToken:guestPickupToken,contact:guest,price:1},session,adapter)).reason,'invalid_request');
  assert.equal((await admit(randomBytes(32).toString('hex'))).reason,'lease_unavailable');
  assert.equal((await admit(guestPickupToken,{name:'Client Test'})).reason,'contact_invalid');
  assert.equal((await admit(guestPickupToken,{...guest,city:'Test',address:'Test'})).reason,'contact_invalid');
  assert.equal(await admissionCount(),0);
 });
 await gtest('G02 expired lease denied and DB role boundary enforced',async()=>{
  const expired=randomBytes(32).toString('hex');
  await admin.query("insert into j06_private.leases(token_hash,fingerprint,issued_at,expires_at,guest_session_hash) select $1,$2,t,t+interval '15 minutes',$3 from (select clock_timestamp()-interval '16 minutes' t) x",[createHash('sha256').update(expired).digest('hex'),lease.quote.fingerprint,hashToken(session)]);
  assert.equal((await admit(expired)).reason,'lease_unavailable');
  await admin.query('delete from j06_private.leases where token_hash=$1',[createHash('sha256').update(expired).digest('hex')]);
  for(const c of [editor,approver,revoker,runtime,outsider]){
   await denied(()=>c.query('select * from j06_private.guest_admissions'));
   await denied(()=>c.query('delete from j06_private.guest_admissions'));
  }
  await denied(()=>editor.query("select j06_private.record_guest_admission($1,$2,$3,$4::uuid)",['0'.repeat(64),hashToken(session),lease.quote.fingerprint,'00000000-0000-4000-8000-000000000001']));
  await denied(()=>runtime.query("select j06_private.record_guest_admission($1,$2,$3,$4::uuid)",['0'.repeat(64),hashToken(session),lease.quote.fingerprint,'00000000-0000-4000-8000-000000000001']));
  assert.equal(await admissionCount(),0);
 });
 await gtest('G03 write failure rolls back receipt',async()=>{
  const broken=async()=>{const c=await adapter();return {...c,query:async(q,a)=>{const result=await c.query(q,a);if(q.includes('record_guest_admission'))throw Error('fixture rollback');return result;}}};
  assert.equal((await admit(guestPickupToken,guest,broken)).reason,'calculation_unavailable');
  assert.equal(await admissionCount(),0);
 });
 await gtest('G04 concurrent double submission only one committed receipt',async()=>{
  const results=await Promise.all([admit(guestPickupToken),admit(guestPickupToken)]);
  const success=results.filter(x=>x.status==='lab_guest_admitted');
  assert.equal(success.length,1);assert.equal(success[0].orderable,false);pickupReceipt=success[0].receiptId;
  assert.deepEqual(Object.keys(success[0]).sort(),['orderable','receiptId','scope','status']);
  assert.equal(await admissionCount(),1);
  assert.equal(await scalar(admin,'select receipt_id::text from j06_private.guest_admissions'),success[0].receiptId);
  assert.equal((await admit(guestPickupToken)).reason,'admission_unavailable');
 });
 await gtest('G05 delivery mode from lease requires address, no PII persisted',async()=>{
  const d=await issueGuest(delivery);assert.equal(d.status,'lab_lease');
  assert.equal((await admit(d.leaseToken)).reason,'contact_invalid');
  const good=await admit(d.leaseToken,{name:'عميل تجريبي',phone:'٠٦٠٠٠٠٠٠٠٠',city:'Ville Test',address:'12 rue Exemple'});
  assert.equal(good.status,'lab_guest_admitted');assert.equal(good.orderable,false);deliveryReceipt=good.receiptId;deliveryToken=d.leaseToken;deliveryFingerprint=d.quote.fingerprint;
  assert.equal(await admissionCount(),2);
  const cols=(await admin.query("select column_name from information_schema.columns where table_schema='j06_private' and table_name='guest_admissions' order by column_name")).rows.map(x=>x.column_name);
  assert.deepEqual(cols,['fingerprint','receipt_id','recorded_at','token_hash']);
 });
 const consentCount=async()=>Number(await scalar(admin,'select count(*) from j06_private.guest_visual_consents'));
 const visualDigest=hashToken('synthetic visual bytes v1');
 const manifest={receiptId:pickupReceipt,fingerprint:lease.quote.fingerprint,visualVersion:'lab-preview-v1',visualDigest};
 const visualInput={leaseToken:guestPickupToken,receiptId:pickupReceipt,visualVersion:manifest.visualVersion,visualDigest,statementVersion:'lab-visual-v1',locale:'fr',accepted:true};
 const acknowledge=(input=visualInput,cap=session,m=manifest,connection=adapter)=>acknowledgeLabVisual(input,cap,m,connection);
 await vtest('V01 explicit exact version, statement and manifest required',async()=>{
  for(const patch of [{accepted:false},{accepted:'true'},{statementVersion:'lab-visual-v0'},{locale:'en'},{price:1}])assert.equal((await acknowledge({...visualInput,...patch})).reason,'invalid_request');
  assert.equal((await acknowledge({...visualInput,visualVersion:'lab-preview-v0'})).reason,'visual_mismatch');
  assert.equal((await acknowledge({...visualInput,visualDigest:'0'.repeat(64)})).reason,'visual_mismatch');
  assert.equal((await acknowledge(visualInput,session,{...manifest,fingerprint:'0'.repeat(64)})).reason,'visual_mismatch');
  assert.equal(await consentCount(),0);
 });
 await vtest('V02 cross-session and wrong receipt denied; SQL privileges restricted',async()=>{
  assert.equal((await acknowledge(visualInput,otherSession)).reason,'lease_unavailable');
  const wrong={...visualInput,receiptId:deliveryReceipt};
  assert.equal((await acknowledge(wrong,session,{...manifest,receiptId:deliveryReceipt})).reason,'consent_unavailable');
  const args=[hashToken(guestPickupToken),hashToken(otherSession),pickupReceipt,manifest.fingerprint,manifest.visualVersion,visualDigest,'fr'];
  const q='select j06_private.record_guest_visual_consent($1,$2,$3::uuid,$4,$5,$6,$7)';
  await runtime.query('begin isolation level serializable');
  try{assert.equal(await scalar(runtime,q,args),false);}finally{await runtime.query('rollback');}
  await denied(()=>editor.query(q,args));await denied(()=>runtime.query(q,args));
  for(const c of [editor,approver,revoker,runtime,outsider]){
   await denied(()=>c.query('select * from j06_private.guest_visual_consents'));
   await denied(()=>c.query('delete from j06_private.guest_visual_consents'));
  }
  assert.equal(await consentCount(),0);
 });
 await vtest('V03 write failure rolls back consent',async()=>{
  const broken=async()=>{const c=await adapter();return {...c,query:async(q,a)=>{const result=await c.query(q,a);if(q.includes('record_guest_visual_consent'))throw Error('fixture rollback');return result;}}};
  assert.equal((await acknowledge(visualInput,session,manifest,broken)).reason,'calculation_unavailable');assert.equal(await consentCount(),0);
 });
 await vtest('V04 concurrent acknowledgement writes exactly one immutable proof',async()=>{
  const results=await Promise.all([acknowledge(),acknowledge()]);
  const success=results.filter(x=>x.status==='lab_visual_acknowledged');
  assert.equal(success.length,1);assert.equal(success[0].orderable,false);
  assert.equal(await consentCount(),1);
  const row=(await admin.query('select receipt_id::text,fingerprint,visual_version,visual_digest,statement_version,locale from j06_private.guest_visual_consents')).rows[0];
  assert.deepEqual(row,{receipt_id:pickupReceipt,fingerprint:manifest.fingerprint,visual_version:manifest.visualVersion,visual_digest:visualDigest,statement_version:'lab-visual-v1',locale:'fr'});
  assert.equal((await acknowledge()).reason,'consent_unavailable');
  assert.equal((await acknowledge({...visualInput,visualVersion:'lab-preview-v2'},session,{...manifest,visualVersion:'lab-preview-v2'})).reason,'consent_unavailable');
 });
 await vtest('V05 Arabic delivery consent linked to its own receipt',async()=>{
  const m={...manifest,receiptId:deliveryReceipt,fingerprint:deliveryFingerprint};
  const i={...visualInput,leaseToken:deliveryToken,receiptId:deliveryReceipt,locale:'ar'};
  const result=await acknowledge(i,session,m);
  assert.equal(result.status,'lab_visual_acknowledged');assert.equal(result.orderable,false);
  assert.equal(await consentCount(),2);
  assert.equal(await scalar(admin,"select locale from j06_private.guest_visual_consents where receipt_id=$1",[deliveryReceipt]),'ar');
 });
 await test('B08 injected price, zone, malformed JSON rejected',async()=>{for(const x of [{...request,price:1},{...delivery,fulfillment:{...delivery.fulfillment,zoneId:'test-zone'}},{...request,options:['test-a','test-a']}])assert.equal((await call(x)).status,400);const b=await fetch(listener.url,{method:'POST',headers:{authorization:'Bearer '+listener.token,'content-type':'application/json'},body:'{' });assert.equal(b.status,400);assert.equal(Number(await scalar(admin,'select count(*) from j06_private.quotes')),2);});
 await test('B09 invalid mapping refused',async()=>{await assert.rejects(()=>save(editor,t2,tariffLabDigest(t2),{'real-address':{zoneId:'x',depotId:'y'}}),e=>e.code==='22023');});
 await test('B10 concurrent optimistic writers exactly one winner',async()=>{const second=await login('j06_editor');const out=await Promise.allSettled([save(editor,t2),save(second,t2)]);assert.equal(out.filter(x=>x.status==='fulfilled').length,1);assert.equal(out.find(x=>x.status==='rejected').reason.code,'40001');assert.equal((await calc(request)).reason,'tariff_unavailable');});
 await test('B11 rollback approval invisible and stale version rejected',async()=>{await approver.query('begin');assert.equal(await decide(approver,t2,'approved'),true);assert.equal((await calc({...request,expectedTariffRevision:2})).reason,'tariff_unavailable');await approver.query('rollback');assert.equal((await calc({...request,expectedTariffRevision:2})).reason,'tariff_unavailable');assert.equal(await decide(approver,t2,'approved'),true);assert.equal((await calc(request)).reason,'stale_selection');assert.equal((await calc({...request,expectedTariffRevision:2})).status,'lab_quote');});
 await ctest('C06 new approved tariff invalidates old lease',async()=>{const a=await leaseCall('revalidate',{leaseToken:lease.leaseToken});assert.equal(a.status,409);assert.equal(a.body.reason,'stale_selection');const b=await leaseCall('lease',{...request,expectedTariffRevision:2});assert.equal(b.status,200);lease=b.body;assert.equal(lease.quote.tariffRevision,2);});
 await gtest('G06 changed tariff rejects earlier lease before receipt write',async()=>{assert.equal((await admit(guestPickupToken)).reason,'stale_selection');assert.equal(await admissionCount(),2);const next=await issueGuest({...request,expectedTariffRevision:2});assert.equal(next.status,'lab_lease');guestCurrentToken=next.leaseToken;});
 await vtest('V06 stale quote rejects acknowledgement even with prior receipt',async()=>{assert.equal((await acknowledge()).reason,'stale_selection');assert.equal(await consentCount(),2);});
 await test('B12 rollback failed persistence leaves no new quote',async()=>{const before=await scalar(admin,'select count(*) from j06_private.quotes');const broken=async()=>{const c=await adapter();return {...c,query:async(q,a)=>{const r=await c.query(q,a);if(q.startsWith('select j06_private.persist_quote'))throw Error('injected after insert');return r;}}};assert.equal((await persistLabQuote({...delivery,expectedTariffRevision:2},broken)).reason,'calculation_unavailable');assert.equal(await scalar(admin,'select count(*) from j06_private.quotes'),before);});
 await test('B13 withdrawal terminal; history retained',async()=>{assert.equal(await decide(revoker,t2,'withdrawn'),true);assert.equal(await decide(approver,t2,'approved'),false);assert.equal((await calc({...request,expectedTariffRevision:2})).reason,'tariff_unavailable');assert.equal(Number(await scalar(admin,'select count(*) from j06_private.quotes')),3);});
 await ctest('C07 revoked tariff invalidates current lease',async()=>{const a=await leaseCall('revalidate',{leaseToken:lease.leaseToken});assert.equal(a.status,409);assert.equal(a.body.reason,'tariff_unavailable');});
 await gtest('G07 withdrawn tariff refuses current lease',async()=>{assert.equal((await admit(guestCurrentToken)).reason,'tariff_unavailable');assert.equal(await admissionCount(),2);});
 await test('B14 new tariff cannot override withdrawn industrial approval',async()=>{const t3=tariff(3);await save(editor,t3);await decide(approver,t3,'approved');assert.equal(await scalar(ir,'select j03_private.record_decision($1,$2,$3,$4)',[industrial.formatId,1,digest,'withdrawn']),true);assert.equal((await calc({...request,expectedTariffRevision:3})).reason,'industrial_unavailable');});
 await test('B15 persistent restart retains immutable historical quotes',async()=>{await listener.close();listener=undefined;for(const c of [...clients])await close(c);await pg.stop();started=false;await pg.start();started=true;admin=await connect('postgres',pw);assert.equal(Number(await scalar(admin,'select count(*) from j06_private.quotes')),3);assert.equal(Number(await scalar(admin,'select count(*) from j06_private.tariffs')),3);assert.equal((await calc({...request,expectedTariffRevision:3})).reason,'industrial_unavailable');});
 await test('B16 database failure and wrong identity fail closed',async()=>{assert.equal((await persistLabQuote(request,async()=>{throw Error('private');})).reason,'calculation_unavailable');const wrong=async()=>{const c=await login('j03_reader');return {query:(q,a)=>c.query(q,a),close:()=>close(c)};};assert.equal((await persistLabQuote(request,wrong)).reason,'calculation_unavailable');});
 await ctest('C08 restart retains lease history, not authority',async()=>{assert.equal(Number(await scalar(admin,'select count(*) from j06_private.leases')),6);listener=await startQuoteHttpLab(adapter);const a=await leaseCall('revalidate',{leaseToken:lease.leaseToken});assert.equal(a.status,409);assert.equal(a.body.reason,'industrial_unavailable');});
 await gtest('G08 restart preserves receipts and withdrawn industry rejects lease',async()=>{assert.equal(await admissionCount(),2);assert.equal((await admit(guestCurrentToken)).reason,'industrial_unavailable');});
 await vtest('V07 restart retains evidence but no order authority',async()=>{assert.equal(await consentCount(),2);assert.equal((await acknowledge()).reason,'industrial_unavailable');});
 assert.equal(vPassed,7);console.log('J07_VISUAL_RESULT '+JSON.stringify({passed:vPassed,failed:0,notRun:0}));
 assert.equal(hPassed,5);console.log('J07_SESSION_RESULT '+JSON.stringify({passed:hPassed,failed:0,notRun:0}));
 assert.equal(gPassed,8);console.log('J07_D1B_RESULT '+JSON.stringify({passed:gPassed,failed:0,notRun:0}));
 assert.equal(cPassed,8);console.log('J06_C_RESULT '+JSON.stringify({passed:cPassed,failed:0,notRun:0}));
 assert.equal(passed,16);console.log('J06_B_RESULT '+JSON.stringify({passed,failed:0,notRun:0}));
}finally{if(listener)await listener.close();for(const c of [...clients])await close(c);if(started)await pg.stop();rmSync(dir,{recursive:true,force:true});console.log('J06_B_CLEANUP PASS');}
