// Disposable lab build; transpilation, not full TypeScript typecheck.
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');const ts=require('typescript');
const root=__dirname, out=path.join(root,'r4-compiled');
const hash=x=>createHash('sha256').update(x).digest('hex');
assert.equal(hash(fs.readFileSync(path.join(root,'sec01-sovereign-http-gate.ts'))),'c894ba2ed6dc5857b12bab8c545a242a6bae029c544ef0d22d904d6e96f4b2b8');
assert.equal(hash(fs.readFileSync(path.join(root,'sec01-sovereign-sql-adapter-r3-original.ts'))),'652513d0d72b4e432bd79a77dddf2bf4b6a16b80b8de24fd40b48964ff3e592f');
const original=fs.readFileSync(path.join(root,'sec01-sovereign-sql-adapter-r3-original.ts'),'utf8');
assert.equal(fs.readFileSync(path.join(root,'sec01-sovereign-sql-adapter.ts'),'utf8'),original.replace('sec01_admin.issue_privileged_session','sec01_admin.issue_bound_session').replace('sec01_admin.write_pricing','sec01_admin.write_bound_pricing'));
assert.equal(fs.readFileSync(path.join(root,'sec01-sovereign-tls-gate.ts'),'utf8'),fs.readFileSync(path.join(root,'sec01-sovereign-http-gate.ts'),'utf8').replace('url.protocol !== \"http:\"','url.protocol !== \"https:\"'));
const outputs=[];
for(const name of ['sec01-sovereign-tls-gate','sec01-sovereign-sql-adapter']){
 const src=fs.readFileSync(path.join(root,name+'.ts'),'utf8');const r=ts.transpileModule(src,{fileName:name+'.ts',reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true}});
 assert.equal((r.diagnostics??[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,'TRANSPILE_ERROR');outputs.push([name+'.js',r.outputText]);
}
fs.mkdirSync(out);fs.writeFileSync(path.join(out,'package.json'),'{"type":"commonjs"}\n',{flag:'wx'});for(const [name,code] of outputs)fs.writeFileSync(path.join(out,name),code,{flag:'wx'});
console.log(JSON.stringify({name:'R3_TRANSPILE',status:'PASS',typescript:ts.version,gateSource:'https protocol only',adapter:'bound functions only',typecheck:false}));
