import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:https';
import {createLabCertificate,runTransportCases,tlsProbe} from './tls-transport.mjs';
test('actual TLS server, certificate validation, hostname, and plaintext refusals',async()=>{
 const m=createLabCertificate();let s;
 try{
  s=createServer({key:m.key,cert:m.cert,minVersion:'TLSv1.2'},(_q,r)=>r.end('lab'));
  await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve);});
  let n=0;await runTransportCases({origin:`https://127.0.0.1:${s.address().port}`,ca:m.cert,test:async(_name,fn)=>{await fn();n++;}});assert.equal(n,4);
 }finally{if(s)await new Promise((resolve,reject)=>s.close(e=>e?reject(e):resolve()));m.dispose();}
});
test('non-loopback and HTTP origin rejected before connecting',()=>{assert.throws(()=>tlsProbe('https://example.invalid:443'));assert.throws(()=>tlsProbe('http://127.0.0.1:55445'));});
