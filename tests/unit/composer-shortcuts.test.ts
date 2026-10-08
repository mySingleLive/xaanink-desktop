import test from "node:test"
import assert from "node:assert/strict"
import {platformCommands} from "../../desktop/shared/command-registry"
import {bindingConflicts} from "../../desktop/core/shortcuts"
import {composerBindingHint,composerSendPreset,setComposerSendPreset} from "../../src/lib/desktop/composer-shortcuts"
test("composer presets use committed bindings and preserve unrelated additional bindings",()=>{
 const commands=platformCommands("darwin")
 const before={"ai.send":["Enter","Cmd+Enter"],"ai.newline":["Shift+Enter"]}
 const next=setComposerSendPreset(commands,before,false)
 assert.deepEqual(next,{"ai.send":["Shift+Enter","Cmd+Enter"],"ai.newline":["Enter"]})
 assert.equal(composerSendPreset(commands,next),"shift");assert.match(composerBindingHint(commands,next),/Shift\+Enter、Cmd\+Enter 发送/)
 assert.deepEqual(before["ai.send"],["Enter","Cmd+Enter"])
 assert.equal(composerSendPreset(commands,{"ai.send":["Cmd+Enter"]}),"custom")
 assert.match(composerBindingHint(commands,{"ai.send":[]}),/点击发送按钮/)
})
test("preset swaps respect other command bindings and do not silently transfer them",()=>{
 const commands=platformCommands("darwin"),overrides={"ai.clear":["Shift+Enter"]}
 assert.throws(()=>setComposerSendPreset(commands,overrides,false),/清空输入草稿/)
 assert.deepEqual(overrides,{"ai.clear":["Shift+Enter"]})
})
test("mention selection and send/stop are distinct contexts, while same-context binding conflicts remain visible",()=>{
 const commands=platformCommands("darwin")
 assert.deepEqual(commands.find(command=>command.id==="ai.mentionConfirm")!.defaults,["Tab","Enter"])
 assert.deepEqual(commands.find(command=>command.id==="ai.mentionClose")!.defaults,["Escape"])
 assert.equal(bindingConflicts(commands,{},"ai.send","Enter",0).length,0)
 assert(bindingConflicts(commands,{},"ai.clear","Enter").some(row=>row.command.id==="ai.send"))
})
