// Isolated lab candidate. Trusted in-process provider/SQL ports only; no HTTP endpoint.
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
const opaque=/^[A-Za-z0-9_-]{43}$/;
const deny=()=>{throw Error('SEC01_CEREMONY_DENIED');};
const random=()=>randomBytes(32).toString('base64url');
const eq=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function sessionCookie(raw,name='better-auth.session_token'){
 if(typeof raw!=='string'||raw.length>8192||/[\r\n\0]/.test(raw))deny();
 const matches=[];for(const p of raw.split(';')){const s=p.trim();if(!s)continue;const i=s.indexOf('=');if(i<1)deny();const k=s.slice(0,i);if(k===name)matches.push(s.slice(i+1));}
 if(matches.length!==1||!matches[0]||! /^[A-Za-z0-9._%~+=\/-]{1,2048}$/.test(matches[0]))deny();return `${name}=${matches[0]}`;
}
export function createBroker({subject,provider,sql,key,now=Date.now,ttlMs=60000,maxFlows=64,cookieName='better-auth.session_token'}){
 if(typeof subject!=='string'||subject.length<6||subject.length>150||!(key instanceof Uint8Array)||key.byteLength<32||!Number.isInteger(ttlMs)||ttlMs<1||ttlMs>110000||!Number.isInteger(maxFlows)||maxFlows<1||maxFlows>128)throw Error('BAD_LAB_CONFIG');
 const secret=Buffer.from(key),flows=new Map();
 const digest=(domain,s)=>createHmac('sha256',secret).update(domain+'\0'+s).digest();
 const cleanup=()=>{for(const [k,f] of flows)if(f.expires<=now())flows.delete(k);};
 function lookup(flow,csrf,state){cleanup();if(typeof flow!=='string'||!opaque.test(flow)||typeof csrf!=='string'||!opaque.test(csrf))deny();const f=flows.get(flow);if(!f||f.state!==state||!eq(f.csrf,csrf))deny();return f;}
 function live(flow,f){if(flows.get(flow)!==f||f.expires<=now())deny();}
 return Object.freeze({
  async begin(credentials){cleanup();if(flows.size>=maxFlows)deny();const flow=random(),csrf=random(),f={state:'starting',csrf,expires:now()+ttlMs,digest:digest('proof',flow)};flows.set(flow,f);
   try{const challenge=await provider.begin(credentials);live(flow,f);if(!challenge)deny();f.challenge=challenge;await sql.begin(subject,f.digest,new Date(f.expires));live(flow,f);f.state='pending';return {flow,csrf};}catch(e){flows.delete(flow);throw e;}
  },
  async complete({flow,csrf,code}){const f=lookup(flow,csrf,'pending');f.state='verifying';try{if(typeof code!=='string'||!/^\d{6}$/.test(code))deny();const s=await provider.complete(f.challenge,code);live(flow,f);if(s?.subject!==subject||typeof s.sessionId!=='string'||!s.sessionId)deny();const cookie=sessionCookie(s.authCookie,cookieName);const actual=await provider.readSession(cookie);live(flow,f);if(actual?.subject!==subject||actual.sessionId!==s.sessionId)deny();await sql.mark(subject,f.digest,s.sessionId);live(flow,f);f.state='verified';f.sessionId=s.sessionId;f.cookieDigest=digest('cookie',cookie);delete f.challenge;return {proof:flow,csrf,authCookie:cookie};}catch(e){flows.delete(flow);throw e;}
  },
  // Compatible with R3 verifyIssue. One shot even if later SQL issue fails.
  async verifyIssue({proof,csrf,authCookie}){const f=lookup(proof,csrf,'verified');const cookie=sessionCookie(authCookie,cookieName);if(!timingSafeEqual(f.cookieDigest,digest('cookie',cookie)))deny();f.state='consuming';try{const s=await provider.readSession(cookie);live(proof,f);if(s?.subject!==subject||s.sessionId!==f.sessionId)deny();return {subject,proofDigest:Buffer.from(f.digest)};}finally{flows.delete(proof);}
  },
 });
}
