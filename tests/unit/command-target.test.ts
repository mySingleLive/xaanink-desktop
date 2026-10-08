import assert from "node:assert/strict"
import {test} from "node:test"
import {CommandTargets} from "../../src/lib/desktop/command-targets"
test("commands operate on the menu's retained target, never the next visible editor",async()=>{
 const bus=new CommandTargets<string>();const calls:string[]=[]
 bus.register({owner:"a",accepts:target=>target==="a",commands:{copy:()=>{calls.push("a")}}})
 bus.register({owner:"b",accepts:target=>target==="b",commands:{copy:()=>{calls.push("b")}}})
 assert.equal(await bus.execute("copy","a"),true);assert.deepEqual(calls,["a"])
 assert.equal(await bus.execute("copy","missing"),false);assert.deepEqual(calls,["a"])
})
test("a closed or unavailable target cannot receive a queued menu action; other input remains untouched",async()=>{
 const bus=new CommandTargets<string>();let editable=true;let changes=0
 const dispose=bus.register({owner:"a",accepts:target=>target==="a",commands:{paste:{enabled:()=>editable,run:()=>{changes++}}}})
 editable=false;assert.equal(bus.enabled("paste","a"),false);assert.equal(await bus.execute("paste","a"),false)
 editable=true;dispose();assert.equal(await bus.execute("paste","a"),false);assert.equal(changes,0)
})
test("duplicate handlers are refused instead of applying the edit twice or picking arbitrary registration order",async()=>{
 const bus=new CommandTargets<string>();let calls=0
 for(const owner of ["a","b"])bus.register({owner,accepts:()=>true,commands:{save:()=>{calls++}}})
 assert.equal(await bus.execute("save","a"),false);assert.equal(calls,0)
})
test("captured command ownership is checked again before async execution begins",async()=>{
 const bus=new CommandTargets<string>();let alive=true,calls=0
 bus.register({owner:"a",accepts:()=>alive,commands:{cut:()=>{calls++}}})
 const command=bus.capture("cut","a");assert.ok(command);alive=false
 assert.equal(await command(),false);assert.equal(calls,0)
})
