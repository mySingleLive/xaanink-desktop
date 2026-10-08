import {_electron as electron} from 'playwright'
import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
const require=createRequire(import.meta.url),evidence='docs/evidence/implementation-33/native-diagnostic-02',logs=[]
let app,page
await mkdir(evidence,{recursive:true})
try{
 app=await electron.launch({executablePath:require('electron'),args:[resolve('.')],env:{...process.env,XAANINK_TEST_ROOT:process.argv[2]},timeout:30000})
 app.process().stderr.on('data',chunk=>logs.push(chunk.toString()))
 app.process().on('exit',(code,signal)=>logs.push(JSON.stringify({processExit:code,signal})))
 page=await app.firstWindow();page.on('pageerror',e=>logs.push('pageerror '+e.message));page.on('close',()=>logs.push('page closed'))
 await page.getByRole('heading',{name:'定位原数据目录',exact:true}).waitFor({timeout:20000})
 await page.screenshot({path:join(evidence,'screen.png')})
 logs.push('heading visible')
 await page.getByRole('button',{name:'退出应用',exact:true}).click()
}catch(error){logs.push(String(error))}
finally{if(app){const timer=setTimeout(()=>app?.process().kill('SIGKILL'),5000);try{await app.close().catch(()=>{})}finally{clearTimeout(timer)}}await writeFile(join(evidence,'diagnostic.json'),JSON.stringify({scope:'diagnostic only, preserved isolated fixture, temporary dist instrumentation, not acceptance',logs},null,2)+'\n');console.log(logs.join(''))}
