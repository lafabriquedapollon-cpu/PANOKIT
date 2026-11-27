// SEC01-COMPOSE-A: product API ports + all R4 overlays in one disposable database; derived from R4 RATE.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash,createHmac} from 'node:crypto';
import {readFileSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {createServer} from 'node:net';
import {createServer as httpsServer,request as httpsRequest} from 'node:https';
import {createLoginGuard} from './login-guard.mjs';
import {AsyncLocalStorage} from 'node:async_hooks';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {Jar,parseUri,totp} from './mfa-helpers.mjs';
import {createBroker,sessionCookie as rawSessionCookie} from './guarded-broker.mjs';
import {startGate,runHttpCases} from './https-cases.mjs';
import {createLabCertificate,runTransportCases} from './tls-transport.mjs';
const TOTAL=12, PORT=55444, BASE='https://127.0.0.1:55445', TLS_ORIGIN='https://127.0.0.1:55445', DB='panokit_sec01_sovereign_lab';
const AUTH_COOKIE='__Secure-better-auth.session_token';
const sessionCookie=raw=>rawSessionCookie(raw,AUTH_COOKIE);
const roles=['mfa_verifier','issuer','writer','revoker','logout','sweeper'],clients=[];
let admin,v,i,w,r,l,sw,actor,broker;
const scalar=async(c,q,args=[])=>Object.values((await c.query(q,args)).rows[0])[0];
const sqlDenied=async fn=>assert.rejects(fn,e=>e?.code==='42501');
const brokerDenied=async fn=>assert.rejects(fn,e=>e?.message==='SEC01_CEREMONY_DENIED');
const report=(name,status,extra={})=>console.log(JSON.stringify({name,status,...extra}));
let pg, pool, bootstrap, started=false, startAttempted=false, passed=0, failed=0, fatal=false, cleanup=true;
let auth, app, material, current, errorStage='PREFLIGHT';
let browser, foreign, home; const contexts=[];
const pw=randomBytes(32).toString('hex'), authSecret=randomBytes(48).toString('hex');
const password=randomBytes(24).toString('hex'), email=`lab-${randomUUID()}@example.invalid`;
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
 await freePort(PORT);await freePort(55445);await freePort(55446);errorStage='IMPORTS';
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
 errorStage='MIGRATION';const options={database:pool,baseURL:BASE,secret:authSecret,trustedOrigins:[BASE],emailAndPassword:{enabled:true},session:{cookieCache:{enabled:false}},advanced:{useSecureCookies:true},rateLimit:{enabled:false},logger:{disabled:true},plugins:[twoFactor({issuer:'PANOKIT LAB',skipVerificationOnEnable:false,twoFactorCookieMaxAge:45,totpOptions:{digits:6,period:30},accountLockout:{enabled:true,maxFailedAttempts:10,durationSeconds:900}})]};
 const migrations=await getMigrations(options);assert.deepEqual(migrations.unsafeChanges??[],[]);assert.deepEqual(migrations.schemaProblems??[],[]);await migrations.runMigrations();auth=betterAuth(options);report('MIGRATION','PASS');

 async function connect(user,pw){const c=new Client({host:'127.0.0.1',port:PORT,database:'panokit_sec01_sovereign_lab',user,password:pw,connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:15000});clients.push(c);await c.connect();return c;}
 await admin.query(fixture.toString('utf8').replace(/^\s*\\set\b.*$/gim,''));
 await admin.query(readFileSync(new URL('./lifecycle-lab.sql',import.meta.url),'utf8'));report('LIFECYCLE_MIGRATION','PASS');await admin.query(readFileSync(new URL('./totp-guard.sql',import.meta.url),'utf8'));report('TOTP_GUARD_MIGRATION','PASS');await admin.query(readFileSync(new URL('./credential-maintenance.sql',import.meta.url),'utf8'));report('MAINTENANCE_MIGRATION','PASS');await admin.query(readFileSync(new URL('./maintenance-recovery.sql',import.meta.url),'utf8'));report('RECOVERY_MIGRATION','PASS');await admin.query(readFileSync(new URL('./expiry-worker.sql',import.meta.url),'utf8'));report('WORKER_MIGRATION','PASS');await admin.query(readFileSync(new URL('./login-budget.sql',import.meta.url),'utf8'));report('LOGIN_BUDGET_MIGRATION','PASS');
 const rolePasswords={};const roleConnections=[];for(const role of roles){const password=randomBytes(32).toString('hex');rolePasswords[role]=password;await admin.query(`alter role sec01_admin_${role} password '${password}'`);roleConnections.push(await connect('sec01_admin_'+role,password));}
 [v,i,w,r,l,sw]=roleConnections;
 const ids=await Promise.all(roleConnections.map(c=>c.query('select session_user as su,current_user as cu,pg_backend_pid() as pid')));assert.equal(new Set(ids.map(x=>x.rows[0].pid)).size,6);ids.forEach((x,j)=>{assert.equal(x.rows[0].su,'sec01_admin_'+roles[j]);assert.equal(x.rows[0].cu,x.rows[0].su);});report('SQL_ROLES','PASS',{count:6});

 await admin.query(readFileSync(new URL('./context-binding.sql',import.meta.url),'utf8'));report('CONTEXT_MIGRATION','PASS');
 const identities=[];
 for(const canEdit of [true,true,false]){
  const email='compose-'+randomUUID()+'@example.invalid',password=randomBytes(24).toString('hex'),jar=new Jar();
  ok(await call(jar,'/sign-up/email',{email,password,name:'Synthetic'}));const s=await session(jar);assert(s.user.id);
  const enabled=await call(jar,'/two-factor/enable',{password,method:'totp'});ok(enabled);const secret=parseUri(enabled.data.totpURI);
  await delay();ok(await call(jar,'/two-factor/verify-totp',{code:totp(secret),trustDevice:false}));assert.equal((await session(jar)).user.twoFactorEnabled,true);
  const actor=randomUUID();await admin.query('insert into sec01_admin.accounts(actor_id,better_auth_subject,active,can_edit) values($1,$2,true,$3)',[actor,s.user.id,canEdit]);
  await call(jar,'/sign-out',{});identities.push({email,password,secret,subject:s.user.id,actor});
 }
 const [alice,bob,atelier]=identities;
 const ratePassword=randomBytes(32).toString('hex');await admin.query("alter role sec01_admin_login_guard password '"+ratePassword+"'");
 const rate=await connect('sec01_admin_login_guard',ratePassword),rate2=await connect('sec01_admin_login_guard',ratePassword);
 const replayKey=randomBytes(32),tokenKey=randomBytes(32),loginKey=randomBytes(32);
 assert.equal(await scalar(r,'select sec01_admin.rotate_replay_key($1)',[createHash('sha256').update(replayKey).digest()]),true);
 const {createComposePorts}=req(process.env.COMPOSE_PORTS),{Sec01ComposeModule,createNativeProvider}=req(process.env.COMPOSE_RUNTIME);
 const ports=await createComposePorts({verifier:v,sweeper:sw,issuer:i,writer:w,logout:l},replayKey);
 const v2=await connect('sec01_admin_mfa_verifier',rolePasswords.mfa_verifier),i2=await connect('sec01_admin_issuer',rolePasswords.issuer),w2=await connect('sec01_admin_writer',rolePasswords.writer),l2=await connect('sec01_admin_logout',rolePasswords.logout),sw2=await connect('sec01_admin_sweeper',rolePasswords.sweeper);
 const ports2=await createComposePorts({verifier:v2,sweeper:sw2,issuer:i2,writer:w2,logout:l2},replayKey);
 const provider=createNativeProvider(BASE,x=>auth.handler(x),async email=>{const rows=(await pool.query('select id from public."user" where email=$1',[email])).rows;return rows.length===1?rows[0].id:null;});
 const guard=createLoginGuard({db:rate,key:loginKey,origin:BASE}),guard2=createLoginGuard({db:rate2,key:loginKey,origin:BASE});
 home=mkdtempSync(path.join(tmpdir(),'panokit-compose-b-'));
 const p=x=>path.join(home,x),openssl=args=>execFileSync('openssl',args,{stdio:'pipe',timeout:30000});
 openssl(['req','-x509','-newkey','rsa:2048','-nodes','-sha256','-days','1','-subj','/CN=PANOKIT ephemeral test CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign','-keyout',p('ca.key'),'-out',p('ca.pem')]);
 openssl(['req','-new','-newkey','rsa:2048','-nodes','-subj','/CN=PANOKIT loopback','-keyout',p('leaf.key'),'-out',p('leaf.csr')]);
 writeFileSync(p('leaf.ext'),'subjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n');
 openssl(['x509','-req','-in',p('leaf.csr'),'-CA',p('ca.pem'),'-CAkey',p('ca.key'),'-CAcreateserial','-days','1','-sha256','-extfile',p('leaf.ext'),'-out',p('leaf.pem')]);
 req('reflect-metadata');const {NestFactory}=req('@nestjs/core');
 const apps=[];
 const start=async(port,ports,writer,logout,guard)=>{const x=await NestFactory.create(Sec01ComposeModule.disposable({origin:BASE,ports,writer,logout,guard,provider,replayKey,tokenKey}),{bodyParser:false,logger:false,abortOnError:false,httpsOptions:{key:readFileSync(p('leaf.key')),cert:readFileSync(p('leaf.pem')),minVersion:'TLSv1.2'}});apps.push(x);await x.listen(port,'127.0.0.1');assert.equal(x.getHttpServer().address().address,'127.0.0.1');return x;};
 app={close:async()=>{for(const x of apps.reverse())await x.close();}};
 await start(55445,ports,w,l,guard);await start(55446,ports2,w2,l2,guard2);
 // Distinct listeners share canonical trusted origin in this direct test topology; no proxy/HA claim.
 const send=(route,data,{port=55445,cookie,csrf,origin=BASE,ip='127.0.0.1',ca=true}={})=>new Promise((resolve,reject)=>{
  const raw=JSON.stringify(data);const q=httpsRequest('https://127.0.0.1:'+port+route,{method:'POST',localAddress:ip,agent:false,ca:ca?readFileSync(p('ca.pem')):undefined,rejectUnauthorized:true,headers:{origin,'sec-fetch-site':'same-origin','content-type':'application/json','content-length':Buffer.byteLength(raw),...(cookie?{cookie}:{}),...(csrf?{'x-sec01-csrf':csrf}:{})}},res=>{let s='';res.on('data',b=>s+=b);res.on('end',()=>{try{resolve({status:res.statusCode,data:JSON.parse(s),cookies:res.headers['set-cookie']??[]});}catch(e){reject(e);}});});q.on('error',reject);q.setTimeout(10000,()=>q.destroy(Error('TIMEOUT')));q.end(raw);});
 const pair=(r,name)=>{const xs=r.cookies.map(x=>x.split(';')[0]).filter(x=>x.startsWith(name+'=')&&!x.endsWith('='));assert.equal(xs.length,1);return xs[0];};
 const pending=x=>{const z=x.cookies.map(c=>c.split(';')[0]).filter(c=>c.split('=')[0].endsWith('.two_factor')&&!c.endsWith('='));assert.equal(z.length,1);return z[0];};
 const denied=x=>{assert.equal(x.status,403);assert.equal(x.cookies.length,0);};
 const begin=async(person,port=55445)=>{const x=await send('/sec01/begin',{email:person.email,password:person.password},{port});assert.equal(x.status,200);return {...x.data,challenge:pending(x)};};
 const complete=async(person,f,port=55445)=>{await delay();const x=await send('/sec01/complete',{flow:f.flow,code:totp(person.secret)},{cookie:f.challenge,csrf:f.csrf,port});assert.equal(x.status,200);return {...x.data,native:pair(x,AUTH_COOKIE)};};
 const issue=async(f,port=55445)=>{const x=await send('/sec01/issue',{proof:f.proof},{cookie:f.native,csrf:f.csrf,port});assert.equal(x.status,200);const privileged=pair(x,'pk_admin_compose');assert(x.cookies.find(c=>c.startsWith(privileged+';')).includes('HttpOnly; Secure; SameSite=Strict'));return {native:f.native,privileged,cookie:f.native+'; '+privileged,csrf:x.data.csrf};};
 const revision=()=>scalar(admin,'select revision from sec01_admin.pricing where id=1');
 const mutation=async()=>({operation:randomUUID(),revision:await revision(),config:{syntheticCompose:true}});
 const write=(x,op,port=55445)=>send('/sec01/write',op,{cookie:x.cookie,csrf:x.csrf,port});
 let fa,fb,pa,pb,sa,sb,op;
 errorStage='HTTP_COMPOSE';
 await test('B01 trusted TLS and native route not exposed',async()=>{await assert.rejects(()=>send('/sec01/begin',{},{ca:false}));assert.equal((await send('/api/auth/sign-in/email',{email:alice.email,password:alice.password})).status,404);denied(await send('/sec01/begin?bypass=1',{email:alice.email,password:alice.password}));denied(await send('/sec01/begin',{email:alice.email,password:alice.password},{origin:'https://foreign.invalid'}));});
 await test('B02 distinct actors and worker role cannot issue privileges',async()=>{assert.equal(new Set(identities.map(x=>x.subject)).size,3);denied(await send('/sec01/begin',{email:atelier.email,password:atelier.password}));await sqlDenied(()=>w.query('select * from sec01_admin.write_bound_pricing($1,$2,$3,1,$4)',[randomUUID(),randomBytes(32),randomUUID(),{}]));await sqlDenied(()=>l.query('select sec01_admin.revoke_own_session($1,$2)',[randomUUID(),randomBytes(32)]));});
 await test('B03 separate native challenges; cross-account and cross-instance rejected',async()=>{fa=await begin(alice);fb=await begin(bob,55446);denied(await send('/sec01/complete',{flow:fa.flow,code:totp(alice.secret)},{cookie:fb.challenge,csrf:fa.csrf}));denied(await send('/sec01/complete',{flow:fa.flow,code:totp(alice.secret)},{cookie:fa.challenge,csrf:fa.csrf,port:55446}));});
 await test('B04 real MFA succeeds for both identities',async()=>{pa=await complete(alice,fa);pb=await complete(bob,fb,55446);assert.notEqual(pa.native,pb.native);});
 await test('B05 proof cannot be issued with another native cookie or another instance',async()=>{denied(await send('/sec01/issue',{proof:pa.proof},{cookie:pb.native,csrf:pa.csrf}));denied(await send('/sec01/issue',{proof:pa.proof},{cookie:pa.native,csrf:pa.csrf,port:55446}));sa=await issue(pa);sb=await issue(pb,55446);denied(await send('/sec01/issue',{proof:pa.proof},{cookie:pa.native,csrf:pa.csrf}));});
 await test('B06 stale heartbeat denies HTTP mutation',async()=>{op=await mutation();denied(await write(sa,op));assert.equal(await revision(),op.revision);});
 await test('B07 worker heartbeat enables same-session cross-instance write and replay',async()=>{assert.equal((await ports.sweep(randomUUID(),100)).complete,true);const x=await write(sa,op,55446);assert.equal(x.status,200);assert.deepEqual(x.data,{revision:op.revision+1,replayed:false});const y=await write(sa,op);assert.equal(y.status,200);assert.equal(y.data.replayed,true);});
 await test('B08 mixed cookies and foreign CSRF cannot mutate or revoke',async()=>{const x={cookie:sb.native+'; '+sa.privileged,csrf:sa.csrf};const m=await mutation();denied(await write(x,m,55446));denied(await send('/sec01/logout',{},x));denied(await write({...sa,csrf:sb.csrf},m));assert.equal(await revision(),m.revision);});
 await test('B09 same operation cannot be replayed by another actor',async()=>{denied(await write(sb,op,55446));const m=await mutation();const x=await write(sb,m);assert.equal(x.status,200);assert.equal(await scalar(admin,'select count(*)::int from sec01_admin.operation_ledger where actor_id=$1',[bob.actor]),1);});
 await test('B10 native revocation denies write and records trigger audit',async()=>{await provider.revoke(sa.native);denied(await write(sa,await mutation(),55446));assert.equal(await scalar(admin,"select count(*)::int from sec01_admin.security_audit where event_kind='provider_session_logout' and actor_id=$1",[alice.actor]),1);});
 await test('B11 HTTP logout revokes native and privileged session',async()=>{const x=await send('/sec01/logout',{},sb);assert.equal(x.status,200);assert.equal(await provider.read(sb.native),null);denied(await write(sb,await mutation()));});
 await test('B12 shared account limiter across independent listeners and SQL connections',async()=>{const e='absent-'+randomUUID()+'@example.invalid';for(let j=0;j<5;j++)denied(await send('/sec01/begin',{email:e,password:'synthetic-wrong'},{port:j%2?55446:55445,ip:'127.0.0.'+(j+2)}));const x=await send('/sec01/begin',{email:e,password:'synthetic-wrong'},{port:55446,ip:'127.0.0.8'});assert.equal(x.status,429);assert.equal(x.cookies.length,0);});
} catch(e){fatal=true;report('RUN','STOPPED',{stage:errorStage,scenario:current??null,kind:e instanceof assert.AssertionError?'ASSERTION':'RUNTIME',code:/^[A-Z0-9_]{1,40}$/.test(e?.code??'')?e.code:undefined});}
finally{
 if(app)try{await app.close();await freePort(55445);await freePort(55446);}catch{cleanup=false;}
 if(home)try{rmSync(home,{recursive:true,force:true});}catch{cleanup=false;}
 for(const c of clients.reverse())try{await c.end();}catch{cleanup=false;}
 if(pool)try{await pool.end();}catch{cleanup=false;}
 if(bootstrap)try{await bootstrap.end();}catch{cleanup=false;}
 if(startAttempted)try{await pg.stop();await freePort(PORT);}catch{cleanup=false;}
 report('CLEANUP',cleanup?(started?'PASS':'NOT_STARTED'):'FAIL');
 report('SUMMARY',fatal||failed||!cleanup||passed!==TOTAL?'INCOMPLETE':'PASS',{pass:passed,fail:failed,notRun:TOTAL-passed-failed,scope:'two NestJS TLS listeners, two privileged identities, denied atelier, context-bound SQL and native revocation; synthetic only'});
 process.exitCode=fatal||failed||!cleanup||passed!==TOTAL?1:0;
}
