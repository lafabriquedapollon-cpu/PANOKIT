// Disposable LAB ingress: direct TLS only; never trust forwarded headers.
import {createHmac} from 'node:crypto';
import {isIP} from 'node:net';
import {TextDecoder} from 'node:util';
export const normalizeEmail=x=>{
 if(typeof x!=='string'||x.length>254)return null;
 const e=x.trim().toLowerCase();
 return /^[a-z0-9][a-z0-9._+-]{0,63}@[a-z0-9][a-z0-9.-]{0,185}\.[a-z]{2,63}$/.test(e)?e:null;
};
export function createLoginGuard({db,key,origin}){
 if(!(key instanceof Uint8Array)||key.byteLength!==32||typeof db?.query!=='function')throw Error('BAD_CONFIG');
 const tag=(kind,value)=>createHmac('sha256',key).update('PANOKIT/LOGIN/v1\0'+kind+'\0'+value).digest();
 const reserve=async(kind,value)=>(await db.query('select sec01_admin.reserve_login($1,$2) as allowed',[kind,tag(kind,value)])).rows[0]?.allowed===true;
 return Object.freeze({
  async admit(req){
   let ip=req.socket.remoteAddress;
   if(typeof ip!=='string')return {status:403};
   if(ip.startsWith('::ffff:'))ip=ip.slice(7);
   // LAB binds IPv4 loopback. No claims for proxy or IPv6 deployment.
   if(isIP(ip)!==4||!ip.startsWith('127.'))return {status:403};
   if(!await reserve('ip',ip))return {status:429};
   if(req.method!=='POST'||req.headers.origin!==origin||req.headers['sec-fetch-site']!=='same-origin'||req.headers['content-type']!=='application/json'||req.headers['content-encoding']!==undefined)return {status:403};
   if(req.headers['content-length']!==undefined&&(!/^\d+$/.test(req.headers['content-length'])||Number(req.headers['content-length'])>4096))return {status:413};
   const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>4096)return {status:413};chunks.push(c);}
   let b;try{b=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{return {status:403};}
   if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).sort().join(',')!=='email,password')return {status:403};
   const email=normalizeEmail(b.email);
   if(!email||typeof b.password!=='string'||b.password.length<1||Buffer.byteLength(b.password)>1024)return {status:403};
   if(!await reserve('account',email))return {status:429};
   return {status:200,credentials:{email,password:b.password}};
  }
 });
}
