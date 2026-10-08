import assert from "node:assert/strict"
import {test} from "node:test"
import {ComposerHistory} from "../../src/lib/desktop/composer-history"
test("input history recalls this conversation and restores its unfinished draft when moving forward",()=>{
 const history=new ComposerHistory()
 history.remember("a","第一条");history.remember("a","第二条")
 assert.equal(history.move("a",-1,"尚未发送"),"第二条")
 assert.equal(history.move("a",-1,"第二条"),"第一条")
 assert.equal(history.move("a",1,"第一条"),"第二条")
 assert.equal(history.move("a",1,"第二条"),"尚未发送")
 assert.equal(history.move("b",-1,"另一部作品"),"另一部作品")
})
test("editing a recalled entry preserves the edit as a draft and new sends reset traversal",()=>{
 const history=new ComposerHistory()
 history.remember("a","旧输入");history.move("a",-1,"未发")
 assert.equal(history.move("a",1,"已编辑的旧输入"),"已编辑的旧输入")
 history.remember("a","新输入")
 assert.equal(history.move("a",-1,"最新草稿"),"新输入")
 assert.equal(history.move("a",1,"新输入"),"最新草稿")
})
test("hydrating prior user messages seeds once; empty and consecutive duplicate inputs are ignored",()=>{
 const history=new ComposerHistory(2)
 history.seed("a",["一","二","三"]);history.seed("a",["过时服务器列表"])
 history.remember("a","");history.remember("a","三")
 assert.equal(history.move("a",-1,""),"三")
 assert.equal(history.move("a",-1,"三"),"二")
 assert.equal(history.move("a",-1,"二"),"二")
})
