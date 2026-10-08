import assert from "node:assert/strict"
import {test} from "node:test"
import {settledWorkspaceLayout} from "../../src/lib/desktop/workspace-layout"
import type {WorkspaceLayout} from "../../src/lib/desktop/workspace-draft-source"
const layout:WorkspaceLayout={version:1,narrowPane:"chat",contentVisible:true,sidebarVisible:true,chatVisible:true,sizes:{sidebar:20,chat:40,content:40},lastSidebarSize:20,lastChatSize:40,lastContentSize:40}
test("closing sidebar animation is checkpointed as hidden without preserving its intermediate width",()=>{const value=settledWorkspaceLayout({...layout,sidebarVisible:false});assert.deepEqual(value.sizes,{sidebar:0,chat:60,content:40});assert.equal(value.lastSidebarSize,20);assert.deepEqual(layout.sizes,{sidebar:20,chat:40,content:40})})
test("closing content removes its panel size and restores chat visibility before a later mount",()=>{const value=settledWorkspaceLayout({...layout,contentVisible:false,chatVisible:false,narrowPane:"content"});assert.deepEqual(value.sizes,{sidebar:20,chat:80});assert.equal(value.chatVisible,true);assert.equal(value.narrowPane,"chat")})
test("content fullscreen assigns hidden sidebar and chat space to the retained content panel",()=>{assert.deepEqual(settledWorkspaceLayout({...layout,sidebarVisible:false,chatVisible:false}).sizes,{sidebar:0,chat:0,content:100})})
test("before Group has registered panels, an empty layout preserves its normal initial sizing",()=>{assert.deepEqual(settledWorkspaceLayout({...layout,sizes:{}}).sizes,{})})
