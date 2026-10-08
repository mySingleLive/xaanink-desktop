import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import { transformSync } from "esbuild"

// Exercise the imported Web picker with its actual selection/effect callbacks;
// the query and store are controlled, without recreating menu behavior.
function picker(modelId: string | null, models: unknown[] = []) {
  const choices: unknown[] = [], remembered:unknown[] = [], effects:Array<() => unknown> = []
  const state = {conversationId:null,modelChoice:{modelId,effort:null},modelEffortMemory:{},setModelChoice:(value:unknown)=>choices.push(value),rememberModelChoice:(value:unknown)=>remembered.push(value),rememberModelEffort:()=>{}}
  const output = {exports:{} as {ModelPicker():unknown}}
  const code = transformSync(readFileSync(new URL("../../src/components/chat/ModelPicker.tsx",import.meta.url),"utf8"),{loader:"tsx",format:"cjs",jsx:"automatic"}).code
  const elements = new Proxy({}, {get:(_target,name) => String(name)})
  new Function("module","exports","require",code)(output,output.exports,(name:string) => {
    if(name === "react")return {useState:(value:unknown)=>[value,()=>{}],useRef:(value:unknown)=>({current:value}),useEffect:(action:()=>unknown)=>effects.push(action)}
    if(name === "react/jsx-runtime")return {jsx:(type:unknown,props:unknown)=>({type,props}),jsxs:(type:unknown,props:unknown)=>({type,props})}
    if(name === "@tanstack/react-query")return {useQuery:()=>({data:{defaultModelId:null,models}})}
    if(name === "@/stores/chat")return {useChatStore:Object.assign((select:(value:unknown)=>unknown)=>select(state),{getState:()=>state})}
    if(name === "@/lib/ai/auto-model")return {AUTO_MODEL_ID:"auto"}
    if(name === "@/lib/utils")return {cn:()=>""}
    if(name === "@/components/chat/ui-events")return {CHAT_OPEN_MODEL_PICKER_EVENT:"open-model-picker"}
    if(name === "sonner")return {toast:{error(){}}}
    return elements
  })
  const tree = output.exports.ModelPicker()
  const previous = Object.getOwnPropertyDescriptor(globalThis,"window")
  try { Object.defineProperty(globalThis,"window",{value:new EventTarget(),configurable:true}); for(const run of effects)run() }
  finally { if(previous)Object.defineProperty(globalThis,"window",previous);else Reflect.deleteProperty(globalThis,"window") }
  function nodes(value:unknown):Array<{type:unknown;props:Record<string,unknown>}> {
    if(Array.isArray(value))return value.flatMap(nodes)
    if(value && typeof value === "object" && "props" in value) { const node=value as {type:unknown;props:Record<string,unknown>};return [node,...nodes(node.props.children)] }
    return []
  }
  return {choices,remembered,nodes:nodes(tree)}
}
test("desktop chat picker: a removed remembered model stays an invalid explicit choice and never falls back", () => {
  const result=picker("removed-model")
  assert.deepEqual(result.choices,[])
  assert.deepEqual(result.remembered,[])
  assert.ok(result.nodes.some(node => node.type==="span" && node.props.children==="模型已失效"))
})
test("desktop chat picker: choosing a model without effort memory uses its default rather than inventing high effort", async () => {
  const result=picker(null,[{id:"saved-model",name:"本地模型",provider:"openai",modelId:"owned",contextWindow:0,thinkingEfforts:[{value:"high",label:"高"}],free:false}])
  const model=result.nodes.find(node=>node.type==="DropdownMenuSubTrigger")
  assert.ok(model);(model.props.onClick as ()=>void)()
  await Promise.resolve()
  assert.deepEqual(result.choices,[{modelId:"saved-model",effort:null}])
})
