// R4-BROWSER-01: separate synthetic laboratory. Bootstrap derived from certified TLS harness; original untouched.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {readFileSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {createServer} from 'node:net';
import {createServer as httpServer} from 'node:http';
import {AsyncLocalStorage} from 'node:async_hooks';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {Jar,parseUri,totp} from './mfa-helpers.mjs';
import {createBroker,sessionCookie as rawSessionCookie} from './guarded-broker.mjs';
import {startGate,runHttpCases} from './https-cases.mjs';
import {createLabCertificate,runTransportCases} from './tls-transport.mjs';
const TOTAL=10, PORT=55444, BASE='https://127.0.0.1:55445', TLS_ORIGIN='https://127.0.0.1:55445', DB='panokit_sec01_sovereign_lab';
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
 errorStage='MIGRATION';const options={database:pool,baseURL:BASE,secret:authSecret,trustedOrigins:[BASE],emailAndPassword:{enabled:true},session:{cookieCache:{enabled:false}},advanced:{useSecureCookies:true},rateLimit:{enabled:false},logger:{disabled:true},plugins:[twoFactor({issuer:'PANOKIT LAB',skipVerificationOnEnable:false,twoFactorCookieMaxAge:45,totpOptions:{digits:6,period:30},accountLockout:{enabled:true,maxFailedAttempts:10,durationSeconds:900}})]};
 const migrations=await getMigrations(options);assert.deepEqual(migrations.unsafeChanges??[],[]);assert.deepEqual(migrations.schemaProblems??[],[]);await migrations.runMigrations();auth=betterAuth(options);report('MIGRATION','PASS');

 async function connect(user,pw){const c=new Client({host:'127.0.0.1',port:PORT,database:'panokit_sec01_sovereign_lab',user,password:pw,connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:15000});clients.push(c);await c.connect();return c;}
 await admin.query(fixture.toString('utf8').replace(/^\s*\\set\b.*$/gim,''));
 await admin.query(readFileSync(new URL('./lifecycle-lab.sql',import.meta.url),'utf8'));report('LIFECYCLE_MIGRATION','PASS');await admin.query(readFileSync(new URL('./totp-guard.sql',import.meta.url),'utf8'));report('TOTP_GUARD_MIGRATION','PASS');
 const roleConnections=[];for(const role of roles){const password=randomBytes(32).toString('hex');await admin.query(`alter role sec01_admin_${role} password '${password}'`);roleConnections.push(await connect('sec01_admin_'+role,password));}
 [v,i,w,r,l,sw]=roleConnections;
 const ids=await Promise.all(roleConnections.map(c=>c.query('select session_user as su,current_user as cu,pg_backend_pid() as pid')));assert.equal(new Set(ids.map(x=>x.rows[0].pid)).size,6);ids.forEach((x,j)=>{assert.equal(x.rows[0].su,'sec01_admin_'+roles[j]);assert.equal(x.rows[0].cu,x.rows[0].su);});report('SQL_ROLES','PASS',{count:6});
 const enrollment=new Jar();ok(await call(enrollment,'/sign-up/email',{email,password,name:'PANOKIT LAB'}));const first=await session(enrollment);assert(first?.user?.id);subject=first.user.id;const result=await call(enrollment,'/two-factor/enable',{password,method:'totp'});ok(result);assert.equal(result.data?.method,'totp');secret=parseUri(result.data.totpURI);await delay();ok(await call(enrollment,'/two-factor/verify-totp',{code:totp(secret),trustDevice:false}));const enrolled=await session(enrollment);assert.equal(enrolled?.user?.twoFactorEnabled,true);enrolledSession=enrolled.session.id;const enrollmentCookie=sessionCookie(enrollment.header());
 // Owner-controlled synthetic mapping. Never accept an actor/subject from client input.
 actor=randomUUID();await admin.query('insert into sec01_admin.accounts(actor_id,better_auth_subject,active,can_edit) values($1,$2,true,true)',[actor,subject]);
 const cookieJar=raw=>{const pair=sessionCookie(raw);const n=pair.indexOf('=');return new Jar([[pair.slice(0,n),pair.slice(n+1)]]);};

 // Network ceremony: native auth handler receives actual incoming cookies and
 // credentials. The broker never returns its internal authCookie to Chromium.
 const als=new AsyncLocalStorage();
 const incoming=()=>{const x=als.getStore();assert(x);return x;};
 async function native(route,body){
  const {req}=incoming(),headers=new Headers({origin:req.headers.origin,accept:'application/json','content-type':'application/json'});
  for(const k of ['cookie','sec-fetch-site','referer','user-agent'])if(typeof req.headers[k]==='string')headers.set(k,req.headers[k]);
  const response=await auth.handler(new Request(BASE+'/api/auth'+route,{method:'POST',headers,body:JSON.stringify(body)}));
  const cookies=response.headers.getSetCookie();if(cookies.length)incoming().cookies.push(...cookies);
  let data=null;try{data=await response.json();}catch{}
  return {status:response.status,data,headers:response.headers};
 }
 const pair=raw=>{const a=(raw??'').split(';').map(x=>x.trim()).filter(x=>x.split('=')[0].endsWith('.two_factor'));assert.equal(a.length,1);return a[0];};
 const provider={
  begin:async credentials=>{const x=await native('/sign-in/email',credentials);ok(x);assert.equal(x.data?.twoFactorRedirect,true);const j=new Jar();j.update(x.headers);assert(j.hasSuffix('.two_factor'));return pair(j.header());},
  complete:async(challenge,code)=>{
   const raw=incoming().req.headers.cookie;assert.equal(pair(raw),challenge);
   const j=new Jar(raw.split(';').map(x=>{const z=x.trim(),n=z.indexOf('=');return [z.slice(0,n),z.slice(n+1)];}));
   await noSession(j);const x=await native('/two-factor/verify-totp',{code,trustDevice:false});
   if(x.status>=400&&x.status<500)throw Error('NATIVE_TOTP_REJECTED');ok(x);j.update(x.headers);
   const s=await session(j);assert.equal(s?.user?.id,subject);assert(s?.session?.id);assert.notEqual(s.session.id,enrolledSession);assert(!j.hasSuffix('.two_factor'));assert(!j.hasSuffix('.trust_device'));
   successfulNative++;return {subject:s.user.id,sessionId:s.session.id,authCookie:sessionCookie(j.header())};
  },
  revokeSession:async raw=>{const j=cookieJar(raw);ok(await call(j,'/sign-out',{}));await noSession(cookieJar(raw));},
  readSession:async raw=>{const s=await session(cookieJar(raw));return s?.session?.id?{subject:s.user.id,sessionId:s.session.id}:null;}
 };
 let injectEpochFailure=false,successfulNative=0;
 const sql={reserve:async(sub,digest,tag)=>scalar(v,'select sec01_admin.reserve_totp($1,$2,$3)',[sub,digest,tag]),begin:async(sub,digest,expires)=>assert.equal(await scalar(v,'select sec01_admin.begin_mfa_proof($1,$2,$3)',[sub,digest,expires]),true),mark:async(sub,digest,providerId)=>{if(injectEpochFailure){injectEpochFailure=false;assert.equal(await scalar(r,'select sec01_admin.revoke_factor($1)',[actor]),true);}assert.equal(await scalar(v,'select sec01_admin.mark_reserved_totp($1,$2,$3)',[sub,digest,providerId]),true);}};
 broker=createBroker({subject,provider,sql,key:randomBytes(32),replayKey:randomBytes(32),ttlMs:60000,cookieName:AUTH_COOKIE});
 errorStage='BROWSER_TLS_BOOTSTRAP';
 // A fresh CA, separate leaf, no bypass. The CA is trusted only inside a
 // disposable browser home; no global trust-store changes.
 home=mkdtempSync(path.join(tmpdir(),'panokit-browser-'));
 const p=x=>path.join(home,x),openssl=args=>execFileSync('openssl',args,{stdio:'pipe',timeout:30000});
 openssl(['req','-x509','-newkey','rsa:2048','-nodes','-sha256','-days','1','-subj','/CN=PANOKIT ephemeral test CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign','-keyout',p('ca.key'),'-out',p('ca.pem')]);
 openssl(['req','-new','-newkey','rsa:2048','-nodes','-subj','/CN=PANOKIT loopback','-keyout',p('leaf.key'),'-out',p('leaf.csr')]);
 writeFileSync(p('leaf.ext'),'subjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n');
 openssl(['x509','-req','-in',p('leaf.csr'),'-CA',p('ca.pem'),'-CAkey',p('ca.key'),'-CAcreateserial','-days','1','-sha256','-extfile',p('leaf.ext'),'-out',p('leaf.pem')]);
 openssl(['verify','-CAfile',p('ca.pem'),p('leaf.pem')]);
 req('reflect-metadata');const {Module}=req('@nestjs/common'),{NestFactory}=req('@nestjs/core');
 const {SEC01_LAB_DEPS,Sec01SovereignHttpGate}=req('./r4-compiled/sec01-sovereign-tls-gate.js');
 const {createSec01LabDeps}=req('./r4-compiled/sec01-sovereign-sql-adapter.js');
 const deps=createSec01LabDeps({origin:BASE,tokenKey:randomBytes(32),verifyIssue:input=>broker.verifyIssue(input)},{issuer:i,writer:w,logout:l});
 class LabModule{};Module({controllers:[Sec01SovereignHttpGate],providers:[{provide:SEC01_LAB_DEPS,useValue:deps}]})(LabModule);
 app=await NestFactory.create(LabModule,{logger:false,abortOnError:false,httpsOptions:{key:readFileSync(p('leaf.key')),cert:readFileSync(p('leaf.pem')),minVersion:'TLSv1.2'}});
 const seen=[];const json=(res,status,obj)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(obj));};
 app.use((req,res,next)=>{
  const route=req.url;
  if(route.startsWith('/sec01-lab/'))seen.push({route,method:req.method,site:req.headers['sec-fetch-site'],origin:req.headers.origin,privileged:/(?:^|;\s*)pk_admin_lab=/.test(req.headers.cookie??'')});
  if(route==='/sec01-lab/browser'&&req.method==='GET'){res.setHeader('Content-Type','text/html');res.setHeader('Cache-Control','no-store');res.end('<!doctype html><title>PANOKIT synthetic browser lab</title>');return;}
  if(['/sec01-lab/issue','/sec01-lab/write','/sec01-lab/logout'].includes(route)&&req.method==='POST')return next();
  if(!['/ceremony/begin','/ceremony/complete','/ceremony/native-logout'].includes(route)){json(res,403,{message:'SEC01 denied'});return;}
  void als.run({req,res,cookies:[]},async()=>{
   try{
    assert.equal(req.method,'POST');assert.equal(req.headers.origin,BASE);assert.equal(req.headers['sec-fetch-site'],'same-origin');assert.equal(req.headers['content-type'],'application/json');
    let data='';for await(const chunk of req){data+=chunk;assert(data.length<=4096);}
    const b=JSON.parse(data);assert(b&&typeof b==='object'&&!Array.isArray(b));
    const publish=()=>{const cookies=incoming().cookies;if(cookies.length)res.setHeader('Set-Cookie',cookies);};
    if(route==='/ceremony/begin'){assert.deepEqual(Object.keys(b).sort(),['email','password']);assert.equal(b.email,email);assert.equal(b.password,password);const a=await broker.begin(b);publish();json(res,200,a);}
    else if(route==='/ceremony/complete'){assert.deepEqual(Object.keys(b).sort(),['code','flow']);const a=await broker.complete({flow:b.flow,code:b.code,csrf:req.headers['x-sec01-csrf']});publish();json(res,200,{proof:a.proof,csrf:a.csrf});}
    else {assert.deepEqual(Object.keys(b),[]);const a=await native('/sign-out',{});ok(a);publish();json(res,200,{ok:true});}
   }catch{res.removeHeader('Set-Cookie');json(res,403,{message:'SEC01 denied'});}
  });
 });
 await app.listen(55445,'127.0.0.1');assert.equal(app.getHttpServer().address().address,'127.0.0.1');
 foreign=httpServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Foreign synthetic origin</title>');});
 await new Promise((resolve,reject)=>{foreign.once('error',reject);foreign.listen(55447,'127.0.0.1',resolve);});
 const browserReq=createRequire(path.join(process.env.BROWSER_DEPS,'package.json'));const {chromium}=browserReq('playwright');
 const launch=()=>chromium.launch({headless:true,env:{...process.env,HOME:home},timeout:30000});
 const pageFor=async()=>{const c=await browser.newContext({ignoreHTTPSErrors:false});contexts.push(c);const page=await c.newPage();page.setDefaultTimeout(10000);return {c,page};};
 const url=BASE+'/sec01-lab/browser';
 await test('BROWSER-01 untrusted CA rejected by Chromium',async()=>{browser=await launch();const {page}=await pageFor();await assert.rejects(()=>page.goto(url),e=>/ERR_CERT_AUTHORITY_INVALID/.test(e.message));await browser.close();browser=null;contexts.length=0;});
 const nss=p('.pki/nssdb');mkdirSync(nss,{recursive:true,mode:0o700});
 try{execFileSync('certutil',['-L','-d','sql:'+nss],{stdio:'pipe'});}catch{execFileSync('certutil',['-N','--empty-password','-d','sql:'+nss],{stdio:'pipe'});}
 execFileSync('certutil',['-A','-d','sql:'+nss,'-n','PANOKIT ephemeral CA','-t','C,,','-i',p('ca.pem')],{stdio:'pipe'});
 browser=await launch();report('CHROMIUM','READY',{version:browser.version()});
 const {c,page}=await pageFor();
 await test('BROWSER-02 trusted navigation, wrong hostname rejected',async()=>{const r=await page.goto(url);assert.equal(r.status(),200);assert.match((await r.securityDetails()).protocol,/TLS 1\.[23]/);const x=await pageFor();await assert.rejects(()=>x.page.goto('https://localhost:55445/sec01-lab/browser'),e=>/ERR_CERT_COMMON_NAME_INVALID/.test(e.message));await x.c.close();});
 const post=(page,route,body,csrf)=>page.evaluate(async({route,body,csrf})=>{const headers={'content-type':'application/json'};if(csrf!==undefined)headers['x-sec01-csrf']=csrf;const r=await fetch(route,{method:'POST',credentials:'same-origin',headers,body:JSON.stringify(body)});return {status:r.status,data:await r.json()};},{route,body,csrf});
 const issue=(page,a)=>post(page,'/sec01-lab/issue',{proof:a.proof??a.flow},a.csrf);
 const write=(page,x,csrf)=>post(page,'/sec01-lab/write',x,csrf);
 const countSessions=()=>scalar(admin,'select count(*)::int from sec01_admin.sessions');
 const verified=()=>scalar(admin,'select count(*)::int from sec01_admin.mfa_proofs where verified_at is not null');
 const pricing=()=>scalar(admin,'select revision from sec01_admin.pricing where id=1');
 const op=async()=>({operation:randomUUID(),revision:await pricing(),config:{browserLab:true}});
 const ledger=x=>scalar(admin,'select count(*)::int from sec01_admin.operation_ledger where operation_id=$1',[x.operation]);
 const begin=async page=>{await delay();const x=await post(page,'/ceremony/begin',{email,password});assert.equal(x.status,200);assert.deepEqual(Object.keys(x.data).sort(),['csrf','flow']);return x.data;};
 const finish=async(page,a)=>{await delay();const x=await post(page,'/ceremony/complete',{flow:a.flow,code:totp(secret)},a.csrf);assert.equal(x.status,200);assert.deepEqual(Object.keys(x.data).sort(),['csrf','proof']);return x.data;};
 const attrs=(cookie,strict=false)=>{assert(cookie);assert.equal(cookie.secure,true);assert.equal(cookie.httpOnly,true);if(strict)assert.equal(cookie.sameSite,'Strict');else assert(['Strict','Lax'].includes(cookie.sameSite));};
 const freshPage=async()=>{const x=await pageFor();assert.equal((await x.page.goto(url)).status(),200);return x;};
 const deny=x=>assert.equal(x.status,403);
 const attempts=()=>scalar(admin,"select count(*)::int from sec01_admin.totp_attempts where actor_id=$1 and attempted_at>clock_timestamp()-interval '120 seconds'",[actor]);
 const natives=()=>scalar(admin,'select count(*)::int from public."session" where "userId"=$1',[subject]);
 const age=()=>admin.query("update sec01_admin.totp_attempts set attempted_at=clock_timestamp()-interval '121 seconds' where actor_id=$1",[actor]);
 errorStage='HTTP_GUARD';
 await test('HTTP-MFA-01 native endpoints blocked even with valid pending cookie',async()=>{await age();const a=await begin(page),n=await natives(),p=await verified();for(const route of ['/api/auth/two-factor/verify-totp','/api/auth/sign-in/email','/api/auth/two-factor/verify-backup-code','/api/auth/two-factor/disable','/api/auth/two-factor/enable','/api/auth/change-password','/api/auth/get-session','/api/auth/sign-out','/api/auth/two-factor/verify-totp?x=1','/api/auth//two-factor/verify-totp','/api/auth/two-factor/%76erify-totp','/ceremony/complete?x=1','/ceremony/%63omplete'])deny(await post(page,route,{code:totp(secret),flow:a.flow},a.csrf));assert.equal(await natives(),n);assert.equal(await verified(),p);assert.equal(await attempts(),0);assert(!(await c.cookies()).some(x=>x.name===AUTH_COOKIE));const f=await finish(page,a);assert.equal((await issue(page,f)).status,201);});
 await test('HTTP-MFA-02 independent browser context same OTP denied with no session cookie',async()=>{await age();await delay();const x=await freshPage(),y=await freshPage(),a=await begin(x.page),b=await begin(y.page),otp=totp(secret),n=await natives(),p=await verified();const good=await post(x.page,'/ceremony/complete',{flow:a.flow,code:otp},a.csrf);assert.equal(good.status,200);deny(await post(y.page,'/ceremony/complete',{flow:b.flow,code:otp},b.csrf));assert.equal(await natives(),n+1);assert.equal(await verified(),p+1);assert.equal(await attempts(),2);assert(!(await y.c.cookies()).some(k=>k.name===AUTH_COOKIE));assert.equal((await issue(x.page,good.data)).status,201);await x.c.close();await y.c.close();});
 await test('HTTP-MFA-03 concurrent same code permits exactly one session and proof',async()=>{await age();await delay();const x=await freshPage(),y=await freshPage(),a=await begin(x.page),b=await begin(y.page),otp=totp(secret),n=await natives(),p=await verified();const results=await Promise.all([post(x.page,'/ceremony/complete',{flow:a.flow,code:otp},a.csrf),post(y.page,'/ceremony/complete',{flow:b.flow,code:otp},b.csrf)]);assert.deepEqual(results.map(z=>z.status).sort(),[200,403]);const j=results.findIndex(z=>z.status===200),wins=[x,y];assert((await wins[j].c.cookies()).some(k=>k.name===AUTH_COOKIE));assert(!(await wins[1-j].c.cookies()).some(k=>k.name===AUTH_COOKIE));assert.equal(await natives(),n+1);assert.equal(await verified(),p+1);assert.equal(await attempts(),2);await x.c.close();await y.c.close();});
 await test('HTTP-MFA-04 invalid CSRF and malformed code do not reach provider',async()=>{await age();const x=await freshPage(),a=await begin(x.page),n=await natives(),p=await verified();deny(await post(x.page,'/ceremony/complete',{flow:a.flow,code:totp(secret)}));deny(await post(x.page,'/ceremony/complete',{flow:a.flow,code:'bad'},a.csrf));assert.equal(await attempts(),0);assert.equal(await natives(),n);assert.equal(await verified(),p);assert(!(await x.c.cookies()).some(k=>k.name===AUTH_COOKIE));await x.c.close();});
 await test('HTTP-MFA-05 persistent rate cap blocks sixth valid native attempt',async()=>{await age();await delay();const x=await freshPage(),a=await begin(x.page);const nearby=new Set([-2,-1,0,1,2].map(n=>totp(secret,Date.now()+n*30000)));let k=0;for(let j=0;j<5;j++){while(nearby.has(String(k).padStart(6,'0')))k++;const p=await freshPage(),f=await begin(p.page);deny(await post(p.page,'/ceremony/complete',{flow:f.flow,code:String(k++).padStart(6,'0')},f.csrf));await p.c.close();}assert.equal(await attempts(),5);const n=await natives(),p=await verified();deny(await post(x.page,'/ceremony/complete',{flow:a.flow,code:totp(secret)},a.csrf));assert.equal(await attempts(),5);assert.equal(await natives(),n);assert.equal(await verified(),p);assert(!(await x.c.cookies()).some(k=>k.name===AUTH_COOKIE));await x.c.close();});
 await test('HTTP-MFA-06 native success followed by epoch failure publishes no cookie and revokes session',async()=>{await age();await delay();const x=await freshPage(),a=await begin(x.page),n=await natives(),p=await verified(),before=successfulNative;injectEpochFailure=true;deny(await post(x.page,'/ceremony/complete',{flow:a.flow,code:totp(secret)},a.csrf));assert.equal(injectEpochFailure,false);assert.equal(successfulNative,before+1);assert.equal(await attempts(),1);assert.equal(await natives(),n);assert.equal(await verified(),p);assert(!(await x.c.cookies()).some(k=>k.name===AUTH_COOKIE));await x.c.close();});
 await test('HTTP-MFA-07 cross-site and unknown path denied',async()=>{await age();const x=await freshPage();const a=await begin(x.page),n=await natives(),p=await verified();const fp=await x.c.newPage();await fp.goto('http://localhost:55447/');const denied=await fp.evaluate(async({origin,a})=>{try{await fetch(origin+'/ceremony/complete',{method:'POST',credentials:'include',headers:{'content-type':'application/json','x-sec01-csrf':a.csrf},body:JSON.stringify({flow:a.flow,code:'000000'})});return false;}catch(e){return e instanceof TypeError;}},{origin:BASE,a});assert.equal(denied,true);deny(await post(x.page,'/unknown',{flow:a.flow},a.csrf));assert.equal(await natives(),n);assert.equal(await verified(),p);assert.equal(await attempts(),0);await x.c.close();});
 await test('HTTP-MFA-08 native logout revokes already issued privilege',async()=>{await age();await delay();const x=await freshPage(),a=await begin(x.page),p=await finish(x.page,a),g=await issue(x.page,p);assert.equal(g.status,201);const ck=(await x.c.cookies()).find(k=>k.name==='pk_admin_lab');attrs(ck,true);const id=ck.value.split('.')[1];assert.equal(await scalar(sw,'select sec01_admin.finish_expiry_sweep()'),true);const y=await op();assert.equal((await post(x.page,'/ceremony/native-logout',{})).status,200);assert(!(await x.c.cookies()).some(k=>k.name===AUTH_COOKIE));deny(await write(x.page,y,g.data.csrf));assert.equal(await ledger(y),0);assert.equal(await scalar(admin,"select count(*)::int from sec01_admin.security_audit where session_id=$1 and event_kind='provider_session_logout'",[id]),1);await x.c.close();});
} catch(e){fatal=true;report('RUN','STOPPED',{stage:errorStage,scenario:current??null,kind:e instanceof assert.AssertionError?'ASSERTION':'RUNTIME',code:/^[A-Z0-9_]{1,40}$/.test(e?.code??'')?e.code:undefined});}
finally{
 if(browser)try{await browser.close();}catch{cleanup=false;}
 if(foreign)try{await new Promise((r,j)=>foreign.close(e=>e?j(e):r()));await freePort(55447);}catch{cleanup=false;}
 if(app)try{await app.close();await freePort(55445);}catch{cleanup=false;}
 if(home)try{rmSync(home,{recursive:true,force:true});}catch{cleanup=false;}
 for(const c of clients.reverse())try{await c.end();}catch{cleanup=false;}
 if(pool)try{await pool.end();}catch{cleanup=false;}
 if(bootstrap)try{await bootstrap.end();}catch{cleanup=false;}
 if(startAttempted)try{await pg.stop();await freePort(PORT);}catch{cleanup=false;}
 report('CLEANUP',cleanup?(started?'PASS':'NOT_STARTED'):'FAIL');
 report('SUMMARY',fatal||failed||!cleanup||passed!==TOTAL?'INCOMPLETE':'PASS',{pass:passed,fail:failed,notRun:TOTAL-passed-failed,scope:'synthetic Chromium HTTPS guarded routes; native handler private; no production integration'});
 process.exitCode=fatal||failed||!cleanup||passed!==TOTAL?1:0;
}
