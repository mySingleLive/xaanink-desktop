import test from "node:test"
import assert from "node:assert/strict"
import {desktopCommandCatalog,publishDesktopCommands} from "../../src/lib/desktop/command-runtime"
import {canonicalKey} from "../../desktop/core/shortcuts"
test("runtime metadata and secondary defaults augment shared commands without replacing their identity",()=>{
 const before=desktopCommandCatalog("darwin").find(row=>row.id==="text.redo")!
 const extra={...before,label:"Runtime redo",group:"Monaco",defaults:["Cmd+Shift+Z","Cmd+Y"],monacoId:"redo",monacoBindings:[{binding:"Cmd+Y",when:"editorTextFocus"}]}
 const remove=publishDesktopCommands({},[extra])
 try{
  const after=desktopCommandCatalog("darwin").find(row=>row.id===before.id)! as typeof extra
  assert.equal(after.label,before.label);assert.equal(after.group,before.group)
  assert.equal(after.monacoId,"redo");assert.deepEqual(after.monacoBindings,extra.monacoBindings)
  assert(after.defaults.some(key=>canonicalKey(key)===canonicalKey("Cmd+Y")))
  assert.equal(after.defaults.filter(key=>canonicalKey(key)===canonicalKey("Cmd+Shift+Z")).length,1)
 }finally{remove()}
 assert.deepEqual(desktopCommandCatalog("darwin").find(row=>row.id===before.id),before)
})
