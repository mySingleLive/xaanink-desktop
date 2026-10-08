// These established Web assertions are ported from scripts/tests/autosave.test.ts
// and run against the Desktop project's actual shared controller.
import assert from "node:assert/strict"
import { test } from "node:test"
import { AutosaveController } from "../../src/lib/autosave-controller"
function gate(){let resolve!:()=>void;const promise=new Promise<void>(yes=>{resolve=yes});return{promise,resolve}}
test("Web autosave: read-only blur and repeated blur after a real edit do not create duplicate writes",async()=>{
 const values:unknown[]=[],controller=new AutosaveController<unknown>(async value=>{values.push(value)},60000)
 try{await controller.flush();assert.equal(controller.revision,0);assert.equal(values.length,0);controller.schedule({text:"作者实际修改"});await controller.flush();await controller.flush();assert.equal(values.length,1)}finally{controller.dispose()}
})
test("Web autosave: current request and later input save serially",async()=>{
 const first=gate(),values:string[]=[];let active=0;const controller=new AutosaveController<string>(async value=>{active++;assert.equal(active,1);values.push(value);if(value==="甲")await first.promise;active--},60000)
 try{controller.schedule("甲");const pending=controller.flush();controller.schedule("乙");first.resolve();await pending;assert.deepEqual(values,["甲","乙"]);assert.equal(controller.dirty,false)}finally{first.resolve();controller.dispose()}
})
test("Web autosave: failed request keeps its operation ID and later input is not replayed automatically",async()=>{
 const values:Array<{value:string;id:string}>=[];let fail=true;const controller=new AutosaveController<string>(async(value,attempt)=>{values.push({value,id:attempt.operationId});if(fail)throw Error("未知结果")},60000)
 try{controller.schedule("甲");await assert.rejects(controller.flush());controller.schedule("乙");await assert.rejects(controller.flush());assert.equal(values.length,1);fail=false;await controller.retry();assert.deepEqual(values.map(item=>item.value),["甲","甲","乙"]);assert.equal(values[0].id,values[1].id);assert.notEqual(values[1].id,values[2].id)}finally{controller.dispose()}
})
test("Web autosave: paused recovery does not write the subsequent input",async()=>{
 let writes=0;const controller=new AutosaveController<string>(async()=>{writes++},60000)
 try{controller.pause();controller.schedule("恢复期间的新草稿");await assert.rejects(controller.flush());assert.equal(writes,0);assert.equal(controller.dirty,true)}finally{controller.dispose()}
})
