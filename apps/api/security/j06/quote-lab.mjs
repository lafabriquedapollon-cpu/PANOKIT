import assert from 'node:assert/strict';
import {randomBytes,createHash,randomInt,createHmac} from 'node:crypto';
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
const roles=['j03_editor','j03_approver','j03_revoker','j03_reader','j06_editor','j06_approver','j06_revoker','j06_runtime','j06_outsider','j08_intake','j08_issuer','j08_workshop_a','j08_workshop_b','j08_client','j08_otp_sender'],creds={},clients=new Set();let started=false,listener,passed=0,cPassed=0,gPassed=0,hPassed=0,vPassed=0,j08Passed=0,linkPassed=0,otpPassed=0,lease,guestPickupToken,guestCurrentToken,pickupReceipt,deliveryReceipt,deliveryToken,deliveryFingerprint;
async function connect(user,password,database=db){const c=new Client({host:'127.0.0.1',port,database,user,password,connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:15000});await c.connect();clients.add(c);return c;}
async function close(c){clients.delete(c);await c.end();}
const login=role=>connect(role,creds[role]);const scalar=async(c,q,a=[])=>Object.values((await c.query(q,a)).rows[0])[0];
const denied=f=>assert.rejects(f,e=>e?.code==='42501');
async function test(name,fn){await fn();passed++;console.log('J06_B '+JSON.stringify({name,status:'PASS'}));}
async function ctest(name,fn){await fn();cPassed++;console.log('J06_C '+JSON.stringify({name,status:'PASS'}));}
async function gtest(name,fn){await fn();gPassed++;console.log('J07_D1B '+JSON.stringify({name,status:'PASS'}));}
async function htest(name,fn){await fn();hPassed++;console.log('J07_SESSION '+JSON.stringify({name,status:'PASS'}));}
async function vtest(name,fn){await fn();vPassed++;console.log('J07_VISUAL '+JSON.stringify({name,status:'PASS'}));}
async function j08test(name,fn){await fn();j08Passed++;console.log('J08_PG '+JSON.stringify({name,status:'PASS'}));}
async function linktest(name,fn){await fn();linkPassed++;console.log('J08_LINK '+JSON.stringify({name,status:'PASS'}));}
async function otptest(name,fn){await fn();otpPassed++;console.log('J08_OTP '+JSON.stringify({name,status:'PASS'}));}
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
 await admin.query(readFileSync(new URL('./industrial-lab.sql',import.meta.url),'utf8'));await admin.query(readFileSync(new URL('./quote-lab.sql',import.meta.url),'utf8'));await admin.query(readFileSync(new URL('./quote-validity-lab.sql',import.meta.url),'utf8'));await admin.query(readFileSync(new URL('./guest-admission-lab.sql',import.meta.url),'utf8'));await admin.query(readFileSync(new URL('./bat-version-lab.sql',import.meta.url),'utf8'));await admin.query(readFileSync(new URL('./bat-link-lab.sql',import.meta.url),'utf8'));await admin.query(readFileSync(new URL('./bat-otp-lab.sql',import.meta.url),'utf8'));
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
 const archiveBytes=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>LAB fixture</text></svg>','utf8');
 const archiveDigest=createHash('sha256').update(archiveBytes).digest('hex');
 const configuredInput={...visualInput,visualVersion:'lab-config-v1',visualDigest:archiveDigest},configuredManifest={...manifest,visualVersion:'lab-config-v1',visualDigest:archiveDigest};
 const archiveCount=async()=>Number(await scalar(admin,'select count(*) from j06_private.guest_visual_archive'));
 const acknowledgeConfigured=(connection=adapter)=>acknowledgeLabVisual(configuredInput,session,configuredManifest,connection,archiveBytes);
 await vtest('V01 explicit exact version, statement and manifest required',async()=>{
  for(const patch of [{accepted:false},{accepted:'true'},{statementVersion:'lab-visual-v0'},{locale:'en'},{price:1}])assert.equal((await acknowledge({...visualInput,...patch})).reason,'invalid_request');
  assert.equal((await acknowledge({...visualInput,visualVersion:'lab-preview-v0'})).reason,'visual_mismatch');
  assert.equal((await acknowledge({...visualInput,visualDigest:'0'.repeat(64)})).reason,'visual_mismatch');
  assert.equal((await acknowledge(visualInput,session,{...manifest,fingerprint:'0'.repeat(64)})).reason,'visual_mismatch');
  assert.equal((await acknowledgeLabVisual(configuredInput,session,configuredManifest,adapter)).reason,'visual_mismatch');
  assert.equal((await acknowledgeLabVisual(configuredInput,session,configuredManifest,adapter,Buffer.from('tampered'))).reason,'visual_mismatch');
  const archiveArgs=[hashToken(guestPickupToken),hashToken(session),pickupReceipt,manifest.fingerprint,'lab-config-v1',archiveDigest,'fr'];
  await runtime.query('begin isolation level serializable');
  try{
   assert.equal(await scalar(runtime,'select j06_private.record_guest_visual_consent($1,$2,$3::uuid,$4,$5,$6,$7)',archiveArgs),false);
   assert.equal(await scalar(runtime,'select j06_private.record_guest_visual_consent($1,$2,$3::uuid,$4,$5,$6,$7,$8::bytea)',[...archiveArgs,Buffer.from('tampered')]),false);
  }finally{await runtime.query('rollback');}
  assert.equal(await consentCount(),0);assert.equal(await archiveCount(),0);
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
  assert.equal((await acknowledgeConfigured(broken)).reason,'calculation_unavailable');assert.equal(await consentCount(),0);assert.equal(await archiveCount(),0);
 });
 await vtest('V04 concurrent acknowledgement writes exactly one immutable proof',async()=>{
  const results=await Promise.all([acknowledgeConfigured(),acknowledgeConfigured()]);
  const success=results.filter(x=>x.status==='lab_visual_acknowledged');
  assert.equal(success.length,1);assert.equal(success[0].orderable,false);
  assert.equal(await consentCount(),1);
  const row=(await admin.query('select receipt_id::text,fingerprint,visual_version,visual_digest,statement_version,locale from j06_private.guest_visual_consents')).rows[0];
  assert.deepEqual(row,{receipt_id:pickupReceipt,fingerprint:manifest.fingerprint,visual_version:configuredManifest.visualVersion,visual_digest:archiveDigest,statement_version:'lab-visual-v1',locale:'fr'});
  assert.equal(await archiveCount(),1);assert.deepEqual(await scalar(admin,'select svg_bytes from j06_private.guest_visual_archive where receipt_id=$1',[pickupReceipt]),archiveBytes);
  assert.equal((await acknowledgeConfigured()).reason,'consent_unavailable');
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
 const [intake,issuer,workshop,wrongWorkshop]=await Promise.all(['j08_intake','j08_issuer','j08_workshop_a','j08_workshop_b'].map(login));
 const batCase='11111111-1111-4111-8111-111111111111',batOther='22222222-2222-4222-8222-222222222222';let activeBatCase=batCase;
 const tx=async(c,q,args)=>{await c.query('begin isolation level serializable');try{const v=await scalar(c,q,args);await c.query('commit');return v;}catch(e){await c.query('rollback');throw e;}};
 const open=(c,caseId=batCase,receipt=pickupReceipt,cap=hashToken(session))=>tx(c,'select j08_private.open_case($1,$2,$3,$4)',[caseId,receipt,cap,'j08_workshop_a']);
 const decision=(c,version,d,event)=>tx(c,'select j08_private.decide($1,$2,$3,$4)',[activeBatCase,version,d,event]);
 const issue=(c,version,b=archiveBytes)=>tx(c,'select j08_private.issue($1,$2,$3)',[activeBatCase,version,b]);
 const events=()=>scalar(admin,'select count(*)::int from j08_private.events');
 await j08test('P01 least privilege, no direct read/write or cross-function',async()=>{
  for(const c of [intake,issuer,workshop,wrongWorkshop,runtime,outsider]){
   await denied(()=>c.query('select * from j08_private.cases'));
   await denied(()=>c.query('delete from j08_private.events'));
   await denied(()=>c.query('update j08_private.versions set digest=\'x\''));
   await denied(()=>c.query('set role j08_owner'));
  }
  await denied(()=>open(issuer));await denied(()=>issue(intake,0));
  await denied(()=>intake.query('select j08_private.open_case($1,$2,$3,$4)',[batCase,pickupReceipt,hashToken(session),'j08_workshop_a']));
 });
 await j08test('P02 wrong session and receipt without archived bytes denied',async()=>{
  assert.equal(await open(intake,batCase,pickupReceipt,hashToken(otherSession)),false);
  assert.equal(await open(intake,batCase,deliveryReceipt),false);
  assert.equal(await events(),0);
 });
 await j08test('P03 concurrent intake creates one case with exact J07 provenance',async()=>{
  const second=await login('j08_intake');
  const results=await Promise.allSettled([open(intake),open(second,batOther)]);
  assert.equal(results.filter(x=>x.status==='fulfilled'&&x.value===true).length,1);
  for(const x of results)if(x.status==='rejected')assert.equal(x.reason.code,'40001');
  const actual=(await admin.query('select case_id::text,receipt_id::text,source_digest,source_bytes from j08_private.cases')).rows;
  assert.equal(actual.length,1);assert.equal(actual[0].receipt_id,pickupReceipt);
  assert.equal(actual[0].source_digest,archiveDigest);assert.deepEqual(actual[0].source_bytes,archiveBytes);
  // Use the actual winning case for subsequent steps.
  activeBatCase=actual[0].case_id;
  assert.equal(await open(intake,batOther,pickupReceipt),false);assert.equal(await events(),1);
 });
 await j08test('P04 wrong workshop and digest cannot approve; no issue before review',async()=>{
  assert.equal(await issue(issuer,0),null);
  assert.equal(await decision(wrongWorkshop,0,archiveDigest,'feasible'),false);
  assert.equal(await decision(workshop,0,'0'.repeat(64),'feasible'),false);
  assert.equal(await decision(workshop,0,archiveDigest,'feasible'),true);
  assert.equal(await decision(workshop,0,archiveDigest,'feasible'),false);
  assert.equal(await events(),2);
 });
 await j08test('P05 rollback of issuance leaves no version or event',async()=>{
  await issuer.query('begin isolation level serializable');
  try{assert.equal(Number(await scalar(issuer,'select j08_private.issue($1,$2,$3)',[activeBatCase,0,archiveBytes])),1);}
  finally{await issuer.query('rollback');}
  assert.equal(await scalar(admin,'select count(*)::int from j08_private.versions'),0);assert.equal(await events(),2);
 });
 await j08test('P06 concurrent issuer same head exactly one new immutable version',async()=>{
  const second=await login('j08_issuer');
  const out=await Promise.allSettled([issue(issuer,0),issue(second,0)]);
  assert.equal(out.filter(x=>x.status==='fulfilled'&&Number(x.value)===1).length,1);
  for(const x of out)if(x.status==='rejected')assert.equal(x.reason.code,'40001');
  assert.equal(await scalar(admin,'select count(*)::int from j08_private.versions'),1);
  assert.equal(await scalar(admin,'select technical from j08_private.cases'),'review');assert.equal(await events(),3);
 });
 await j08test('P07 technical decision bound to exact version, correction replaces only on issuance',async()=>{
  assert.equal(await decision(workshop,0,archiveDigest,'feasible'),false);
  assert.equal(await decision(workshop,1,'0'.repeat(64),'correction'),false);
  assert.equal(await decision(workshop,1,archiveDigest,'correction'),true);
  assert.equal(Number(await issue(issuer,1,archiveBytes)),2);
  assert.equal(await scalar(admin,'select count(*)::int from j08_private.versions'),2);
  assert.equal(await decision(workshop,1,archiveDigest,'feasible'),false);
  assert.equal(await decision(workshop,2,archiveDigest,'feasible'),true);
  assert.equal(await scalar(admin,'select technical_version::int from j08_private.cases'),2);
  assert.equal(await scalar(admin,"select count(*)::int from j08_private.events where event='superseded'"),1);
  assert.equal(await events(),7);
 });
 const client=await login('j08_client'), sourceSession=hashToken(session), wrongSession=hashToken(otherSession);
 const linkHash=()=>hashToken(randomBytes(32).toString('hex'));
 const rotate=(c,k,v=2,cap=sourceSession,d=archiveDigest)=>tx(c,'select j08_private.rotate_link($1,$2,$3,$4,$5)',[activeBatCase,v,d,cap,k]);
 const readBat=(c,k,v=2,cap=sourceSession,id=activeBatCase)=>tx(c,'select j08_private.read_bat($1,$2,$3,$4)',[id,v,cap,k]);
 const revoke=(c,k,v=2)=>tx(c,'select j08_private.revoke_link($1,$2,$3)',[activeBatCase,v,k]);
 const l1=linkHash(),l2=linkHash(),l3=linkHash();let winner;
 await linktest('L01 role separation and helper denial',async()=>{
  for(const c of [client,issuer,workshop,intake,runtime,outsider]){
   await denied(()=>c.query('select * from j08_private.links'));
   await denied(()=>c.query('delete from j08_private.link_events'));
  }
  await denied(()=>rotate(client,l1));await denied(()=>readBat(issuer,l1));
  await denied(()=>tx(client,'select j08_private.lock_valid_link($1,$2,$3,$4)',[activeBatCase,2,sourceSession,l1]));
  await denied(()=>client.query('select j08_private.read_bat($1,$2,$3,$4)',[activeBatCase,2,sourceSession,l1]));
 });
 await linktest('L02 wrong source session, old version and digest denied',async()=>{
  assert.equal(await rotate(issuer,l1,2,wrongSession),false);
  assert.equal(await rotate(issuer,l1,1),false);
  assert.equal(await rotate(issuer,l1,2,sourceSession,'0'.repeat(64)),false);
  assert.equal(await scalar(admin,'select count(*)::int from j08_private.links'),0);
 });
 await linktest('L03 exact private projection and fixed seven-day TTL',async()=>{
  assert.equal(await rotate(issuer,l1),true);
  const result=await readBat(client,l1);
  assert.deepEqual(Object.keys(result).sort(),['bytesBase64','digest','manufacturable','scope','version']);
  assert.equal(result.version,2);assert.equal(result.digest,archiveDigest);assert.equal(result.manufacturable,false);
  assert.deepEqual(Buffer.from(result.bytesBase64,'base64'),archiveBytes);
  assert.equal(await scalar(admin,'select extract(epoch from expires_at-issued_at)::int from j08_private.links'),604800);
  assert.equal(await readBat(client,l1,2,wrongSession),null);
  assert.equal(await readBat(client,l1,1),null);
  assert.equal(await readBat(client,linkHash()),null);
  assert.equal(await readBat(client,l1,2,sourceSession,'44444444-4444-4444-8444-444444444444'),null);
 });
 await linktest('L04 rollback rotation preserves previous link and audit',async()=>{
  await issuer.query('begin isolation level serializable');
  try{assert.equal(await scalar(issuer,'select j08_private.rotate_link($1,$2,$3,$4,$5)',[activeBatCase,2,archiveDigest,sourceSession,l2]),true);}
  finally{await issuer.query('rollback');}
  assert.ok(await readBat(client,l1));assert.equal(await readBat(client,l2),null);
  assert.equal(await scalar(admin,'select count(*)::int from j08_private.link_events'),1);
 });
 await linktest('L05 rotation invalidates old token; duplicate cannot revoke current',async()=>{
  assert.equal(await rotate(issuer,l2),true);assert.equal(await readBat(client,l1),null);
  assert.equal(await rotate(issuer,l1),false);assert.ok(await readBat(client,l2));
  assert.equal(await scalar(admin,'select count(*)::int from j08_private.link_events'),3);
 });
 await linktest('L06 concurrent rotations leave exactly one current token',async()=>{
  const second=await login('j08_issuer'),a=linkHash(),b=linkHash();
  const out=await Promise.allSettled([rotate(issuer,a),rotate(second,b)]);
  assert.ok(out.some(x=>x.status==='fulfilled'&&x.value===true));
  for(const x of out)if(x.status==='rejected')assert.equal(x.reason.code,'40001');
  const allowed=await Promise.all([readBat(client,a),readBat(await login('j08_client'),b)]);
  assert.equal(allowed.filter(Boolean).length,1);winner=allowed[0]?a:b;
  assert.equal(await readBat(client,l2),null);
  assert.equal(await scalar(admin,'select count(*)::int from j08_private.links where revoked_at is null'),1);
 });
 await linktest('L07 revoke is terminal for token; expired fixture denied',async()=>{
  assert.equal(await revoke(issuer,winner),true);assert.equal(await revoke(issuer,winner),false);
  assert.equal(await readBat(client,winner),null);assert.equal(await rotate(issuer,l3),true);
  // Privileged fixture-only clock simulation; runtime roles cannot alter timestamps.
  await admin.query("update j08_private.links set issued_at=t,expires_at=t+interval '168 hours' from (select clock_timestamp()-interval '169 hours' t) x where token_hash=$1",[l3]);
  assert.equal(await readBat(client,l3),null);
 });
 await linktest('L08 bounded renewals and exactly one current link',async()=>{
  const count=await scalar(admin,'select count(*)::int from j08_private.links');
  for(let i=count;i<10;i++){winner=linkHash();assert.equal(await rotate(issuer,winner),true);}
  assert.equal(await rotate(issuer,linkHash()),false);assert.ok(await readBat(client,winner));
  assert.equal(await scalar(admin,'select count(*)::int from j08_private.links'),10);
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
 await vtest('V07 restart retains evidence but no order authority',async()=>{assert.equal(await consentCount(),2);assert.equal(await archiveCount(),1);assert.deepEqual(await scalar(admin,'select svg_bytes from j06_private.guest_visual_archive where receipt_id=$1',[pickupReceipt]),archiveBytes);assert.equal((await acknowledge()).reason,'industrial_unavailable');});
 await j08test('P08 restart preserves exact versions, provenance and event history',async()=>{
  assert.equal(await scalar(admin,'select count(*)::int from j08_private.cases'),1);
  assert.equal(await scalar(admin,'select count(*)::int from j08_private.versions'),2);
  assert.equal(await events(),7);
  assert.deepEqual(await scalar(admin,'select source_bytes from j08_private.cases'),archiveBytes);
  assert.deepEqual(await scalar(admin,'select bat_bytes from j08_private.versions where version=2'),archiveBytes);
  assert.equal(await scalar(admin,'select technical_version::int from j08_private.cases'),2);
 });
 await linktest('L09 restart retains revocation, expiry and one active link',async()=>{
  const after=await login('j08_client');
  assert.ok(await readBat(after,winner));assert.equal(await readBat(after,l1),null);
  assert.equal(await readBat(after,l3),null);
  assert.equal(await scalar(admin,'select count(*)::int from j08_private.links'),10);
  assert.equal(await scalar(admin,'select count(*)::int from j08_private.link_events'),19);
 });
 const [otpSender,otpClient,otpIssuer,otpWorkshop]=await Promise.all(['j08_otp_sender','j08_client','j08_issuer','j08_workshop_a'].map(login));
 const code=()=>String(randomInt(0,1000000)).padStart(6,'0');
 const otpIssue=(c,k,v,p,cap=sourceSession,d=archiveDigest)=>tx(c,'select j08_private.issue_otp($1,$2,$3,$4,$5,$6)',[activeBatCase,v,cap,k,d,p]);
 const confirm=(c,k,v,q,p,cap=sourceSession,d=archiveDigest,statement='lab-bat-v1',locale='fr')=>tx(c,'select j08_private.confirm_otp($1,$2,$3,$4,$5,$6,$7,$8,$9)',[activeBatCase,v,cap,k,d,q,p,statement,locale]);
 const refuse=(c,k,v,explicit)=>tx(c,'select j08_private.refuse_bat($1,$2,$3,$4,$5,$6,$7)',[activeBatCase,v,sourceSession,k,archiveDigest,explicit,'ar']);
 const expire=(c,v)=>tx(c,'select j08_private.expire_bat($1,$2,$3)',[activeBatCase,v,archiveDigest]);
 const countDecisions=()=>scalar(admin,'select count(*)::int from j08_private.bat_decisions');
 const series=async v=>(await admin.query('select attempts,issued_count from j08_private.otp_series where case_id=$1 and version=$2',[activeBatCase,v])).rows[0];
 const allowResend=v=>admin.query("update j08_private.otp_series set last_issued_at=clock_timestamp()-interval '31 seconds' where case_id=$1 and version=$2",[activeBatCase,v]);
 const nextVersion=async v=>{assert.equal(await decision(otpWorkshop,v-1,archiveDigest,'correction'),true);assert.equal(Number(await issue(otpIssuer,v-1)),v);assert.equal(await decision(otpWorkshop,v,archiveDigest,'feasible'),true);const k=linkHash();assert.equal(await rotate(otpIssuer,k,v),true);return k;};
 let p=code(),q,k3,k4,k5,k6;
 await otptest('O01 role separation and private secret/HMAC denial',async()=>{
  for(const c of [otpClient,otpSender,otpIssuer,otpWorkshop]){
   for(const table of ['otp_secret','otp_series','otp_challenges','bat_decisions','bat_expirations','otp_events'])await denied(()=>c.query('select * from j08_private.'+table));
   await denied(()=>c.query('delete from j08_private.bat_decisions'));
   await denied(()=>c.query("select j08_private.otp_mac($1,$2,$3,$4,$5,$6,$7)",[batCase,batCase,2,archiveDigest,winner,sourceSession,p]));
  }
  await denied(()=>otpIssue(otpClient,winner,2,p));await denied(()=>confirm(otpSender,winner,2,batCase,p));
 });
 await otptest('O02 invalid context, HMAC and five-minute expiry',async()=>{
  assert.equal(await otpIssue(otpSender,winner,2,p,wrongSession),null);
  assert.equal(await otpIssue(otpSender,winner,2,p,sourceSession,'0'.repeat(64)),null);
  assert.equal(await otpIssue(otpSender,l1,2,p),null);
  q=await otpIssue(otpSender,winner,2,p);assert.match(q,/^[a-f0-9-]{36}$/);
  const row=(await admin.query('select mac,extract(epoch from expires_at-issued_at)::int as ttl from j08_private.otp_challenges where challenge_id=$1',[q])).rows[0];
  const key=await scalar(admin,'select key_bytes from j08_private.otp_secret');
  const expected=createHmac('sha256',key).update(['panokit-lab-otp-v1',q,activeBatCase,2,archiveDigest,winner,sourceSession,p].join('|')).digest();
  assert.deepEqual(row.mac,expected);assert.equal(row.ttl,300);
  assert.equal(await confirm(otpClient,winner,2,q,p,wrongSession),'denied');
  assert.equal(await confirm(otpClient,winner,2,q,p,sourceSession,archiveDigest,'other'),'denied');
  assert.deepEqual(await series(2),{attempts:0,issued_count:1});
  assert.equal(await otpIssue(otpSender,winner,2,code()),null);
 });
 await otptest('O03 expired challenge denied; resend retains wrong attempts',async()=>{
  assert.equal(await confirm(otpClient,winner,2,q,'invalid'),'wrong');
  await admin.query("update j08_private.otp_challenges set issued_at=t,expires_at=t+interval '5 minutes' from (select clock_timestamp()-interval '6 minutes' t) x where challenge_id=$1",[q]);
  assert.equal(await confirm(otpClient,winner,2,q,p),'denied');
  await allowResend(2);const old=q,oldCode=p;p=code();q=await otpIssue(otpSender,winner,2,p);
  assert.ok(q);assert.notEqual(q,old);
  assert.equal(await confirm(otpClient,winner,2,old,oldCode),'denied');
  assert.deepEqual(await series(2),{attempts:1,issued_count:2});
 });
 await otptest('O04 rollback approval leaves challenge reusable',async()=>{
  await otpClient.query('begin isolation level serializable');
  try{assert.equal(await scalar(otpClient,'select j08_private.confirm_otp($1,$2,$3,$4,$5,$6,$7,$8,$9)',[activeBatCase,2,sourceSession,winner,archiveDigest,q,p,'lab-bat-v1','fr']),'approved');}
  finally{await otpClient.query('rollback');}
  assert.equal(await countDecisions(),0);assert.ok(await readBat(otpClient,winner));
 });
 await otptest('O05 concurrent correct code yields exactly one immutable decision',async()=>{
  const another=await login('j08_client');
  const out=await Promise.allSettled([confirm(otpClient,winner,2,q,p),confirm(another,winner,2,q,p)]);
  assert.equal(out.filter(x=>x.status==='fulfilled'&&x.value==='approved').length,1);
  for(const x of out)if(x.status==='rejected')assert.ok(['40001','23505'].includes(x.reason.code));
  assert.equal(await countDecisions(),1);
  const proof=(await admin.query('select version::int,digest,decision,challenge_id,statement_version,locale from j08_private.bat_decisions')).rows[0];
  assert.deepEqual(proof,{version:2,digest:archiveDigest,decision:'approved',challenge_id:q,statement_version:'lab-bat-v1',locale:'fr'});
  assert.equal(await confirm(otpClient,winner,2,q,p),'denied');
  assert.equal(await readBat(otpClient,winner),null);
  assert.equal(await rotate(otpIssuer,linkHash()),false);
 });
 await otptest('O06 correction of approved BAT creates new version without copying consent',async()=>{
  k3=await nextVersion(3);assert.equal(await countDecisions(),1);
  assert.equal(await readBat(otpClient,winner),null);assert.ok(await readBat(otpClient,k3,3));
  assert.equal(await otpIssue(otpSender,winner,2,code()),null);
 });
 await otptest('O07 five attempts persist across rotation and resend',async()=>{
  p=code();q=await otpIssue(otpSender,k3,3,p);assert.ok(q);
  assert.equal(await confirm(otpClient,k3,3,q,'invalid'),'wrong');
  const oldKey=k3;k3=linkHash();assert.equal(await rotate(otpIssuer,k3,3),true);
  assert.equal(await confirm(otpClient,k3,3,q,p),'denied');
  assert.equal(await confirm(otpClient,oldKey,3,q,p),'denied');
  await allowResend(3);p=code();q=await otpIssue(otpSender,k3,3,p);
  for(let i=2;i<=5;i++)assert.equal(await confirm(otpClient,k3,3,q,'invalid'),i===5?'locked':'wrong');
  assert.equal(await confirm(otpClient,k3,3,q,p),'locked');
  await allowResend(3);assert.equal(await otpIssue(otpSender,k3,3,code()),null);
  assert.deepEqual(await series(3),{attempts:5,issued_count:2});
 });
 await otptest('O08 explicit refusal terminal and excludes consent',async()=>{
  k4=await nextVersion(4);assert.equal(await refuse(otpClient,k4,4,false),false);
  assert.equal(await refuse(otpClient,k4,4,true),true);
  assert.equal(await refuse(otpClient,k4,4,true),false);
  assert.equal(await otpIssue(otpSender,k4,4,code()),null);
  assert.equal(await rotate(otpIssuer,linkHash(),4),false);
  assert.equal(await scalar(admin,"select count(*)::int from j08_private.bat_decisions where decision='refused'"),1);
 });
 await otptest('O09 independent business expiry blocks valid access',async()=>{
  k5=await nextVersion(5);p=code();q=await otpIssue(otpSender,k5,5,p);assert.ok(q);
  await denied(()=>expire(otpClient,5));
  assert.equal(await expire(otpIssuer,5),true);assert.equal(await expire(otpIssuer,5),false);
  assert.equal(await readBat(otpClient,k5,5),null);assert.equal(await confirm(otpClient,k5,5,q,p),'denied');
 });
 await otptest('O10 issuance ceiling without resetting attempts',async()=>{
  k6=await nextVersion(6);
  for(let i=1;i<=5;i++){if(i>1)await allowResend(6);assert.ok(await otpIssue(otpSender,k6,6,code()));}
  await allowResend(6);assert.equal(await otpIssue(otpSender,k6,6,code()),null);
  assert.deepEqual(await series(6),{attempts:0,issued_count:5});
 });
 await otptest('O11 restart preserves decisions, expiry and counters',async()=>{
  await listener.close();listener=undefined;
  for(const c of [...clients])await close(c);await pg.stop();started=false;await pg.start();started=true;admin=await connect('postgres',pw);
  const c=await login('j08_client'),sender=await login('j08_otp_sender');
  assert.equal(await countDecisions(),2);assert.deepEqual(await series(3),{attempts:5,issued_count:2});
  assert.deepEqual(await series(6),{attempts:0,issued_count:5});
  assert.equal(await otpIssue(sender,k6,6,code()),null);
  assert.equal(await readBat(c,k5,5),null);assert.equal(await readBat(c,k4,4),null);
  assert.equal(await scalar(admin,"select count(*)::int from j08_private.otp_events where event='approved'"),1);
  assert.equal(await scalar(admin,'select count(*)::int from j08_private.bat_expirations'),1);
 });
 assert.equal(otpPassed,11);console.log('J08_OTP_RESULT '+JSON.stringify({passed:otpPassed,failed:0,notRun:0}));
 assert.equal(linkPassed,9);console.log('J08_LINK_RESULT '+JSON.stringify({passed:linkPassed,failed:0,notRun:0}));
 assert.equal(j08Passed,8);console.log('J08_PG_RESULT '+JSON.stringify({passed:j08Passed,failed:0,notRun:0}));
 assert.equal(vPassed,7);console.log('J07_VISUAL_RESULT '+JSON.stringify({passed:vPassed,failed:0,notRun:0}));
 assert.equal(hPassed,5);console.log('J07_SESSION_RESULT '+JSON.stringify({passed:hPassed,failed:0,notRun:0}));
 assert.equal(gPassed,8);console.log('J07_D1B_RESULT '+JSON.stringify({passed:gPassed,failed:0,notRun:0}));
 assert.equal(cPassed,8);console.log('J06_C_RESULT '+JSON.stringify({passed:cPassed,failed:0,notRun:0}));
 assert.equal(passed,16);console.log('J06_B_RESULT '+JSON.stringify({passed,failed:0,notRun:0}));
}finally{if(listener)await listener.close();for(const c of [...clients])await close(c);if(started)await pg.stop();rmSync(dir,{recursive:true,force:true});console.log('J06_B_CLEANUP PASS');}
