// Disposable child. No secrets in argv or logs. Parent kills only its own spawned process.
import assert from 'node:assert/strict';
import {Client,Pool} from 'pg';
import {betterAuth} from 'better-auth';
import {twoFactor} from 'better-auth/plugins';
let raw='';for await(const chunk of process.stdin)raw+=chunk;
const a=JSON.parse(raw);let c,pool;
try{
 assert.equal(a.port,55444);assert.equal(a.database,'panokit_sec01_sovereign_lab');
 const cfg={host:'127.0.0.1',port:a.port,database:a.database,connectionTimeoutMillis:5000,statement_timeout:10000};
 if(a.mode==='uncommitted'||a.mode==='committed'){
  c=new Client({...cfg,user:'sec01_admin_revoker',password:a.rolePassword});await c.connect();
  if(a.mode==='uncommitted')await c.query('begin');
  assert.equal((await c.query('select sec01_admin.recovery_open($1,$2) as phase',[a.actor,a.op])).rows[0].phase,'frozen');
 }else if(a.mode==='native-password'){
  pool=new Pool({...cfg,user:'panokit_mfa_lab',password:a.rolePassword,max:2});
  const base='http://127.0.0.1:55445';
  const auth=betterAuth({database:pool,baseURL:base,secret:a.authSecret,trustedOrigins:[base],emailAndPassword:{enabled:true},session:{cookieCache:{enabled:false}},rateLimit:{enabled:false},logger:{disabled:true},plugins:[twoFactor({issuer:'PANOKIT LAB',skipVerificationOnEnable:false,twoFactorCookieMaxAge:45,totpOptions:{digits:6,period:30},accountLockout:{enabled:true,maxFailedAttempts:10,durationSeconds:900}})]});
  const res=await auth.handler(new Request(base+'/api/auth/change-password',{method:'POST',headers:{origin:base,cookie:a.cookie,'content-type':'application/json'},body:JSON.stringify({currentPassword:a.oldPassword,newPassword:a.newPassword,revokeOtherSessions:true})}));
  assert(res.status>=200&&res.status<300);
 }else throw Error('BAD_MODE');
 process.stdout.write('READY\n');await new Promise(()=>setInterval(()=>{},1000));
}catch{process.stdout.write('FAILED\n');process.exitCode=1;}finally{if(c)await c.end().catch(()=>{});if(pool)await pool.end().catch(()=>{});}
