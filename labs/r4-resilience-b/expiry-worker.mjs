// Isolated disposable LAB worker. Credentials only via stdin, no raw logging.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {Client} from 'pg';
export async function runOnce(client,runId,limit){
 const r=await client.query('select * from sec01_admin.sweep_expiry_batch($1,$2)',[runId,limit]);
 assert.equal(r.rowCount,1);return r.rows[0];
}
if(process.argv[2]==='--disposable-lab'){
 let raw='';for await(const chunk of process.stdin){raw+=chunk;assert(raw.length<=4096);}
 const a=JSON.parse(raw);assert.equal(a.port,55444);assert.equal(a.database,'panokit_sec01_sovereign_lab');assert(Number.isInteger(a.limit)&&a.limit>=1&&a.limit<=100);
 const c=new Client({host:'127.0.0.1',port:a.port,database:a.database,user:'sec01_admin_sweeper',password:a.password,connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:15000});
 try{
  await c.connect();
  const identity=(await c.query('select current_database() as db, session_user as role')).rows[0];assert.equal(identity.db,a.database);assert.equal(identity.role,'sec01_admin_sweeper');
  if(a.mode==='hold-uncommitted'||a.mode==='hold-committed'){
   if(a.mode==='hold-uncommitted')await c.query('begin');
   await runOnce(c,a.runId,a.limit);process.stdout.write('READY\n');
   await new Promise(()=>setInterval(()=>{},1000));
  }else{
   assert.equal(a.mode,'loop');assert(Number.isInteger(a.cycles)&&a.cycles>=1&&a.cycles<=10);
   for(let k=0;k<a.cycles;k++){const result=await runOnce(c,randomUUID(),a.limit);process.stdout.write(JSON.stringify(result)+'\n');if(k+1<a.cycles)await sleep(50);}
  }
 }catch{process.stdout.write('FAILED\n');process.exitCode=1;}finally{await c.end().catch(()=>{});}
}
