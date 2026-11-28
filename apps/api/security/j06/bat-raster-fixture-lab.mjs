import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {deflateSync} from 'node:zlib';

const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32" viewBox="0 0 64 32"><rect width="32" height="32" fill="#ff0000"/><rect x="32" width="32" height="32" fill="#0000ff"/></svg>');
export const fixtureSource=()=>Buffer.from(svg);
export const fixtureDigest=createHash('sha256').update(svg).digest('hex');
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
function chunk(type,data){
 const p=Buffer.concat([Buffer.from(type),data]);let c=0xffffffff;
 for(const x of p){c^=x;for(let i=0;i<8;i++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;}
 const size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE((c^0xffffffff)>>>0);
 return Buffer.concat([size,p,crc]);
}
async function render(){
 const sharp=createRequire(new URL('../../../web/package.json',import.meta.url))('sharp');
 const {data,info}=await sharp(svg,{limitInputPixels:2048,failOn:'error'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 if(info.width!==64||info.height!==32||info.channels!==4||data.length!==8192)throw Error('FIXTURE_RASTER');
 const rows=Buffer.alloc(32*257);
 for(let y=0;y<32;y++)data.copy(rows,y*257+1,y*256,(y+1)*256);
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(64,0);ihdr.writeUInt32BE(32,4);ihdr[8]=8;ihdr[9]=6;
 return Buffer.concat([signature,chunk('IHDR',ihdr),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
// Only the immutable source above is supported. No arbitrary SVG enters the
// child process. Separate process with bounded time/output, not an OS sandbox.
export async function rasterizePinnedFixture(source){
 if(!Buffer.isBuffer(source)||!source.equals(svg))throw Error('FIXTURE_NOT_PINNED');
 const result=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--render-pinned-fixture'],{timeout:5000,maxBuffer:65536,env:{LANG:'C'},stdio:['ignore','pipe','pipe'],windowsHide:true});
 if(result.error||result.status!==0||result.signal||!Buffer.isBuffer(result.stdout)||!result.stdout.length)throw Error('RASTER_UNAVAILABLE');
 return result.stdout;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(process.argv.length!==3||process.argv[2]!=='--render-pinned-fixture')process.exitCode=1;
 else try{process.stdout.write(await render());}catch{process.exitCode=1;}
}
