import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const paths=execFileSync('git',['diff','--name-only','81b9952444723caa80125b10c3fca0938391e167','HEAD'],{encoding:'utf8'}).trim().split('\n');
assert(paths.length>0);
for(const p of paths){
 assert(p.startsWith('apps/api/security/sec01-compose/')||/^apps\/api\/src\/j04\/sec01-(compose-ports|runtime|resilience)\.ts$/.test(p)||/^\.github\/workflows\/sec01-compose-[ab]\.yml$/.test(p),'UNEXPECTED_PRODUCT_CHANGE '+p);
 const s=fs.readFileSync(p,'utf8');
 assert(!/https:\/\/[a-z0-9]{20}\.supabase\.co|app\.notion\.com\/p\/|drive\.google\.com\/file\/|file_[a-f0-9]{32}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sb_secret_[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(s),'SECRET_SHAPE '+p);
}
const app=fs.readFileSync('apps/api/src/app.module.ts','utf8');
assert(!/Sec01|sec01|BetterAuth|betterAuth/.test(app));
for(const path of ['vercel.json','apps/api/vercel.json','apps/web/vercel.json'])assert.equal(JSON.parse(fs.readFileSync(path)).git.deploymentEnabled,false);
const context=fs.readFileSync('apps/api/security/sec01-compose/context-binding.sql','utf8');
assert(context.includes('REVOKE EXECUTE ON FUNCTION sec01_admin.write_bound_pricing')&&context.includes('REVOKE EXECUTE ON FUNCTION sec01_admin.revoke_own_session'));
const resilience=fs.readFileSync('apps/api/security/sec01-compose/runtime-resilience.sql','utf8');
assert(resilience.includes('REVOKE EXECUTE ON FUNCTION sec01_admin.reserve_login')&&resilience.includes('SECURITY DEFINER SET search_path='));
console.log('STATIC_BOUNDARIES PASS '+JSON.stringify({changedPaths:paths.length,scope:'allowlist, known secret patterns, inactive LIVE module, Vercel auto-deploy disabled, legacy grants revoked; not exhaustive secret/license or independent human audit'}));
