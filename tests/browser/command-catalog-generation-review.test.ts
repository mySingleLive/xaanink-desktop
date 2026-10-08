import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {join,dirname} from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import {trustedCommandCatalogs} from '../../desktop/main/trusted-command-catalogs'

// Execute the actual generator, replacing only its final writeFile with an
// in-memory capture. It still builds/loads the installed real Monaco assembly
// and enumerates each platform in a separate real Chromium context.
test('CFG62-C01: actual installed two-context generation equals both shipped trusted/runtime command catalogs without writing production artifacts',async()=>{
 const directory=await mkdtemp(join(process.cwd(),'tests/generated/catalog-review62-'))
 try{
  const generator=await readFile('scripts/generate-command-catalogs.mjs','utf8')
  const result=await build({stdin:{contents:generator+'\nexport const captured=globalThis.__review62Captured;\n',resolveDir:join(process.cwd(),'scripts'),sourcefile:'generate-command-catalogs.mjs',loader:'js'},bundle:true,platform:'node',format:'esm',packages:'external',write:false,plugins:[{name:'capture-only-final-artifact',setup(builder){builder.onResolve({filter:/^node:fs\/promises$/},args=>args.namespace==='review'?{path:'node:fs/promises',external:true}:{path:'capture-fs',namespace:'review'});builder.onLoad({filter:/.*/,namespace:'review'},()=>({loader:'js',contents:`export {readFile} from 'node:fs/promises';export async function writeFile(path,bytes){if(path!=='desktop/shared/command-catalogs.generated.json')throw Error('unexpected generator write');globalThis.__review62Captured={path,text:String(bytes)}}`}))}}]})
  const modulePath=join(directory,'generator.mjs');await writeFile(modulePath,result.outputFiles![0].text)
  const execution=await import(pathToFileURL(modulePath).href)
  assert.equal(execution.captured.path,'desktop/shared/command-catalogs.generated.json')
  const assembled=JSON.parse(execution.captured.text),shipped=JSON.parse(await readFile('desktop/shared/command-catalogs.generated.json','utf8'))
  assert.deepEqual(trustedCommandCatalogs,assembled.platforms,'the actual main injection is the generated platform catalog');assert.deepEqual(assembled,shipped,'every runtime ID/default/when/weight/alias/arg metadata must match the shipped artifact')
  assert.equal(assembled.monacoVersion,'0.56.0');assert.equal(assembled.platforms.darwin.commands.length,416);assert.equal(assembled.platforms.win32.commands.length,400)
  for(const platform of ['darwin','win32']){const rows=assembled.platforms[platform].commands;assert.equal(new Set(rows.map((row:{id:string})=>row.id)).size,rows.length);assert.equal(rows.filter((row:{id:string})=>row.id==='md.bold').length,1);assert.ok(rows.some((row:{id:string,monacoId?:string})=>row.monacoId==='editor.foldAll'))}
 }finally{await rm(directory,{recursive:true,force:true})}
})

// The verifier itself runs against a real isolated directory with copies of
// every named source and the JSON artifact. chdir is confined to this sequential
// test process; neither source nor shipped JSON is changed.
test('CFG62-C02: actual build verifier accepts its complete pinned source snapshot and rejects a stale assembly file',async()=>{
 const {verifyCommandCatalogs}=await import('../../scripts/verify-command-catalogs.mjs')
 const {commandCatalogSources}=await import('../../scripts/command-catalog-sources.mjs')
 const original=process.cwd(),directory=await mkdtemp(join(original,'tests/generated/catalog-verify62-'))
 try{
  for(const file of [...commandCatalogSources,'desktop/shared/command-catalogs.generated.json']){const path=join(directory,file);await mkdir(dirname(path),{recursive:true});await writeFile(path,await readFile(file))}
  process.chdir(directory);const catalog=await verifyCommandCatalogs();assert.equal(catalog.platforms.darwin.commands.length,416)
  await writeFile(commandCatalogSources[0],await readFile(commandCatalogSources[0],'utf8')+'\n// isolated stale source\n')
  await assert.rejects(verifyCommandCatalogs(),/Stale installed command catalog/)
 }finally{process.chdir(original);await rm(directory,{recursive:true,force:true})}
})

test('CFG62-C03: verifier rejects a resolved-but-empty platform artifact even when all assembly source hashes still match',async()=>{
 const {verifyCommandCatalogs}=await import('../../scripts/verify-command-catalogs.mjs')
 const {commandCatalogSources}=await import('../../scripts/command-catalog-sources.mjs')
 const original=process.cwd(),directory=await mkdtemp(join(original,'tests/generated/catalog-empty62-'))
 try{
  for(const file of [...commandCatalogSources,'desktop/shared/command-catalogs.generated.json']){const path=join(directory,file);await mkdir(dirname(path),{recursive:true});await writeFile(path,await readFile(file))}
  process.chdir(directory);const artifact=await verifyCommandCatalogs();artifact.platforms.win32.commands=[];await writeFile('desktop/shared/command-catalogs.generated.json',JSON.stringify(artifact));await assert.rejects(verifyCommandCatalogs(),/catalog/i)
 }finally{process.chdir(original);await rm(directory,{recursive:true,force:true})}
})

test('CFG62-C04: verifier rejects an artifact declaring a different Monaco version from the pinned installed assembly',async()=>{
 const {verifyCommandCatalogs}=await import('../../scripts/verify-command-catalogs.mjs')
 const {commandCatalogSources}=await import('../../scripts/command-catalog-sources.mjs')
 const original=process.cwd(),directory=await mkdtemp(join(original,'tests/generated/catalog-version62-'))
 try{
  for(const file of [...commandCatalogSources,'desktop/shared/command-catalogs.generated.json']){const path=join(directory,file);await mkdir(dirname(path),{recursive:true});await writeFile(path,await readFile(file))}
  process.chdir(directory);const artifact=await verifyCommandCatalogs();artifact.monacoVersion='0.55.0';await writeFile('desktop/shared/command-catalogs.generated.json',JSON.stringify(artifact));await assert.rejects(verifyCommandCatalogs(),/catalog/i)
 }finally{process.chdir(original);await rm(directory,{recursive:true,force:true})}
})


test('CFG62-C05: actual build-desktop stops before writing any bundle when the real verifier reports a stale source',async()=>{
 const {commandCatalogSources}=await import('../../scripts/command-catalog-sources.mjs')
 const original=process.cwd(),directory=await mkdtemp(join(original,'tests/generated/build-catalog62-'))
 try{
  const source=await readFile('scripts/build-desktop.mjs','utf8');const compiled=await build({stdin:{contents:source,resolveDir:join(original,'scripts'),loader:'js'},bundle:true,write:false,platform:'node',format:'esm',packages:'external',plugins:[{name:'no-production-build-or-route-write',setup(builder){builder.onResolve({filter:/^\.\/generate-routes\.mjs$/},()=>({path:'no-routes',namespace:'review-build'}));builder.onResolve({filter:/^esbuild$/},()=>({path:'capture-build',namespace:'review-build'}));builder.onLoad({filter:/.*/,namespace:'review-build'},args=>({loader:'js',contents:args.path==='no-routes'?'':`export async function build(options){globalThis.__review62BuildCalls.push(options)}`}))}}]});
  const entry=join(directory,'build.mjs');await writeFile(entry,compiled.outputFiles![0].text);for(const file of [...commandCatalogSources,'desktop/shared/command-catalogs.generated.json']){const path=join(directory,file);await mkdir(dirname(path),{recursive:true});await writeFile(path,await readFile(file))}
  process.chdir(directory);await writeFile(commandCatalogSources[0],'stale isolated assembly');(globalThis as any).__review62BuildCalls=[];await assert.rejects(import(pathToFileURL(entry).href),/Stale installed command catalog/);assert.deepEqual((globalThis as any).__review62BuildCalls,[])
 }finally{process.chdir(original);Reflect.deleteProperty(globalThis,'__review62BuildCalls');await rm(directory,{recursive:true,force:true})}
})

test('CFG62-C06: verifier rejects same-length command content corruption by digest and malformed/duplicate rows even with a recomputed digest',async()=>{
 const {verifyCommandCatalogs}=await import('../../scripts/verify-command-catalogs.mjs')
 const {commandCatalogSources}=await import('../../scripts/command-catalog-sources.mjs')
 const {createHash}=await import('node:crypto')
 const original=process.cwd(),directory=await mkdtemp(join(original,'tests/generated/catalog-integrity62-'))
 try{
  for(const file of [...commandCatalogSources,'desktop/shared/command-catalogs.generated.json']){const path=join(directory,file);await mkdir(dirname(path),{recursive:true});await writeFile(path,await readFile(file))}
  process.chdir(directory);const originalArtifact=await verifyCommandCatalogs()
  const corrupt=structuredClone(originalArtifact);corrupt.platforms.darwin.commands[0].defaults=['Cmd+Alt+F9'];await writeFile('desktop/shared/command-catalogs.generated.json',JSON.stringify(corrupt));await assert.rejects(verifyCommandCatalogs(),/Corrupt.*catalog/i)
  for(const mutate of [(rows:any[])=>{rows[1].id=rows[0].id},(rows:any[])=>{rows[0].contexts={fake:'truthy'}},(rows:any[])=>{rows[0].scope='none'}]){const next=structuredClone(originalArtifact);mutate(next.platforms.win32.commands);next.platforms.win32.sha256=createHash('sha256').update(JSON.stringify(next.platforms.win32.commands)).digest('hex');await writeFile('desktop/shared/command-catalogs.generated.json',JSON.stringify(next));await assert.rejects(verifyCommandCatalogs(),/catalog/i)}
 }finally{process.chdir(original);await rm(directory,{recursive:true,force:true})}
})
