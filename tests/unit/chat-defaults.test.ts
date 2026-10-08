import assert from "node:assert/strict"
import { test } from "node:test"
import { defaultState } from "../../desktop/core/settings"
import { chatTaskOverrides, newChatChoices, restoreChatChoices, inheritedChatChoices } from "../../src/lib/desktop/chat-defaults"
import { ChatSessionRepository, emptyChatSession } from "../../src/lib/chat-session"

const agent = { ...defaultState.settings.agent, textModelId:"configured-text", thinking:"high", mode:"plan" as const }
test("a new draft previews all defaults but leaves their atomic capture to the task service", () => {
  const choices = newChatChoices(agent)
  assert.deepEqual(choices.modelChoice,{modelId:"configured-text",effort:"high"})
  assert.equal(choices.mode,"plan")
  assert.deepEqual(chatTaskOverrides({...choices,conversationId:null}),{})
})
test("explicit draft choices, including null and default effort, survive a later defaults change", () => {
  const state = {...newChatChoices(agent),conversationId:null,modelChoiceExplicit:true,modelChoice:{modelId:null,effort:null}}
  assert.deepEqual(chatTaskOverrides(state),{modelId:null,thinkingEffort:null})
  const refreshed = inheritedChatChoices(state,{...agent,textModelId:"other",thinking:"low",mode:"standard"})
  assert.deepEqual(refreshed.modelChoice,state.modelChoice)
  assert.equal(refreshed.mode,"standard")
})
test("existing conversation and retry never adopt current global defaults", () => {
  const state = {...newChatChoices(agent),conversationId:"saved",modelChoice:{modelId:null,effort:null},mode:"standard" as const}
  assert.deepEqual(chatTaskOverrides(state),{modelId:null,thinkingEffort:null,mode:"standard"})
  assert.deepEqual(inheritedChatChoices(state,{...agent,textModelId:"other"}),{})
  assert.deepEqual(chatTaskOverrides(state,true),{})
})
test("unsent draft restoration preserves explicitness while inherited previews follow the latest committed defaults", () => {
  const data=new Map<string,string>()
  const storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value)},removeItem:(key:string)=>{data.delete(key)}}
  const repo=new ChatSessionRepository("local-author",storage)
  const draft={...emptyChatSession(),...newChatChoices(agent),draft:"不要丢失这段正文"}
  repo.save(draft)
  const saved = new ChatSessionRepository("local-author",storage).read().entry!
  assert.equal(saved.modelChoiceExplicit,false)
  assert.equal(saved.modeExplicit,false)
  const restored=restoreChatChoices(saved,{...agent,textModelId:"next",thinking:"low",mode:"standard"})
  assert.equal(restored.modelChoice.modelId,"next"); assert.equal(restored.modelChoice.effort,"low"); assert.equal(restored.mode,"standard")
  assert.equal(saved.draft,"不要丢失这段正文")
  repo.save({...draft,modelChoiceExplicit:true,modeExplicit:true})
  const explicit=restoreChatChoices(new ChatSessionRepository("local-author",storage).read().entry!,{...agent,textModelId:"next",mode:"standard"})
  assert.deepEqual(explicit.modelChoice,draft.modelChoice);assert.equal(explicit.mode,"plan")
})
test("legacy draft explicit models are retained and a default setting cannot repair a null historical choice", () => {
  const draft=emptyChatSession()
  delete draft.modelChoiceExplicit; delete draft.modeExplicit
  assert.equal(restoreChatChoices({...draft,modelChoice:{modelId:"removed",effort:null}},agent).modelChoice.modelId,"removed")
  const historical=restoreChatChoices({...draft,conversationId:"old",modelChoice:{modelId:null,effort:null}},agent)
  assert.equal(historical.modelChoice.modelId,null)
  assert.equal(historical.mode,"standard")
})
