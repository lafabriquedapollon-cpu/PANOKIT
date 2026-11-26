// Disposable loopback-only TLS. Explicit trust for this one generated certificate.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {connect} from 'node:tls';
import {request as httpRequest} from 'node:http';
import {X509Certificate} from 'node:crypto';
export function createLabCertificate(){
 assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED,'0','INSECURE_TLS_ENV');
 const dir=mkdtempSync(join(tmpdir(),'panokit-tls-'));
 const dispose=()=>rmSync(dir,{recursive:true,force:true});
 try{
  const cfg=join(dir,'openssl.cnf'),key=join(dir,'key.pem'),cert=join(dir,'cert.pem');
  // Config file avoids shell expansion or MSYS path conversion of /CN=.
  writeFileSync(cfg,'[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\nCN=PANOKIT disposable loopback\n[ext]\nsubjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n',{flag:'wx'});
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-sha256','-days','1','-config',cfg,'-keyout',key,'-out',cert],{stdio:'pipe',timeout:30000,windowsHide:true});
  const result={key:readFileSync(key),cert:readFileSync(cert),dispose};
  const x=new X509Certificate(result.cert);assert.equal(x.checkIP('127.0.0.1'),'127.0.0.1');assert.equal(x.checkHost('localhost'),undefined);assert.equal(x.ca,false);assert(x.checkPrivateKey(createKey(result.key)));
  return result;
 }catch(e){dispose();throw e;}
}
import {createPrivateKey as createKey} from 'node:crypto';
function endpoint(origin){const u=new URL(origin);assert.equal(u.protocol,'https:');assert.equal(u.hostname,'127.0.0.1');assert.equal(u.origin,origin);assert(u.port);return {host:u.hostname,port:Number(u.port)};}
export function tlsProbe(origin,{ca,servername}={}){
 const addr=endpoint(origin);return new Promise((resolve,reject)=>{
  const socket=connect({...addr,rejectUnauthorized:true,minVersion:'TLSv1.2',...(ca?{ca}:{}),...(servername?{servername}:{})});
  socket.setTimeout(8000,()=>socket.destroy(Error('TLS_TIMEOUT')));
  socket.once('error',reject);socket.once('secureConnect',()=>{const answer={authorized:socket.authorized,protocol:socket.getProtocol()};socket.end();resolve(answer);});
 });
}
export function plainProbe(origin){const {host,port}=endpoint(origin);return new Promise((resolve,reject)=>{
 const req=httpRequest({hostname:host,port,path:'/sec01-lab/issue',method:'GET',agent:false},res=>{res.resume();resolve(res.statusCode);});req.once('error',reject);req.setTimeout(8000,()=>req.destroy(Error('PLAIN_TIMEOUT')));req.end();
});}
export async function runTransportCases({origin,ca,test}){
 await test('TLS-01 trusted certificate and loopback IP verified',async()=>{const r=await tlsProbe(origin,{ca});assert.equal(r.authorized,true);assert.match(r.protocol,/^TLSv1\.[23]$/);});
 await test('TLS-02 unknown certificate rejected',async()=>{await assert.rejects(()=>tlsProbe(origin),e=>['DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(e?.code));});
 await test('TLS-03 wrong hostname rejected with otherwise trusted certificate',async()=>{await assert.rejects(()=>tlsProbe(origin,{ca,servername:'localhost'}),e=>e?.code==='ERR_TLS_CERT_ALTNAME_INVALID');});
 await test('TLS-04 plaintext HTTP rejected on HTTPS port',async()=>{await assert.rejects(()=>plainProbe(origin),e=>['ECONNRESET','EPIPE','HPE_INVALID_CONSTANT'].includes(e?.code));});
}
