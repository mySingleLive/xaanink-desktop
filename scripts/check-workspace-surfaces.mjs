// Store complete command output and bounded summaries for this UI change.
import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

const kind=process.argv[2], label=process.argv[3]??kind
if(!/^[a-z0-9-]+$/.test(label??''))throw Error('Explicit safe evidence label required')
const directory=resolve('docs/evidence/workspace-surfaces')
await mkdir(directory,{recursive:true})
async function files(directory){return (await readdir(directory,{withFileTypes:true})).flatMap(e=>e.isFile()&&e.name.endsWith('.test.ts')?[join(directory,e.name)]:[])}
const commands={
  core:[process.execPath,['--import','tsx','--test','--test-concurrency=2','--test-reporter=tap',...await files('tests/unit'),...await files('tests/integration')]],
  'core-bounded':[process.execPath,['--import','tsx','--test','--test-concurrency=4','--test-timeout=60000','--test-reporter=tap',...await files('tests/unit'),...await files('tests/integration')]],
  'core-history-timeout':[process.execPath,['--import','tsx','--test','--test-concurrency=4','--test-timeout=120000','--test-reporter=tap',...await files('tests/unit'),...await files('tests/integration')]],
  'core-hang-probe':[process.execPath,['--import','tsx','--test','--test-timeout=20000','--test-reporter=tap','tests/unit/inbox-lease-window-116-review.test.ts']],
  browser:[process.execPath,['--import','tsx','--test','--test-concurrency=1','--test-reporter=tap',...await files('tests/browser')]],
  red:[process.execPath,['--import','tsx','--test','--test-reporter=tap','tests/browser/workspace-surfaces.test.ts']],
  'scene-red':[process.execPath,['--import','tsx','--test','--test-reporter=tap','--test-name-pattern=SURF-05','tests/browser/workspace-surfaces.test.ts']],
  green:[process.execPath,['--import','tsx','--test','--test-reporter=tap','tests/browser/workspace-surfaces.test.ts','tests/browser/caption-alignment.test.ts']],
  'export-browser':[process.execPath,['--import','tsx','--test','--test-reporter=tap','tests/browser/file-export.test.ts']],
  typecheck:[process.execPath,['node_modules/typescript/bin/tsc','--noEmit']],
  foundation:[process.execPath,['node_modules/typescript/bin/tsc','--project','tsconfig.foundation.json','--noEmit']],
  build:[process.execPath,['node_modules/next/dist/bin/next','build']],
  desktop:[process.execPath,['scripts/build-desktop.mjs']],
  catalog:[process.execPath,['scripts/generate-command-catalogs.mjs']],
}
if(!commands[kind])throw Error('Unknown check '+kind)
const [command,args]=commands[kind],start=new Date().toISOString()
const env={...process.env,XAANINK_TEST_CHROMIUM:process.env.XAANINK_TEST_CHROMIUM??'C:/Program Files/Google/Chrome/Application/chrome.exe'}
// Child tools must use the same supported Node 24 runtime.
env.PATH=join(process.execPath,'..')+';'+env.PATH
const child=spawn(command,args,{cwd:process.cwd(),env,stdio:['ignore','pipe','pipe'],windowsHide:true})
let output='',spawnError
child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data)
child.on('error',error=>spawnError=String(error))
const timeout=setTimeout(()=>child.kill(),30*60_000)
const exitCode=await new Promise(r=>child.on('close',r));clearTimeout(timeout)
output=output.replaceAll(process.cwd(),'<repo>').replaceAll(homedir(),'<home>').replaceAll(tmpdir(),'<isolated-temp>')
if(spawnError)output+='\n'+spawnError
await writeFile(join(directory,label+'.log'),output)
const totals=Object.fromEntries([...output.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(m=>[m[1],Number(m[2])]))
const result={kind,label,scope:'Current repository checks; fixture boundaries follow individual suites. No multi-platform acceptance claim.',startedAt:start,completedAt:new Date().toISOString(),node:process.version,platform:process.platform,command,args,exitCode,status:exitCode===0?'passed':'failed',totals,failures:[...output.matchAll(/^not ok .*$/gm)].map(m=>m[0]),logHash:createHash('sha256').update(output).digest('hex')}
await writeFile(join(directory,label+'.json'),JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify({...result,args:undefined,failures:result.failures.slice(0,12)}));process.exitCode=exitCode??1
