import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import EmbeddedPostgres from 'embedded-postgres';
import pgDriver from 'pg';
const {Client}=pgDriver;
assert.deepEqual(process.argv.slice(2),['--disposable-lab']);
assert(process.getuid()!==0);
const req=createRequire(import.meta.url);
const {PILOT_MODEL,REQUIRED_EVIDENCE,industrialDigest,readApprovedPilotFormat}=req(process.env.J03_ADMISSION);
const {createIndustrialPgReadPort}=req(process.env.J03_PORT);
const dir=mkdtempSync(join(tmpdir(),'panokit-j03-')),db='panokit_j03_industrial_lab',port=55449;
const pw=randomBytes(32).toString('hex');
const pg=new EmbeddedPostgres({databaseDir:dir,user:'postgres',password:pw,port,authMethod:'scram-sha-256',persistent:true,postgresFlags:['-c','listen_addresses=127.0.0.1'],autoRehydrateSymlinks:true,onLog:()=>{},onError:()=>{}});
const clients=[],creds={},roles=['j03_editor','j03_approver','j03_revoker','j03_reader','j03_outsider'];let started=false,attempted=false,passed=0;
async function connect(user,password,database=db){const c=new Client({host:'127.0.0.1',port,database,user,password,connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:15000});clients.push(c);await c.connect();return c;}
const scalar=async(c,q,a=[])=>Object.values((await c.query(q,a)).rows[0])[0];
const denied=fn=>assert.rejects(fn,e=>e?.code==='42501');
async function test(name,fn){await fn();passed++;console.log('J03_C '+JSON.stringify({name,status:'PASS'}))}
function fixture(revision,formatId='test-only'){return {modelId:PILOT_MODEL,formatId,revision,widthMm:101+revision,heightMm:202,depthMm:30,labelFr:'TEST_ONLY',labelAr:'اختبار',evidence:REQUIRED_EVIDENCE.map((kind,i)=>({kind,privateRef:'fixture_evidence_'+i,sha256:String(i+1).repeat(64)}))}}
const save=(c,r,d=industrialDigest(r))=>scalar(c,'select j03_private.save_draft($1,$2,$3,$4)',[r.formatId,r.revision-1,JSON.stringify(r),d]);
const decide=(c,r,event,d=industrialDigest(r))=>scalar(c,'select j03_private.record_decision($1,$2,$3,$4)',[r.formatId,r.revision,d,event]);
const read=(c,id='test-only')=>readApprovedPilotFormat(createIndustrialPgReadPort(c,id));
let admin,reader;
try{
 await pg.initialise();attempted=true;await pg.start();started=true;
 const boot=await connect('postgres',pw,'postgres');
 const info=(await boot.query("select current_setting('server_version_num')::int as version,current_setting('listen_addresses') as bind")).rows[0];assert.equal(info.version,170012);assert.equal(info.bind,'127.0.0.1');console.log('J03_PG '+JSON.stringify(info));
 await boot.query('create database '+db);
 for(const role of roles){creds[role]=randomBytes(32).toString('hex');await boot.query("create role "+role+" login password '"+creds[role]+"' nosuperuser nocreatedb nocreaterole noreplication nobypassrls");}
 admin=await connect('postgres',pw);await admin.query('revoke connect,temporary on database '+db+' from public');await admin.query('grant connect on database '+db+' to '+roles.join(','));await admin.query('revoke create on schema public from public');
 await admin.query(readFileSync(new URL('./industrial-lab.sql',import.meta.url),'utf8'));
 const [editor,approver,revoker,rd,outsider]=await Promise.all(roles.map(r=>connect(r,creds[r])));reader=rd;
 const r1=fixture(1),r2=fixture(2),r3=fixture(3);
 await test('C01 empty and unknown format',async()=>{assert.equal(await read(reader),null);assert.equal(await read(reader,'other'),null)});
 await test('C02 role separation and no direct table access',async()=>{for(const c of [editor,approver,revoker,reader,outsider]){await denied(()=>c.query('select * from j03_private.revisions'));await denied(()=>c.query("update j03_private.events set event='approved'"));}await denied(()=>save(reader,r1));await denied(()=>save(approver,r1));await denied(()=>decide(editor,r1,'approved'));await denied(()=>decide(revoker,r1,'approved'));await denied(()=>decide(approver,r1,'withdrawn'));await denied(()=>outsider.query("select j03_private.read_snapshot('test-only')"));await denied(()=>editor.query("select j03_private.read_snapshot('test-only')"));await denied(()=>reader.query('set role j03_owner'));assert.equal(await read(admin),null)});
 await test('C03 draft persists but is invisible',async()=>{assert.equal(Number(await save(editor,r1)),1);assert.equal(await read(reader),null);assert.equal(Number(await scalar(admin,'select count(*) from j03_private.revisions')),1)});
 await test('C04 wrong digest and wrong revision do not approve',async()=>{assert.equal(await decide(approver,r1,'approved','f'.repeat(64)),false);assert.equal(await decide(approver,r2,'approved'),false);assert.equal(await read(reader),null)});
 await test('C05 exact approval yields minimal nonorderable projection',async()=>{assert.equal(await decide(approver,r1,'approved'),true);assert.equal(await decide(approver,r1,'approved'),false);const p=await read(reader);assert.deepEqual(p,{id:r1.formatId,revision:1,widthMm:r1.widthMm,heightMm:r1.heightMm,depthMm:r1.depthMm,labelFr:r1.labelFr,labelAr:r1.labelAr,orderable:false});assert(!JSON.stringify(p).includes('evidence'));assert.equal(await scalar(admin,"select actor::text from j03_private.events where event='approved'"),'j03_approver')});
 await test('C06 append only and next revision hides old approval',async()=>{assert.equal(Number(await save(editor,r2)),2);assert.equal(await read(reader),null);assert.equal(await decide(approver,r1,'approved'),false);assert.equal(Number(await scalar(admin,'select count(*) from j03_private.revisions')),2);assert.equal(await decide(approver,r2,'approved'),true);assert.equal((await read(reader)).revision,2)});
 await test('C07 withdrawal terminal and auditable',async()=>{assert.equal(await decide(revoker,r2,'withdrawn'),true);assert.equal(await read(reader),null);assert.equal(await decide(approver,r2,'approved'),false);assert.equal(await decide(revoker,r2,'withdrawn'),false);assert.equal(await scalar(admin,"select actor::text from j03_private.events where event='withdrawn'"),'j03_revoker')});
 await test('C08 concurrent optimistic writers one winner',async()=>{const second=await connect('j03_editor',creds.j03_editor);const outcomes=await Promise.allSettled([save(editor,r3),save(second,{...r3,widthMm:999})]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);const loser=outcomes.find(x=>x.status==='rejected');assert.equal(loser.reason.code,'40001');assert.equal(Number(await scalar(admin,'select count(*) from j03_private.revisions')),3);assert.equal(await read(reader),null)});
 await test('C09 validly shaped but false digest cannot publish',async()=>{const r=fixture(1,'bad-digest'),bad='e'.repeat(64);assert.equal(Number(await save(editor,r,bad)),1);assert.equal(await decide(approver,r,'approved',bad),true);assert.equal(await read(reader,'bad-digest'),null)});
 await test('C10 uncommitted decision not visible, rollback leaves no approval',async()=>{const r=fixture(1,'transaction');await save(editor,r);await approver.query('begin');try{assert.equal(await decide(approver,r,'approved'),true);assert.equal(await read(reader,r.formatId),null);}finally{await approver.query('rollback')}assert.equal(await read(reader,r.formatId),null);assert.equal(await decide(approver,r,'approved'),true);assert.equal((await read(reader,r.formatId)).revision,1)});
 await test('C11 persistent restart, approved and withdrawn state survive',async()=>{for(const c of clients.splice(0))await c.end();await pg.stop();started=false;await pg.start();started=true;reader=await connect('j03_reader',creds.j03_reader);admin=await connect('postgres',pw);assert.equal(await read(reader),null);assert.equal((await read(reader,'transaction')).revision,1);assert.equal(Number(await scalar(admin,"select count(*) from j03_private.events where event='withdrawn'")),1)});
 await test('C12 unavailable reader fails closed',async()=>{await reader.end();clients.splice(clients.indexOf(reader),1);assert.equal(await read(reader,'transaction'),null)});
 assert.equal(passed,12);console.log('J03_C_RESULT '+JSON.stringify({passed,failed:0,notRun:0}));
}finally{for(const c of clients)await c.end();if(started||attempted){if(started)await pg.stop();}rmSync(dir,{recursive:true,force:true});assert(!started||attempted);console.log('J03_C_CLEANUP PASS')}
