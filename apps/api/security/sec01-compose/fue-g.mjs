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
const TOTAL=7, PORT=55444, BASE='https://127.0.0.1:55445', TLS_ORIGIN='https://127.0.0.1:55445', DB='panokit_sec01_sovereign_lab';
const AUTH_COOKIE='__Secure-better-auth.session_token';
const sessionCookie=raw=>rawSessionCookie(raw,AUTH_COOKIE);
const roles=['mfa_verifier','issuer','writer','revoker','logout','sweeper'],clients=[];
let admin,v,i,w,r,l,sw,actor,broker;
const scalar=async(c,q,args=[])=>Object.values((await c.query(q,args)).rows[0])[0];
const sqlDenied=async fn=>assert.rejects(fn,e=>e?.code==='42501');
const brokerDenied=async fn=>assert.rejects(fn,e=>e?.message==='SEC01_CEREMONY_DENIED');
const report=(name,status,extra={})=>console.log(JSON.stringify({name,status,...extra}));
let pg, pool, bootstrap, started=false, startAttempted=false, passed=0, failed=0, fatal=false, cleanup=true;
let auth, app, material, current, errorStage='PREFLIGHT', keyDir, supervisor;
let browser, foreign, home; const contexts=[];
const pw=randomBytes(32).toString('hex');let authSecret;
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
 const {Sec01KeyStore,keyId,loadFencedKeys,createFencedLoginPort,ExpirySupervisor}=req(process.env.COMPOSE_RESILIENCE);keyDir=mkdtempSync(path.join(tmpdir(),'panokit-sec01-keys-'));const store=new Sec01KeyStore(keyDir),fixed=store.provisionFixed(),initialReplay=store.persistReplay();authSecret=fixed.auth.toString('hex');
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

 await admin.query(readFileSync(new URL('./context-binding.sql',import.meta.url),'utf8'));report('CONTEXT_MIGRATION','PASS');await admin.query(readFileSync(new URL('./runtime-resilience.sql',import.meta.url),'utf8'));report('RESILIENCE_MIGRATION','PASS');
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
 let rate=await connect('sec01_admin_login_guard',ratePassword),rate2=await connect('sec01_admin_login_guard',ratePassword);
 assert.equal(await scalar(r,'select sec01_admin.register_runtime_keys($1,$2,$3)',[keyId(fixed.login),keyId(fixed.token),keyId(fixed.auth)]),true);assert.equal(await scalar(r,'select sec01_admin.rotate_replay_key($1)',[initialReplay]),true);let keys=await loadFencedKeys(store,v),replayKey=keys.replay;const tokenKey=keys.token,loginKey=keys.login;
 const {createComposePorts}=req(process.env.COMPOSE_PORTS),{Sec01ComposeModule,createNativeProvider}=req(process.env.COMPOSE_RUNTIME);
 let ports=await createComposePorts({verifier:v,sweeper:sw,issuer:i,writer:w,logout:l},replayKey);
 const v2=await connect('sec01_admin_mfa_verifier',rolePasswords.mfa_verifier),i2=await connect('sec01_admin_issuer',rolePasswords.issuer),w2=await connect('sec01_admin_writer',rolePasswords.writer),l2=await connect('sec01_admin_logout',rolePasswords.logout),sw2=await connect('sec01_admin_sweeper',rolePasswords.sweeper);
 const ports2=await createComposePorts({verifier:v2,sweeper:sw2,issuer:i2,writer:w2,logout:l2},replayKey);
 const provider=createNativeProvider(BASE,x=>auth.handler(x),async email=>{const rows=(await pool.query('select id from public."user" where email=$1',[email])).rows;return rows.length===1?rows[0].id:null;});
 let guard=createLoginGuard({db:await createFencedLoginPort(rate,loginKey),key:loginKey,origin:BASE}),guard2=createLoginGuard({db:await createFencedLoginPort(rate2,loginKey),key:loginKey,origin:BASE});
 home=mkdtempSync(path.join(tmpdir(),'panokit-compose-b-'));
 const p=x=>path.join(home,x),openssl=args=>execFileSync('openssl',args,{stdio:'pipe',timeout:30000});
 openssl(['req','-x509','-newkey','rsa:2048','-nodes','-sha256','-days','1','-subj','/CN=PANOKIT ephemeral test CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign','-keyout',p('ca.key'),'-out',p('ca.pem')]);
 openssl(['req','-new','-newkey','rsa:2048','-nodes','-subj','/CN=PANOKIT loopback','-keyout',p('leaf.key'),'-out',p('leaf.csr')]);
 writeFileSync(p('leaf.ext'),'subjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n');
 openssl(['x509','-req','-in',p('leaf.csr'),'-CA',p('ca.pem'),'-CAkey',p('ca.key'),'-CAcreateserial','-days','1','-sha256','-extfile',p('leaf.ext'),'-out',p('leaf.pem')]);
 req('reflect-metadata');const {NestFactory}=req('@nestjs/core');
 const apps=[];
 const start=async(port,ports,writer,logout,guard)=>{const x=await NestFactory.create(Sec01ComposeModule.disposable({origin:BASE,ports,writer,logout,guard,provider,replayKey,tokenKey}),{bodyParser:false,logger:false,abortOnError:false,httpsOptions:{key:readFileSync(p('leaf.key')),cert:readFileSync(p('leaf.pem')),minVersion:'TLSv1.2'}});x.use((req,res,next)=>{if(req.method==='GET'&&req.url==='/sec01/fue'){res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(readFileSync(new URL('./fue-ui.html',import.meta.url)));}else next();});apps.push(x);await x.listen(port,'127.0.0.1');assert.equal(x.getHttpServer().address().address,'127.0.0.1');return x;};
 app={close:async()=>{for(const x of apps.splice(0).reverse())await x.close();}};
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

 errorStage='FUE_G';
 const out=process.env.FUE_EVIDENCE;assert(out&&path.isAbsolute(out));mkdirSync(out,{recursive:true,mode:0o700});
 const browserReq=createRequire(path.join(process.env.BROWSER_DEPS,'package.json'));const {chromium}=browserReq('playwright');
 const nss=p('.pki/nssdb');mkdirSync(nss,{recursive:true,mode:0o700});
 try{execFileSync('certutil',['-L','-d','sql:'+nss],{stdio:'pipe'});}catch{execFileSync('certutil',['-N','--empty-password','-d','sql:'+nss],{stdio:'pipe'});}
 execFileSync('certutil',['-A','-d','sql:'+nss,'-n','PANOKIT ephemeral CA','-t','C,,','-i',p('ca.pem')],{stdio:'pipe'});
 browser=await chromium.launch({headless:true,env:{...process.env,HOME:home},timeout:30000});assert.equal(browser.version(),'159.0.8154.6');
 const url=BASE+'/sec01/fue',ctx=await browser.newContext({ignoreHTTPSErrors:false,viewport:{width:900,height:780}}),page=await ctx.newPage();
 const evidence=[],snapshot=async()=>{const row=(await admin.query('select revision,config from sec01_admin.pricing where id=1')).rows[0];return {...row,ledger:await scalar(admin,'select count(*)::int from sec01_admin.operation_ledger')};};
 const proof=(step,details)=>{const entry={step,...details};evidence.push(entry);report('FUE_EVIDENCE','PASS',entry);};
 const status=async(p,expected)=>{await p.waitForFunction(s=>document.getElementById('status').textContent===s,expected);assert.equal(await p.locator('#status').innerText(),expected);};
 const click=async(p,id,route,expected)=>{const [response]=await Promise.all([p.waitForResponse(r=>r.url()===BASE+'/sec01/'+route&&r.request().method()==='POST'),p.locator('#'+id).click()]);assert.equal(response.status(),expected);return response;};
 const shot=async(p,name)=>{assert.equal(await p.locator('#password').inputValue(),'');assert.equal(await p.locator('#otp').inputValue(),'');assert.equal(await p.locator('#email').inputValue(),'');await p.screenshot({path:path.join(out,name+'.png'),fullPage:true,animations:'disabled'});};
 const waitFor=async f=>{for(let k=0;k<200;k++){if(await f())return;await sleep(25);}throw Error('SUPERVISOR_TIMEOUT');};
 let before,after,opId,oldCookie,oldCsrf;
 await test('FUE-01 BEFORE clean browser and fresh PostgreSQL state',async()=>{
  const response=await page.goto(url);assert.equal(response.status(),200);assert.match((await response.securityDetails()).protocol,/TLS 1\.[23]/);
  await status(page,'Déconnecté');assert.equal(await page.locator('#editor').isVisible(),false);
  before=await snapshot();assert.deepEqual(before,{revision:1,config:{},ledger:0});assert.equal((await ctx.cookies(url)).length,0);
  proof('BEFORE',{ui:'Déconnecté',db:before,editorVisible:false,browser:browser.version()});await shot(page,'01-before');
 });
 await test('FUE-02 user clicks login and native TOTP, then sees privileged session',async()=>{
  await page.locator('#email').fill(alice.email);await page.locator('#password').fill(alice.password);
  await click(page,'begin','begin',200);await status(page,'Deuxième facteur requis');assert.equal(await page.locator('#editor').isVisible(),false);await shot(page,'02-mfa');
  await delay();await page.locator('#otp').fill(totp(alice.secret));const issued=page.waitForResponse(r=>r.url()===BASE+'/sec01/issue'&&r.request().method()==='POST');
  await click(page,'verify','complete',200);const response=await issued;assert.equal(response.status(),200);oldCsrf=(await response.json()).csrf;await status(page,'Session privilégiée active');
  assert.equal(await page.locator('#editor').isVisible(),true);
  const cookies=await ctx.cookies(url);const native=cookies.find(c=>c.name===AUTH_COOKIE),priv=cookies.find(c=>c.name==='pk_admin_compose');assert(native&&priv&&native.httpOnly&&native.secure&&priv.httpOnly&&priv.secure&&priv.sameSite==='Strict');
  oldCookie=native.name+'='+native.value+'; '+priv.name+'='+priv.value;assert.equal((await provider.read(native.name+'='+native.value)).subject,alice.subject);
  assert.deepEqual(await snapshot(),before);proof('AUTH',{http:[200,200,200],ui:'Session privilégiée active',dbUnchanged:true,cookieProtected:true});await shot(page,'03-session');
 });
 await test('FUE-03 write without worker denied with no false confirmation',async()=>{
  await page.locator('#revision').fill('1');await page.locator('#value').fill('17');
  const response=await click(page,'save','write',403);opId=response.request().postDataJSON().operation;
  await status(page,'Écriture refusée — aucune confirmation');assert.deepEqual(await snapshot(),before);
  proof('DENIED_NO_HEARTBEAT',{http:403,ui:'Écriture refusée — aucune confirmation',db:await snapshot()});await shot(page,'04-refused');
 });
 await test('FUE-04 FIRST VALUE real worker and UI retry commit exact fixture once',async()=>{
  supervisor=new ExpirySupervisor(ports.sweep,30,100);supervisor.start();await waitFor(()=>supervisor.status().complete);
  const response=await click(page,'retry','write',200);assert.equal(response.request().postDataJSON().operation,opId);
  await status(page,'Enregistrement confirmé — révision 2');assert.deepEqual(await response.json(),{revision:2,replayed:false});
  after=await snapshot();assert.deepEqual(after,{revision:2,config:{fueFixture:17},ledger:1});assert.equal(await scalar(admin,'select count(*)::int from sec01_admin.operation_ledger where operation_id=$1 and actor_id=$2',[opId,alice.actor]),1);
  proof('FIRST_VALUE',{http:200,ui:'Enregistrement confirmé — révision 2',db:after,actorBound:true});await shot(page,'05-first-value');
 });
 await test('FUE-05 repeated click is idempotent with one ledger entry',async()=>{
  const response=await click(page,'retry','write',200);assert.equal(response.request().postDataJSON().operation,opId);assert.deepEqual(await response.json(),{revision:2,replayed:true});await status(page,'Rejeu confirmé — révision 2');assert.deepEqual(await snapshot(),after);
  proof('REPLAY',{http:200,replayed:true,db:await snapshot()});await shot(page,'06-idempotent');
 });
 await test('FUE-06 workshop profile is refused and cannot mutate from independent browser',async()=>{
  const other=await browser.newContext({ignoreHTTPSErrors:false,viewport:{width:900,height:780}});try{const p=await other.newPage();await p.goto(url);await p.locator('#email').fill(atelier.email);await p.locator('#password').fill(atelier.password);await click(p,'begin','begin',403);await status(p,'Accès refusé');assert.equal(await p.locator('#editor').isVisible(),false);
   const code=await p.evaluate(async()=>{const r=await fetch('/sec01/write',{method:'POST',headers:{'content-type':'application/json','x-sec01-csrf':'0'.repeat(64)},body:JSON.stringify({operation:crypto.randomUUID(),revision:2,config:{fueFixture:99}})});return r.status;});assert.equal(code,403);assert.deepEqual(await snapshot(),after);
   proof('ATELIER',{loginHttp:403,writeHttp:403,editorVisible:false,db:await snapshot()});await shot(p,'07-atelier-refused');
  }finally{await other.close();}
 });
 await test('FUE-07 logout removes cookies and old session cannot replay; reload is locked',async()=>{
  await click(page,'logout','logout',200);await status(page,'Déconnecté — session révoquée');assert.equal(await page.locator('#editor').isVisible(),false);assert(!(await ctx.cookies(url)).some(c=>c.name===AUTH_COOKIE||c.name==='pk_admin_compose'));
  const old=await send('/sec01/write',{operation:opId,revision:1,config:{fueFixture:17}},{cookie:oldCookie,csrf:oldCsrf});
  denied(old);assert.deepEqual(await snapshot(),after);await page.reload();await status(page,'Déconnecté');assert.equal(await page.locator('#editor').isVisible(),false);
  proof('AFTER_LOGOUT',{logoutHttp:200,oldCredentialHttp:403,editorVisible:false,db:await snapshot(),protectedCookiesCleared:true});await shot(page,'08-logged-out');
 });
 writeFileSync(path.join(out,'fue-proof.json'),JSON.stringify({scope:'FUE-G SEC-01 candidate; synthetic UI harness, no production pricing or LIVE',baseline:'acbf17e515f3d31f6f12175f02165a145d058b3c',firstValue:'authenticated admin commits synthetic configuration once; unauthorized paths do not mutate',evidence},null,2)+'\n');
} catch(e){fatal=true;report('RUN','STOPPED',{stage:errorStage,scenario:current??null,kind:e instanceof assert.AssertionError?'ASSERTION':'RUNTIME',code:/^[A-Z0-9_]{1,40}$/.test(e?.code??'')?e.code:undefined});}
finally{
 if(browser)try{await browser.close();}catch{cleanup=false;}
 if(foreign)try{await new Promise((resolve,reject)=>foreign.close(e=>e?reject(e):resolve()));}catch{cleanup=false;}
 if(supervisor)try{await supervisor.stop();}catch{cleanup=false;}
 if(keyDir)try{rmSync(keyDir,{recursive:true,force:true});}catch{cleanup=false;}
 if(app)try{await app.close();await freePort(55445);await freePort(55446);}catch{cleanup=false;}
 if(home)try{rmSync(home,{recursive:true,force:true});}catch{cleanup=false;}
 for(const c of clients.reverse())try{await c.end();}catch{cleanup=false;}
 if(pool)try{await pool.end();}catch{cleanup=false;}
 if(bootstrap)try{await bootstrap.end();}catch{cleanup=false;}
 if(startAttempted)try{await pg.stop();await freePort(PORT);}catch{cleanup=false;}
 report('CLEANUP',cleanup?(started?'PASS':'NOT_STARTED'):'FAIL');
 report('SUMMARY',fatal||failed||!cleanup||passed!==TOTAL?'INCOMPLETE':'PASS',{pass:passed,fail:failed,notRun:TOTAL-passed-failed,scope:'FUE-G SEC01 UI clicks and backend/SQL proofs; synthetic disposable only'});
 process.exitCode=fatal||failed||!cleanup||passed!==TOTAL?1:0;
}
