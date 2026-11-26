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
import {createBroker,sessionCookie as rawSessionCookie} from './ceremony-broker.mjs';
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
 await admin.query(readFileSync(new URL('./lifecycle-lab.sql',import.meta.url),'utf8'));report('LIFECYCLE_MIGRATION','PASS');
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
  const {req,res}=incoming(),headers=new Headers({origin:req.headers.origin,accept:'application/json','content-type':'application/json'});
  for(const k of ['cookie','sec-fetch-site','referer','user-agent'])if(typeof req.headers[k]==='string')headers.set(k,req.headers[k]);
  const response=await auth.handler(new Request(BASE+'/api/auth'+route,{method:'POST',headers,body:JSON.stringify(body)}));
  const cookies=response.headers.getSetCookie();if(cookies.length)res.setHeader('Set-Cookie',cookies);
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
   return {subject:s.user.id,sessionId:s.session.id,authCookie:sessionCookie(j.header())};
  },
  readSession:async raw=>{const s=await session(cookieJar(raw));return s?.session?.id?{subject:s.user.id,sessionId:s.session.id}:null;}
 };
 const sql={begin:async(sub,digest,expires)=>assert.equal(await scalar(v,'select sec01_admin.begin_mfa_proof($1,$2,$3)',[sub,digest,expires]),true),mark:async(sub,digest,providerId)=>assert.equal(await scalar(v,'select sec01_admin.mark_bound_mfa($1,$2,$3)',[sub,digest,providerId]),true)};
 broker=createBroker({subject,provider,sql,key:randomBytes(32),ttlMs:60000,cookieName:AUTH_COOKIE});
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
  const route=req.url.split('?')[0];
  if(route.startsWith('/sec01-lab/'))seen.push({route,method:req.method,site:req.headers['sec-fetch-site'],origin:req.headers.origin,privileged:/(?:^|;\s*)pk_admin_lab=/.test(req.headers.cookie??'')});
  if(route==='/sec01-lab/browser'&&req.method==='GET'){res.setHeader('Content-Type','text/html');res.setHeader('Cache-Control','no-store');res.end('<!doctype html><title>PANOKIT synthetic browser lab</title>');return;}
  if(!['/ceremony/begin','/ceremony/complete','/ceremony/native-logout'].includes(route))return next();
  void als.run({req,res},async()=>{
   try{
    assert.equal(req.method,'POST');assert.equal(req.headers.origin,BASE);assert.equal(req.headers['sec-fetch-site'],'same-origin');assert.equal(req.headers['content-type'],'application/json');
    let data='';for await(const chunk of req){data+=chunk;assert(data.length<=4096);}
    const b=JSON.parse(data);assert(b&&typeof b==='object'&&!Array.isArray(b));
    if(route==='/ceremony/begin'){assert.deepEqual(Object.keys(b).sort(),['email','password']);assert.equal(b.email,email);assert.equal(b.password,password);const a=await broker.begin(b);json(res,200,a);}
    else if(route==='/ceremony/complete'){assert.deepEqual(Object.keys(b).sort(),['code','flow']);const a=await broker.complete({flow:b.flow,code:b.code,csrf:req.headers['x-sec01-csrf']});json(res,200,{proof:a.proof,csrf:a.csrf});}
    else {assert.deepEqual(Object.keys(b),[]);const a=await native('/sign-out',{});ok(a);json(res,200,{ok:true});}
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
 let a,b,s,x;
 errorStage='BROWSER_SCENARIOS';
 await test('BROWSER-03 unauthenticated issue denied',async()=>{const n=await countSessions();deny(await issue(page,{proof:randomBytes(32).toString('base64url'),csrf:randomBytes(32).toString('base64url')}));assert.equal(await countSessions(),n);});
 await test('BROWSER-04 pending MFA and missing CSRF denied',async()=>{a=await begin(page);const cookies=await c.cookies();attrs(cookies.find(x=>x.name.endsWith('.two_factor')));assert(!cookies.some(x=>x.name===AUTH_COOKIE));const n=await countSessions(),v=await verified();deny(await issue(page,a));deny(await post(page,'/ceremony/complete',{flow:a.flow,code:totp(secret)}));assert.equal(await countSessions(),n);assert.equal(await verified(),v);});
 await test('BROWSER-05 wrong TOTP denied, no verified proof',async()=>{const z=await freshPage();const v=await verified(),n=await countSessions();const f=await begin(z.page);const nearby=new Set([-2,-1,0,1,2].map(n=>totp(secret,Date.now()+n*30000)));let k=0;while(nearby.has(String(k).padStart(6,'0')))k++;deny(await post(z.page,'/ceremony/complete',{flow:f.flow,code:String(k).padStart(6,'0')},f.csrf));assert.equal(await verified(),v);assert.equal(await countSessions(),n);assert(!(await z.c.cookies()).some(x=>x.name===AUTH_COOKIE));await z.c.close();});
 await test('BROWSER-06 native MFA, browser cookies, privileged issue',async()=>{b=await finish(page,a);const cookies=await c.cookies();attrs(cookies.find(x=>x.name===AUTH_COOKIE));assert(!cookies.some(x=>x.name.endsWith('.two_factor')));const n=await countSessions();const result=await issue(page,b);assert.equal(result.status,201);assert.deepEqual(Object.keys(result.data).sort(),['csrf','ok']);s=result.data;const adminCookie=(await c.cookies()).find(x=>x.name==='pk_admin_lab');attrs(adminCookie,true);assert.equal(adminCookie.path,'/sec01-lab');assert(!/pk_admin_lab|better-auth/.test(await page.evaluate(()=>document.cookie)));assert.equal(await countSessions(),n+1);});
 await test('BROWSER-07 issue replay denied',async()=>{const n=await countSessions();deny(await issue(page,b));assert.equal(await countSessions(),n);});
 await test('BROWSER-08 CSRF, SQL write and idempotence',async()=>{assert.equal(await scalar(sw,'select sec01_admin.finish_expiry_sweep()'),true);x=await op();deny(await write(page,x));deny(await write(page,x,randomBytes(32).toString('hex')));assert.equal(await ledger(x),0);assert.equal(await pricing(),x.revision);const first=await write(page,x,s.csrf);assert.equal(first.status,201);assert.deepEqual(first.data,{revision:x.revision+1,replayed:false});const again=await write(page,x,s.csrf);assert.equal(again.status,201);assert.deepEqual(again.data,{revision:x.revision+1,replayed:true});assert.equal(await ledger(x),1);});
 const foreignPage=await c.newPage();await foreignPage.goto('http://localhost:55447/');
 await test('BROWSER-09 cross-origin CORS preflight blocked',async()=>{const y=await op(),start=seen.length;const blocked=await foreignPage.evaluate(async({url,y})=>{try{await fetch(url,{method:'POST',credentials:'include',headers:{'content-type':'application/json','x-sec01-csrf':'0'.repeat(64)},body:JSON.stringify(y)});return false;}catch(e){return e instanceof TypeError;}},{url:BASE+'/sec01-lab/write',y});assert.equal(blocked,true);const reqs=seen.slice(start).filter(x=>x.route==='/sec01-lab/write');assert(reqs.some(x=>x.method==='OPTIONS'));assert(!reqs.some(x=>x.method==='POST'));assert.equal(await ledger(y),0);assert.equal(await pricing(),y.revision);});
 await test('BROWSER-10 cross-site form excludes Strict cookie and denies write',async()=>{const y=await op(),start=seen.length;const nav=foreignPage.waitForNavigation({timeout:10000});await foreignPage.evaluate(url=>{const f=document.createElement('form');f.action=url;f.method='POST';document.body.append(f);f.submit();},BASE+'/sec01-lab/write');const response=await nav;assert.equal(response.status(),403);const hit=seen.slice(start).find(x=>x.route==='/sec01-lab/write'&&x.method==='POST');assert(hit);assert.equal(hit.site,'cross-site');assert.equal(hit.privileged,false);assert.equal(await ledger(y),0);assert.equal(await pricing(),y.revision);});
 await test('BROWSER-11 privileged logout clears cookie and denies write',async()=>{const y=await op();const z=await post(page,'/sec01-lab/logout',{},s.csrf);assert.equal(z.status,201);assert(!(await c.cookies()).some(x=>x.name==='pk_admin_lab'));deny(await write(page,y,s.csrf));assert.equal(await ledger(y),0);});
 await test('BROWSER-12 provider logout revokes privilege in SQL',async()=>{const z=await freshPage();const f=await begin(z.page),proof=await finish(z.page,f),grant=await issue(z.page,proof);assert.equal(grant.status,201);const cookie=(await z.c.cookies()).find(x=>x.name==='pk_admin_lab');attrs(cookie,true);const id=cookie.value.split('.')[1];assert.equal(await scalar(sw,'select sec01_admin.finish_expiry_sweep()'),true);const y=await op();const out=await post(z.page,'/ceremony/native-logout',{});assert.equal(out.status,200);assert(!(await z.c.cookies()).some(x=>x.name===AUTH_COOKIE));deny(await write(z.page,y,grant.data.csrf));assert.equal(await ledger(y),0);assert.equal(await scalar(admin,"select count(*)::int from sec01_admin.security_audit where session_id=$1 and event_kind='provider_session_logout'",[id]),1);await z.c.close();});
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
 report('SUMMARY',fatal||failed||!cleanup||passed!==TOTAL?'INCOMPLETE':'PASS',{pass:passed,fail:failed,notRun:TOTAL-passed-failed,scope:'synthetic real Chromium HTTPS network ceremony and SQL; not production'});
 process.exitCode=fatal||failed||!cleanup||passed!==TOTAL?1:0;
}
