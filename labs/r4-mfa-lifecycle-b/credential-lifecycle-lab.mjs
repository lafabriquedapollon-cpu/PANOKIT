// PANOKIT disposable SEC01 real loopback HTTP qualification. No TLS/browser or production integration.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash,createHmac} from 'node:crypto';
import {spawn} from 'node:child_process';
import {readFileSync,mkdtempSync,writeFileSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {createServer} from 'node:net';
import {Jar,parseUri,totp} from './mfa-helpers.mjs';
import {createBroker,sessionCookie} from './guarded-broker.mjs';
import {startGate,runHttpCases} from './https-cases.mjs';
import {createLabCertificate,runTransportCases} from './tls-transport.mjs';
const TOTAL=12, PORT=55444, BASE='http://127.0.0.1:55445', TLS_ORIGIN='https://127.0.0.1:55445', DB='panokit_sec01_sovereign_lab';
const roles=['mfa_verifier','issuer','writer','revoker','logout','sweeper'],clients=[];
let admin,v,i,w,r,l,sw,actor,broker;
const scalar=async(c,q,args=[])=>Object.values((await c.query(q,args)).rows[0])[0];
const sqlDenied=async fn=>assert.rejects(fn,e=>e?.code==='42501');
const brokerDenied=async fn=>assert.rejects(fn,e=>e?.message==='SEC01_CEREMONY_DENIED');
const report=(name,status,extra={})=>console.log(JSON.stringify({name,status,...extra}));
let pg, pool, bootstrap, started=false, startAttempted=false, passed=0, failed=0, fatal=false, cleanup=true;
let keyDir;let auth, app, material, current, errorStage='PREFLIGHT';
const pw=randomBytes(32).toString('hex'), authSecret=randomBytes(48).toString('hex');
let password=randomBytes(24).toString('hex');const email=`lab-${randomUUID()}@example.invalid`;
const delay=async()=>{const rem=30000-Date.now()%30000;if(rem<2500)await sleep(rem+300);};
async function freePort(port){const s=createServer();await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(port,'127.0.0.1',resolve);});await new Promise((resolve,reject)=>s.close(e=>e?reject(e):resolve()));}
async function call(jar,route,body){
 assert.match(route,/^\/[a-z0-9/-]+$/);const headers=new Headers({origin:BASE,accept:'application/json'});if(jar.header())headers.set('cookie',jar.header());if(body!==undefined)headers.set('content-type','application/json');
 const response=await auth.handler(new Request(`${BASE}/api/auth${route}`,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)})}));
 jar.update(response.headers);let data=null;try{data=await response.json();}catch{}return {status:response.status,data};
}
const ok=r=>assert(r.status>=200&&r.status<300,'EXPECTED_SUCCESS');
const session=async jar=>{const r=await call(jar,'/get-session');ok(r);return r.data;};
const noSession=async jar=>assert.equal((await session(jar))?.session??null,null,'UNEXPECTED_SESSION');
const signin=async()=>{const jar=new Jar();const r=await call(jar,'/sign-in/email',{email,password});ok(r);assert.equal(r.data?.twoFactorRedirect,true);assert(r.data?.twoFactorMethods?.includes('totp'));assert(jar.hasSuffix('.two_factor'));await noSession(jar);return jar;};
let secret, subject, enrolledSession;
async function test(name,fn){current=name;try{await fn();passed++;report(name,'PASS');}catch(e){failed++;report(name,'FAIL',{kind:e instanceof assert.AssertionError?'ASSERTION':'RUNTIME',code:/^[A-Z0-9_]{1,40}$/.test(e?.code??'')?e.code:undefined});throw e;}}
try{
 assert.equal(process.argv[2],'--disposable-lab');assert.equal(process.argv.length,3);
 const pkg=JSON.parse(readFileSync(new URL('./node_modules/better-auth/package.json',import.meta.url),'utf8'));assert.equal(pkg.version,'1.7.26');
 const fixture=readFileSync(new URL('./r2-lab.sql',import.meta.url));assert.equal(createHash('sha256').update(fixture).digest('hex'),'bc64c21343f7094abfb313050e2607b28a17b9821cc194ab88be706ae36228c4');
 await freePort(PORT);await freePort(55445);errorStage='IMPORTS';
 const {createRequire}=await import('node:module');const req=createRequire(import.meta.url);for(const dep of ['reflect-metadata','@nestjs/common','@nestjs/core','@nestjs/platform-express','./r4-compiled/sec01-sovereign-tls-gate.js','./r4-compiled/sec01-sovereign-sql-adapter.js'])req.resolve(dep);
 const {default:EmbeddedPostgres}=await import('embedded-postgres');const {Client,Pool}=await import('pg');const {betterAuth}=await import('better-auth');const {twoFactor}=await import('better-auth/plugins');
 // Explicit public export discovery, no internal mutation or fallback to a mock.
 let getMigrations;for(const spec of ['better-auth/db/migration','better-auth/db']){try{const m=await import(spec);if(typeof m.getMigrations==='function'){getMigrations=m.getMigrations;break;}}catch(e){if(!['ERR_PACKAGE_PATH_NOT_EXPORTED','ERR_MODULE_NOT_FOUND'].includes(e.code))throw e;}}
 if(!getMigrations)throw Error('MIGRATION_EXPORT_UNAVAILABLE');
 errorStage='PG_BOOTSTRAP';const dir=mkdtempSync(path.resolve('r4-tls01-disposable-'));
 pg=new EmbeddedPostgres({databaseDir:dir,user:'postgres',password:pw,port:PORT,authMethod:'scram-sha-256',persistent:true,postgresFlags:['-c','listen_addresses=127.0.0.1'],autoRehydrateSymlinks:true,onLog:()=>{},onError:()=>{}});
 await pg.initialise();startAttempted=true;await pg.start();started=true;
 bootstrap=new Client({host:'127.0.0.1',port:PORT,database:'postgres',user:'postgres',password:pw,connectionTimeoutMillis:5000});await bootstrap.connect();
 const info=(await bootstrap.query("select current_setting('server_version_num')::int as version, current_setting('listen_addresses') as bind, inet_server_addr()::text as addr")).rows[0];assert(info.version>=170000&&info.version<180000);assert.equal(info.bind,'127.0.0.1');assert.match(info.addr,/^127\.0\.0\.1(?:\/32)?$/);report('LAB','READY',{...info,betterAuth:pkg.version});
 const rolePw=randomBytes(32).toString('hex');await bootstrap.query(`create role panokit_mfa_lab login password '${rolePw}' nosuperuser nocreatedb nocreaterole noreplication nobypassrls`);await bootstrap.query(`create database ${DB}`);
 admin=await connect('postgres',pw);await admin.query('grant usage,create on schema public to panokit_mfa_lab');
 pool=new Pool({host:'127.0.0.1',port:PORT,database:DB,user:'panokit_mfa_lab',password:rolePw,max:6,connectionTimeoutMillis:5000,statement_timeout:10000});
 errorStage='MIGRATION';const options={database:pool,baseURL:BASE,secret:authSecret,trustedOrigins:[BASE],emailAndPassword:{enabled:true},session:{cookieCache:{enabled:false}},rateLimit:{enabled:false},logger:{disabled:true},plugins:[twoFactor({issuer:'PANOKIT LAB',skipVerificationOnEnable:false,twoFactorCookieMaxAge:45,totpOptions:{digits:6,period:30},accountLockout:{enabled:true,maxFailedAttempts:10,durationSeconds:900}})]};
 const migrations=await getMigrations(options);assert.deepEqual(migrations.unsafeChanges??[],[]);assert.deepEqual(migrations.schemaProblems??[],[]);await migrations.runMigrations();auth=betterAuth(options);report('MIGRATION','PASS');

 async function connect(user,pw){const c=new Client({host:'127.0.0.1',port:PORT,database:'panokit_sec01_sovereign_lab',user,password:pw,connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:15000});clients.push(c);await c.connect();return c;}
 await admin.query(fixture.toString('utf8').replace(/^\s*\\set\b.*$/gim,''));
 await admin.query(readFileSync(new URL('./lifecycle-lab.sql',import.meta.url),'utf8'));report('LIFECYCLE_MIGRATION','PASS');
 await admin.query(readFileSync(new URL('./totp-guard.sql',import.meta.url),'utf8'));report('TOTP_GUARD_MIGRATION','PASS');await admin.query(readFileSync(new URL('./credential-maintenance.sql',import.meta.url),'utf8'));report('MAINTENANCE_MIGRATION','PASS');
 let verifierPassword;const roleConnections=[];for(const role of roles){const password=randomBytes(32).toString('hex');if(role==='mfa_verifier')verifierPassword=password;await admin.query(`alter role sec01_admin_${role} password '${password}'`);roleConnections.push(await connect('sec01_admin_'+role,password));}
 [v,i,w,r,l,sw]=roleConnections;const v2=await connect('sec01_admin_mfa_verifier',verifierPassword);assert.notEqual(await scalar(v,'select pg_backend_pid()'),await scalar(v2,'select pg_backend_pid()'));
 const ids=await Promise.all(roleConnections.map(c=>c.query('select session_user as su,current_user as cu,pg_backend_pid() as pid')));assert.equal(new Set(ids.map(x=>x.rows[0].pid)).size,6);ids.forEach((x,j)=>{assert.equal(x.rows[0].su,'sec01_admin_'+roles[j]);assert.equal(x.rows[0].cu,x.rows[0].su);});report('SQL_ROLES','PASS',{count:6});
 const enrollment=new Jar();ok(await call(enrollment,'/sign-up/email',{email,password,name:'PANOKIT LAB'}));const first=await session(enrollment);assert(first?.user?.id);subject=first.user.id;const result=await call(enrollment,'/two-factor/enable',{password,method:'totp'});ok(result);assert.equal(result.data?.method,'totp');secret=parseUri(result.data.totpURI);await delay();ok(await call(enrollment,'/two-factor/verify-totp',{code:totp(secret),trustDevice:false}));const enrolled=await session(enrollment);assert.equal(enrolled?.user?.twoFactorEnabled,true);enrolledSession=enrolled.session.id;const enrollmentCookie=sessionCookie(enrollment.header());
 // Owner-controlled synthetic mapping. Never accept an actor/subject from client input.
 actor=randomUUID();await admin.query('insert into sec01_admin.accounts(actor_id,better_auth_subject,active,can_edit) values($1,$2,true,true)',[actor,subject]);
 const cookieJar=raw=>{const pair=sessionCookie(raw);const n=pair.indexOf('=');return new Jar([[pair.slice(0,n),pair.slice(n+1)]]);};
 let nativeCalls=0;const provider={begin:async()=>signin(),revokeSession:async raw=>{const jar=cookieJar(raw);ok(await call(jar,'/sign-out',{}));await noSession(cookieJar(raw));},complete:async(jar,code)=>{nativeCalls++;assert(jar.hasSuffix('.two_factor'));await noSession(jar);const res=await call(jar,'/two-factor/verify-totp',{code,trustDevice:false});if(res.status>=400&&res.status<500){await noSession(jar);throw Error('NATIVE_TOTP_REJECTED');}ok(res);const after=await session(jar);assert.equal(after?.user?.id,subject);assert(after?.session?.id);assert.notEqual(after.session.id,enrolledSession);assert(!jar.hasSuffix('.two_factor'));assert(!jar.hasSuffix('.trust_device'));return {subject:after.user.id,sessionId:after.session.id,authCookie:sessionCookie(jar.header())};},readSession:async raw=>{const s=await session(cookieJar(raw));return s?.session?.id?{subject:s.user.id,sessionId:s.session.id}:null;}};
 keyDir=mkdtempSync(path.join(tmpdir(),'panokit-lab-key-'));
 const idFor=key=>createHash('sha256').update(key).digest();
 const persist=()=>{const key=randomBytes(32),id=idFor(key),file=path.join(keyDir,id.toString('hex'));writeFileSync(file,key,{mode:0o600,flag:'wx'});assert.equal(statSync(file).mode&0o777,0o600);return {id,file};};
 const readKey=entry=>{const key=readFileSync(entry.file);assert.equal(key.length,32);assert.deepEqual(idFor(key),entry.id);assert.equal(statSync(entry.file).mode&0o777,0o600);return key;};
 const rotate=entry=>scalar(r,'select sec01_admin.rotate_replay_key($1)',[entry.id]);
 let entry=persist();assert.equal(await rotate(entry),true);
 const ports=(client,keyId)=>({begin:async(sub,digest,expires)=>assert.equal(await scalar(client,'select sec01_admin.begin_mfa_proof($1,$2,$3)',[sub,digest,expires]),true),reserve:async(sub,digest,tag)=>scalar(client,'select sec01_admin.reserve_versioned_totp($1,$2,$3,$4)',[sub,digest,tag,keyId]),mark:async(sub,digest,providerId)=>assert.equal(await scalar(client,'select sec01_admin.mark_reserved_totp($1,$2,$3)',[sub,digest,providerId]),true)});
 const makeBroker=(client,keyEntry)=>createBroker({subject,provider,sql:ports(client,keyEntry.id),key:randomBytes(32),replayKey:readKey(keyEntry),ttlMs:60000});
 broker=makeBroker(v,entry);
 const prepare=async()=>{await delay();return broker.begin({});};
 const complete=async a=>broker.complete({...a,code:totp(secret)});
 const fresh=async()=>complete(await prepare());
 const issued=async proof=>{const id=randomUUID(),digest=randomBytes(32);assert.equal(await scalar(i,"select sec01_admin.issue_bound_session($1,$2,$3,$4,clock_timestamp()+interval '240 seconds')",[proof.subject,proof.proofDigest,id,digest]),actor);return {id,digest};};
 const issue=async input=>issued(await broker.verifyIssue(input));
 const countSessions=()=>scalar(admin,'select count(*)::int from sec01_admin.sessions');
 const countProofs=(filter='true')=>scalar(admin,`select count(*)::int from sec01_admin.mfa_proofs where ${filter}`);
 errorStage='CREDENTIAL_LIFECYCLE';
 const age=()=>admin.query("update sec01_admin.totp_attempts set attempted_at=clock_timestamp()-interval '121 seconds'");
 const natives=()=>scalar(admin,'select count(*)::int from public."session" where "userId"=$1',[subject]);
 const denied=async fn=>assert.rejects(fn,e=>e?.message==='SEC01_CEREMONY_DENIED'||e?.code==='42501');
 const opened=op=>scalar(r,'select sec01_admin.open_credential_maintenance($1,$2)',[actor,op]);
 const closed=op=>scalar(r,'select sec01_admin.close_credential_maintenance($1,$2)',[actor,op]);
 const account=async()=> (await admin.query('select active,mfa_epoch,credential_epoch from sec01_admin.accounts where actor_id=$1',[actor])).rows[0];
 const allLogout=async jar=>{ok(await call(jar,'/revoke-sessions',{}));await noSession(jar);assert.equal(await natives(),0);};
 const oldLogin=async p=>{const jar=new Jar(),x=await call(jar,'/sign-in/email',{email,password:p});assert(x.status>=400&&x.status<500);await noSession(jar);};
 const nativeLogin=async()=>{await delay();const jar=await signin();ok(await call(jar,'/two-factor/verify-totp',{code:totp(secret),trustDevice:false}));assert.equal((await session(jar)).user.id,subject);return jar;};
 const priceArgs=async s=>[s.id,s.digest,randomUUID(),await scalar(admin,'select revision from sec01_admin.pricing where id=1'),JSON.stringify({lab:true})];
 const doWrite=args=>w.query('select * from sec01_admin.write_bound_pricing($1,$2,$3,$4,$5)',args);
 let oldProof,oldPriv,oldJar,maintJar,op,oldPassword,oldSecret,oldEntry,newEntry;
 await test('LIFEB-01 legacy reserve and untrusted maintenance/key mutation denied',async()=>{await sqlDenied(()=>v.query('select sec01_admin.reserve_totp($1,$2,$3)',[subject,randomBytes(32),randomBytes(32)]));await sqlDenied(()=>v.query('select sec01_admin.rotate_replay_key($1)',[randomBytes(32)]));await sqlDenied(()=>w.query('select sec01_admin.open_credential_maintenance($1,$2)',[actor,randomUUID()]));await sqlDenied(()=>v.query('select * from sec01_admin.replay_key_state'));});
 await test('LIFEB-02 establish native and privileged sessions before password rotation',async()=>{await age();oldProof=await fresh();oldJar=cookieJar(oldProof.authCookie);oldPriv=await issue(oldProof);maintJar=await nativeLogin();assert((await natives())>=3);assert.equal(await scalar(sw,'select sec01_admin.finish_expiry_sweep()'),true);assert.equal((await doWrite(await priceArgs(oldPriv))).rows[0].replayed,false);});
 await test('LIFEB-03 maintenance freezes account and invalidates old privileges before native mutation',async()=>{const before=await account();op=randomUUID();assert.equal(await opened(op),true);const after=await account();assert.equal(after.active,false);assert.equal(BigInt(after.mfa_epoch),BigInt(before.mfa_epoch)+1n);assert.equal(BigInt(after.credential_epoch),BigInt(before.credential_epoch)+1n);const args=await priceArgs(oldPriv);await sqlDenied(()=>doWrite(args));await sqlDenied(()=>closed(op));await sqlDenied(()=>opened(randomUUID()));await denied(()=>prepare());});
 await test('LIFEB-04 real native password change revokes other sessions and rejects former password',async()=>{oldPassword=password;const next=randomBytes(24).toString('hex');const wrong=await call(maintJar,'/change-password',{currentPassword:randomBytes(24).toString('hex'),newPassword:next,revokeOtherSessions:true});assert(wrong.status>=400&&wrong.status<500);ok(await call(maintJar,'/change-password',{currentPassword:password,newPassword:next,revokeOtherSessions:true}));password=next;await noSession(oldJar);await noSession(cookieJar(enrollmentCookie));await oldLogin(oldPassword);assert.equal(await scalar(admin,"select count(*)::int from sec01_admin.security_audit where session_id=$1 and event_kind='provider_session_logout'",[oldPriv.id]),1);assert.equal(await natives(),1);await sqlDenied(()=>closed(op));});
 await test('LIFEB-05 all native sessions revoked before account can reopen',async()=>{await allLogout(maintJar);await sqlDenied(()=>closed(randomUUID()));assert.equal(await closed(op),true);assert.equal((await account()).active,true);assert.equal(await scalar(admin,"select count(*)::int from sec01_admin.security_audit where actor_id=$1 and operation_id=$2 and event_kind in ('credentials_maintenance_open','credentials_maintenance_close')",[actor,op]),2);});
 await test('LIFEB-06 new password plus existing factor issues new privilege; old privilege denied',async()=>{await age();const p=await fresh(),s=await issue(p);assert.equal(await scalar(sw,'select sec01_admin.finish_expiry_sweep()'),true);assert.equal((await doWrite(await priceArgs(s))).rows[0].replayed,false);const args=await priceArgs(oldPriv);await sqlDenied(()=>doWrite(args));oldJar=cookieJar(p.authCookie);oldPriv=s;});
 await test('LIFEB-07 factor rotation frozen during disable and incomplete re-enrollment',async()=>{await age();maintJar=await nativeLogin();op=randomUUID();assert.equal(await opened(op),true);oldSecret=secret;ok(await call(maintJar,'/two-factor/disable',{password}));assert.equal((await session(maintJar)).user.twoFactorEnabled,false);await sqlDenied(()=>closed(op));const x=await call(maintJar,'/two-factor/enable',{password,method:'totp'});ok(x);secret=parseUri(x.data.totpURI);assert(!secret.equals(oldSecret));assert.equal((await session(maintJar)).user.twoFactorEnabled,false);await sqlDenied(()=>closed(op));await delay();ok(await call(maintJar,'/two-factor/verify-totp',{code:totp(secret),trustDevice:false}));assert.equal((await session(maintJar)).user.twoFactorEnabled,true);await sqlDenied(()=>closed(op));});
 await test('LIFEB-08 native session revocation and former TOTP rejection after factor rotation',async()=>{await allLogout(maintJar);await noSession(oldJar);assert.equal(await closed(op),true);await age();await delay();const a=await prepare();const candidates=new Set([-2,-1,0,1,2].map(n=>totp(secret,Date.now()+n*30000)));const wrong=totp(oldSecret);assert(!candidates.has(wrong),'SYNTHETIC_OTP_COLLISION');const n=await countSessions();await assert.rejects(()=>broker.complete({...a,code:wrong}),e=>e?.message==='NATIVE_TOTP_REJECTED');assert.equal(await countSessions(),n);const p=await fresh();await issue(p);});
 await test('LIFEB-09 persisted key reload in a new broker retains replay rejection',async()=>{await age();await delay();const a=await prepare(),otp=totp(secret);await broker.complete({...a,code:otp});const b=makeBroker(v2,entry),z=await b.begin({}),before=nativeCalls;await denied(()=>b.complete({...z,code:otp}));assert.equal(nativeCalls,before);});
 await test('LIFEB-10 key rotation refused while replay window active and old key cannot be restored',async()=>{oldEntry=entry;newEntry=persist();assert.equal(await rotate(newEntry),false);assert.equal(await rotate(oldEntry),false);assert.equal(await scalar(admin,'select generation::int from sec01_admin.replay_key_state where singleton'),1);});
 await test('LIFEB-11 aged replay window permits rotation; stale broker fenced',async()=>{await age();const stale=makeBroker(v2,oldEntry),a=await stale.begin({});assert.equal(await rotate(newEntry),true);entry=newEntry;assert.equal(await scalar(admin,'select generation::int from sec01_admin.replay_key_state where singleton'),2);assert.equal(await rotate(oldEntry),false);const n=nativeCalls;await denied(()=>stale.complete({...a,code:totp(secret)}));assert.equal(nativeCalls,n);broker=makeBroker(v,entry);});
 await test('LIFEB-12 fresh key supports native MFA and durable audit with no old key rollback',async()=>{await delay();const a=await prepare(),otp=totp(secret),p=await broker.complete({...a,code:otp});await issue(p);const b=makeBroker(v2,entry),z=await b.begin({}),n=nativeCalls;await denied(()=>b.complete({...z,code:otp}));assert.equal(nativeCalls,n);assert.equal(await scalar(admin,'select count(*)::int from sec01_admin.replay_key_history'),2);assert.equal(await scalar(admin,'select count(*)::int from sec01_admin.credential_maintenance'),0);});
} catch(e){fatal=true;report('RUN','STOPPED',{stage:errorStage,scenario:current??null,kind:e instanceof assert.AssertionError?'ASSERTION':'RUNTIME',code:/^[A-Z0-9_]{1,40}$/.test(e?.code??'')?e.code:undefined});}
finally{if(keyDir)try{rmSync(keyDir,{recursive:true,force:true});}catch{cleanup=false;}if(app)try{await app.close();await freePort(55445);}catch{cleanup=false;}if(material)try{material.dispose();}catch{cleanup=false;}for(const c of clients.reverse())try{await c.end();}catch{cleanup=false;}if(pool)try{await pool.end();}catch{cleanup=false;}if(bootstrap)try{await bootstrap.end();}catch{cleanup=false;}if(startAttempted)try{await pg.stop();}catch{cleanup=false;}if(startAttempted)try{await freePort(PORT);}catch{cleanup=false;}report('CLEANUP',cleanup?(started?'PASS':'NOT_STARTED'):'FAIL');report('SUMMARY',fatal||failed||!cleanup||passed!==TOTAL?'INCOMPLETE':'PASS',{pass:passed,fail:failed,notRun:TOTAL-passed-failed,scope:'native password and factor lifecycle, privileged maintenance and replay key fencing in disposable DB; no production integration'});process.exitCode=fatal||failed||!cleanup||passed!==TOTAL?1:0;}
