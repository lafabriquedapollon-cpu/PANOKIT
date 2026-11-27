import {createHmac} from 'node:crypto';
import assert from 'node:assert/strict';
export function decodeBase32(input){
 const a='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; const s=input.toUpperCase().replace(/=+$/,'');
 if(!s||!/^[A-Z2-7]+$/.test(s))throw Error('INVALID_BASE32');
 let acc=0,bits=0;const out=[];
 for(const c of s){acc=(acc<<5)|a.indexOf(c);bits+=5;if(bits>=8){bits-=8;out.push((acc>>bits)&255);acc&=(1<<bits)-1;}}
 if(acc!==0)throw Error('INVALID_BASE32_PADDING');return Buffer.from(out);
}
export function totp(secret,ms=Date.now(),digits=6,period=30,algorithm='sha1'){
 const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(Math.floor(ms/1000/period)));
 const h=createHmac(algorithm,secret).update(b).digest();const o=h[h.length-1]&15;
 return String((h.readUInt32BE(o)&0x7fffffff)%10**digits).padStart(digits,'0');
}
export function parseUri(uri){const u=new URL(uri);assert.equal(u.protocol,'otpauth:');assert.equal(u.hostname,'totp');assert.equal(Number(u.searchParams.get('digits')??6),6);assert.equal(Number(u.searchParams.get('period')??30),30);assert.equal((u.searchParams.get('algorithm')??'SHA1').toUpperCase(),'SHA1');return decodeBase32(u.searchParams.get('secret')??'');}
// Deliberately narrow test jar; only for the single fixed lab origin and path.
export class Jar{
 constructor(entries=[]){this.cookies=new Map(entries);}
 clone(){return new Jar(this.cookies);}
 header(){return [...this.cookies].map(([k,v])=>`${k}=${v}`).join('; ');}
 hasSuffix(s){return [...this.cookies.keys()].some(k=>k.endsWith(s));}
 update(headers){for(const line of headers.getSetCookie()){
  const [pair,...attrs]=line.split(';');const i=pair.indexOf('=');if(i<1)throw Error('INVALID_SET_COOKIE');const key=pair.slice(0,i).trim(),val=pair.slice(i+1);const max=attrs.find(x=>/^\s*max-age=/i.test(x));const expires=attrs.find(x=>/^\s*expires=/i.test(x));
  if(!val||(max&&Number(max.split('=')[1])<=0)||(expires&&Date.parse(expires.slice(expires.indexOf('=')+1))<=Date.now()))this.cookies.delete(key);else this.cookies.set(key,val);
 }}
}
