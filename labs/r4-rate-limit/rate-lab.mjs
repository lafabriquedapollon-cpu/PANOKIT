// R4-BROWSER-01: separate synthetic laboratory. Bootstrap derived from certified TLS harness; original untouched.
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
const TOTAL=13, PORT=55444, BASE='https://127.0.0.1:55445', TLS_ORIGIN='https://127.0.0.1:55445', DB='panokit_sec01_sovereign_lab';
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
 await admin.query(readFileSync(new URL('./lifecycle-lab.sql',import.meta.url),'utf8'));report('LIFECYCLE_MIGRATION','PASS');await admin.query(readFileSync(new URL('./totp-guard.sql',import.meta.url),'utf8'));report('TOTP_GUARD_MIGRATION','PASS');await admin.query(readFileSync(new URL('./login-budget.sql',import.meta.url),'utf8'));report('LOGIN_BUDGET_MIGRATION','PASS');
 const roleConnections=[];for(const role of roles){const password=randomBytes(32).toString('hex');await admin.query(`alter role sec01_admin_${role} password '${password}'`);roleConnections.push(await connect('sec01_admin_'+role,password));}
 [v,i,w,r,l,sw]=roleConnections;
 const ids=await Promise.all(roleConnections.map(c=>c.query('select session_user as su,current_user as cu,pg_backend_pid() as pid')));assert.equal(new Set(ids.map(x=>x.rows[0].pid)).size,6);ids.forEach((x,j)=>{assert.equal(x.rows[0].su,'sec01_admin_'+roles[j]);assert.equal(x.rows[0].cu,x.rows[0].su);});report('SQL_ROLES','PASS',{count:6});
 const enrollment=new Jar();ok(await call(enrollment,'/sign-up/email',{email,password,name:'PANOKIT LAB'}));const first=await session(enrollment);assert(first?.user?.id);subject=first.user.id;const result=await call(enrollment,'/two-factor/enable',{password,method:'totp'});ok(result);assert.equal(result.data?.method,'totp');secret=parseUri(result.data.totpURI);await delay();ok(await call(enrollment,'/two-factor/verify-totp',{code:totp(secret),trustDevice:false}));const enrolled=await session(enrollment);assert.equal(enrolled?.user?.twoFactorEnabled,true);enrolledSession=enrolled.session.id;const enrollmentCookie=sessionCookie(enrollment.header());
 // Owner-controlled synthetic mapping. Never accept an actor/subject from client input.
 actor=randomUUID();await admin.query('insert into sec01_admin.accounts(actor_id,better_auth_subject,active,can_edit) values($1,$2,true,true)',[actor,subject]);
 const cookieJar=raw=>{const pair=sessionCookie(raw);const n=pair.indexOf('=');return new Jar([[pair.slice(0,n),pair.slice(n+1)]]);};

 errorStage='RATE_LIMIT';
 const ratePassword=randomBytes(32).toString('hex');await admin.query("alter role sec01_admin_login_guard password '"+ratePassword+"'");
 const ratePool=()=>new Pool({host:'127.0.0.1',port:PORT,database:DB,user:'sec01_admin_login_guard',password:ratePassword,max:12,connectionTimeoutMillis:5000,statement_timeout:10000});
 let rate=ratePool();const ratePools=[rate];let rateClosed=false;
 const key=randomBytes(32);let guard=createLoginGuard({db:rate,key,origin:BASE});
 const tag=(kind,value)=>createHmac('sha256',key).update('PANOKIT/LOGIN/v1'+String.fromCharCode(0)+kind+String.fromCharCode(0)+value).digest();
 const als=new AsyncLocalStorage();let nativeCalls=0;
 const incoming=()=>{const x=als.getStore();assert(x);return x;};
 async function native(route,body){
  const {req}=incoming(),headers=new Headers({origin:BASE,accept:'application/json','content-type':'application/json'});
  if(req.headers.cookie)headers.set('cookie',req.headers.cookie);
  const response=await auth.handler(new Request(BASE+'/api/auth'+route,{method:'POST',headers,body:JSON.stringify(body)}));
  const cookies=response.headers.getSetCookie();incoming().cookies.push(...cookies);
  let data=null;try{data=await response.json();}catch{}return {status:response.status,data,headers:response.headers};
 }
 const pair=raw=>{const a=(raw??'').split(';').map(x=>x.trim()).filter(x=>x.split('=')[0].endsWith('.two_factor'));assert.equal(a.length,1);return a[0];};
 const provider={begin:async credentials=>{nativeCalls++;const x=await native('/sign-in/email',credentials);ok(x);assert.equal(credentials.email,email);assert.equal(x.data?.twoFactorRedirect,true);const j=new Jar();j.update(x.headers);return pair(j.header());},
 complete:async(challenge,code)=>{const raw=incoming().req.headers.cookie;assert.equal(pair(raw),challenge);const j=new Jar(raw.split(';').map(x=>{const z=x.trim(),n=z.indexOf('=');return [z.slice(0,n),z.slice(n+1)];}));await noSession(j);const x=await native('/two-factor/verify-totp',{code,trustDevice:false});ok(x);j.update(x.headers);const s=await session(j);assert.equal(s.user.id,subject);return {subject:s.user.id,sessionId:s.session.id,authCookie:sessionCookie(j.header())};},
 revokeSession:async raw=>{const j=cookieJar(raw);ok(await call(j,'/sign-out',{}));await noSession(cookieJar(raw));},
 readSession:async raw=>{const s=await session(cookieJar(raw));return s?.session?.id?{subject:s.user.id,sessionId:s.session.id}:null;}};
 const replayKey=randomBytes(32);const makeBroker=()=>createBroker({subject,provider,sql:{reserve:async(sub,digest,tag)=>scalar(v,'select sec01_admin.reserve_totp($1,$2,$3)',[sub,digest,tag]),begin:async(sub,digest,expires)=>assert.equal(await scalar(v,'select sec01_admin.begin_mfa_proof($1,$2,$3)',[sub,digest,expires]),true),mark:async(sub,digest,id)=>assert.equal(await scalar(v,'select sec01_admin.mark_reserved_totp($1,$2,$3)',[sub,digest,id]),true)},key:randomBytes(32),replayKey,ttlMs:60000,cookieName:AUTH_COOKIE});
 broker=makeBroker();
 home=mkdtempSync(path.join(tmpdir(),'panokit-rate-'));
 const p=x=>path.join(home,x),openssl=args=>execFileSync('openssl',args,{stdio:'pipe',timeout:30000});
 openssl(['req','-x509','-newkey','rsa:2048','-nodes','-sha256','-days','1','-subj','/CN=PANOKIT rate lab CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign','-keyout',p('ca.key'),'-out',p('ca.pem')]);
 openssl(['req','-new','-newkey','rsa:2048','-nodes','-subj','/CN=PANOKIT loopback','-keyout',p('leaf.key'),'-out',p('leaf.csr')]);
 writeFileSync(p('leaf.ext'),'subjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n');
 openssl(['x509','-req','-in',p('leaf.csr'),'-CA',p('ca.pem'),'-CAkey',p('ca.key'),'-CAcreateserial','-days','1','-sha256','-extfile',p('leaf.ext'),'-out',p('leaf.pem')]);
 const json=(res,status,obj)=>{res.statusCode=status;res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(obj));};
 let server;
 const startServer=async()=>{server=httpsServer({key:readFileSync(p('leaf.key')),cert:readFileSync(p('leaf.pem')),minVersion:'TLSv1.2'},(req,res)=>{void als.run({req,cookies:[]},async()=>{try{
  if(req.url==='/ceremony/begin'){const a=await guard.admit(req);if(a.status!==200){req.resume();return json(res,a.status,{message:'SEC01 denied'});}const result=await broker.begin(a.credentials);const cookies=incoming().cookies;if(cookies.length)res.setHeader('Set-Cookie',cookies);return json(res,200,result);}
  if(req.url==='/ceremony/complete'&&req.method==='POST'&&req.headers.origin===BASE&&req.headers['sec-fetch-site']==='same-origin'&&req.headers['content-type']==='application/json'){let data='';for await(const chunk of req){data+=chunk;assert(data.length<=4096);}const b=JSON.parse(data);assert.deepEqual(Object.keys(b).sort(),['code','flow']);const a=await broker.complete({flow:b.flow,code:b.code,csrf:req.headers['x-sec01-csrf']});const cookies=incoming().cookies;if(cookies.length)res.setHeader('Set-Cookie',cookies);return json(res,200,{proof:a.proof,csrf:a.csrf});}
  req.resume();json(res,403,{message:'SEC01 denied'});
 }catch{res.removeHeader('Set-Cookie');req.resume();json(res,403,{message:'SEC01 denied'});}});});server.requestTimeout=10000;await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(55445,'127.0.0.1',resolve);});app={close:()=>new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))};};
 await startServer();
 const send=(body,{ip='127.0.0.1',route='/ceremony/begin',method='POST',headers={},raw=false,ca=true}={})=>new Promise((resolve,reject)=>{const data=raw?body:JSON.stringify(body);const q=httpsRequest(BASE+route,{method,localAddress:ip,agent:false,ca:ca?readFileSync(p('ca.pem')):undefined,rejectUnauthorized:true,headers:{origin:BASE,'sec-fetch-site':'same-origin','content-type':'application/json','content-length':Buffer.byteLength(data),...headers}},res=>{let s='';res.on('data',b=>s+=b);res.on('end',()=>{try{resolve({status:res.statusCode,data:JSON.parse(s),cookies:res.headers['set-cookie']??[]});}catch(e){reject(e);}});});q.on('error',reject);q.setTimeout(10000,()=>q.destroy(Error('REQUEST_TIMEOUT')));q.end(data);});
 const good={email,password},bad={email,password:'wrong-'+randomUUID()};
 const count=async(kind,value)=>{const x=await admin.query('select cardinality(hits)::int as n from sec01_admin.login_budget where kind=$1 and tag=$2',[kind,tag(kind,value)]);return x.rows[0]?.n??0;};
 const age=()=>admin.query("update sec01_admin.login_budget set hits=array(select clock_timestamp()-interval '121 seconds' from unnest(hits))");
 const proofCount=()=>scalar(admin,'select count(*)::int from sec01_admin.mfa_proofs');
 const noCookie=x=>assert.equal(x.cookies.length,0);
 const denial=x=>{assert.equal(x.status,403);assert.deepEqual(x.data,{message:'SEC01 denied'});noCookie(x);};
 const capped=x=>{assert.equal(x.status,429);assert.deepEqual(x.data,{message:'SEC01 denied'});noCookie(x);};
 const login=async(ip='127.0.0.1')=>{const a=await send(good,{ip});assert.equal(a.status,200);assert.deepEqual(Object.keys(a.data).sort(),['csrf','flow']);assert(a.cookies.some(x=>x.includes('.two_factor=')));return a;};
 try{
 await test('RATE-01 TLS trust and restricted SQL principal',async()=>{await assert.rejects(()=>send(good,{ca:false}));const c=await rate.connect();try{assert.equal(await scalar(c,'select session_user'),'sec01_admin_login_guard');await sqlDenied(()=>c.query('select * from sec01_admin.login_budget'));await sqlDenied(()=>c.query('select sec01_admin.reserve_login($1,$2)',['other',randomBytes(32)]));await sqlDenied(()=>c.query('select sec01_admin.begin_mfa_proof($1,$2,clock_timestamp()+interval \'10 seconds\')',[subject,randomBytes(32)]));}finally{c.release();}await sqlDenied(()=>v.query('select sec01_admin.reserve_login($1,$2)',['ip',randomBytes(32)]));});
 await test('RATE-02 wrong credentials and unknown account receive generic denial with no proof',async()=>{const n=nativeCalls,p=await proofCount();denial(await send(bad));denial(await send({email:'unknown@example.invalid',password:bad.password}));assert.equal(nativeCalls,n+2);assert.equal(await proofCount(),p);assert.equal(await count('account',email),1);});
 await test('RATE-03 account budget shared across distinct real socket IPs and case normalization',async()=>{await age();const before=nativeCalls;for(let k=1;k<=5;k++)denial(await send({...bad,email:k%2?email.toUpperCase():' '+email+' '},{ip:'127.0.0.'+k}));capped(await send(good,{ip:'127.0.0.6'}));assert.equal(nativeCalls,before+5);assert.equal(await count('account',email),5);});
 await test('RATE-04 successful password admissions count and cannot reset account budget',async()=>{await age();const n=nativeCalls;await login();for(let k=0;k<4;k++)denial(await send(bad));capped(await send(good));assert.equal(nativeCalls,n+5);assert.equal(await count('account',email),5);});
 await test('RATE-05 malformed bodies consume socket IP budget before native verification',async()=>{await age();const n=nativeCalls;for(let k=0;k<20;k++)denial(await send('{broken',{raw:true,ip:'127.0.0.7',headers:{'x-forwarded-for':'192.0.2.'+k}}));capped(await send(good,{ip:'127.0.0.7',headers:{'x-forwarded-for':'198.51.100.2','x-real-ip':'203.0.113.2'}}));assert.equal(nativeCalls,n);assert.equal(await count('ip','127.0.0.7'),20);assert.equal(await count('account',email),5);await login('127.0.0.8');});
 await test('RATE-06 concurrent account attempts admit exactly five native calls',async()=>{await age();const n=nativeCalls;const xs=await Promise.all(Array.from({length:9},(_,k)=>send(bad,{ip:'127.0.0.'+(10+k)})));assert.equal(xs.filter(x=>x.status===403).length,5);assert.equal(xs.filter(x=>x.status===429).length,4);assert.equal(nativeCalls,n+5);assert.equal(await count('account',email),5);});
 await test('RATE-07 concurrent malformed IP requests admit exactly twenty parser attempts',async()=>{await age();const n=nativeCalls;const xs=await Promise.all(Array.from({length:25},()=>send('x',{raw:true,ip:'127.0.0.21'})));assert.equal(xs.filter(x=>x.status===403).length,20);assert.equal(xs.filter(x=>x.status===429).length,5);assert.equal(nativeCalls,n);assert.equal(await count('ip','127.0.0.21'),20);});
 await test('RATE-08 malformed schema content type origin and oversized input denied',async()=>{await age();const n=nativeCalls;for(const b of [null,[],{email,password,extra:true},{email:4,password},{email,password:[]},{email:'invalid',password},{email,password:''}])denial(await send(b,{ip:'127.0.0.22'}));denial(await send(good,{ip:'127.0.0.22',headers:{origin:'https://foreign.invalid'}}));denial(await send(good,{ip:'127.0.0.22',headers:{'content-type':'text/plain'}}));const big=await send('x'.repeat(5000),{raw:true,ip:'127.0.0.22'});assert.equal(big.status,413);noCookie(big);assert.equal(nativeCalls,n);});
 await test('RATE-09 direct native routes and query variants denied without provider call',async()=>{const n=nativeCalls;for(const route of ['/api/auth/sign-in/email','/api/auth/two-factor/verify-totp','/api/auth/sign-in/%65mail','/ceremony/begin?x=1','/ceremony/%62egin'])denial(await send(good,{route}));assert.equal(nativeCalls,n);});
 await test('RATE-10 budget survives gateway recreation and SQL pool replacement',async()=>{await age();for(let k=0;k<5;k++)denial(await send(bad));const n=nativeCalls;await app.close();app=null;await rate.end();rateClosed=true;rate=ratePool();ratePools.push(rate);rateClosed=false;guard=createLoginGuard({db:rate,key,origin:BASE});broker=makeBroker();await startServer();capped(await send(good,{ip:'127.0.0.23'}));assert.equal(nativeCalls,n);assert.equal(await count('account',email),5);});
 await test('RATE-11 future clock and unavailable DB fail closed before password verification',async()=>{await age();await admin.query("update sec01_admin.login_budget set hits=array[clock_timestamp()+interval '60 seconds'] where kind='account' and tag=$1",[tag('account',email)]);const n=nativeCalls;capped(await send(good,{ip:'127.0.0.24'}));const original=guard;guard=createLoginGuard({db:{query:async()=>{throw Error('DB_UNAVAILABLE');}},key,origin:BASE});try{denial(await send(good,{ip:'127.0.0.24'}));}finally{guard=original;}assert.equal(nativeCalls,n);});
 await test('RATE-12 aged window reopens and full native TOTP still binds proof',async()=>{await age();await delay();const a=await login('127.0.0.25'),cookie=a.cookies.map(x=>x.split(';')[0]).join('; ');const n=await scalar(admin,'select count(*)::int from sec01_admin.mfa_proofs where verified_at is not null');const x=await send({flow:a.data.flow,code:totp(secret)},{route:'/ceremony/complete',ip:'127.0.0.25',headers:{cookie,'x-sec01-csrf':a.data.csrf}});assert.equal(x.status,200);assert(x.cookies.some(x=>x.startsWith(AUTH_COOKIE+'=')));assert.equal(await scalar(admin,'select count(*)::int from sec01_admin.mfa_proofs where verified_at is not null'),n+1);});
 await test('RATE-13 database stores only keyed tags and bounded timestamp arrays',async()=>{const fields=(await admin.query("select column_name from information_schema.columns where table_schema='sec01_admin' and table_name='login_budget' order by ordinal_position")).rows.map(x=>x.column_name);assert.deepEqual(fields,['kind','tag','hits']);assert.equal(await scalar(admin,"select count(*)::int from sec01_admin.login_budget where octet_length(tag)<>32 or cardinality(hits)>20"),0);assert.equal(await count('account',email),1);});
 }finally{if(!rateClosed)await rate.end();}
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
 report('SUMMARY',fatal||failed||!cleanup||passed!==TOTAL?'INCOMPLETE':'PASS',{pass:passed,fail:failed,notRun:TOTAL-passed-failed,scope:'direct trusted TLS IPv4 loopback ingress, persistent account/IP password limiter, real native auth, concurrency and gateway recreation; synthetic lab only'});
 process.exitCode=fatal||failed||!cleanup||passed!==TOTAL?1:0;
}
