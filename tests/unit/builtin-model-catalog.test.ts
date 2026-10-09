import test from "node:test"
import assert from "node:assert/strict"
import { builtinModels, modelChoices, excludedBuiltinModel } from "../../desktop/shared/builtin-model-catalog"
import { presetsFor, type CatalogResult, type CatalogEntry } from "../../desktop/shared/model-catalog"
const live=(provider:CatalogResult["provider"],kind:CatalogResult["kind"],models:CatalogEntry[]):CatalogResult=>({ok:true,provider,kind,models,complete:true,unknownCapabilityIds:[],permission:"listed-unverified",sources:[],checkedAt:"2026-10-09T00:00:00Z",warnings:[]})
for(const kind of ["TEXT","IMAGE"] as const)test(`D01/D02: every ${kind} preset has sourced candidates and custom remains empty`,()=>{
  for(const preset of presetsFor(kind)){
    const rows=builtinModels(preset.id,kind)
    if(preset.id==="custom"){assert.deepEqual(rows,[]);continue}
    assert.ok(rows.length>0,preset.id);assert.equal(new Set(rows.map(row=>row.id)).size,rows.length)
    for(const row of rows){assert.equal(row.kind,kind);assert.equal(row.permission,"unknown");assert.match(row.source,/^https:\/\//);assert.ok(row.name)}
  }
})
test("D02/D07: offline catalogs exclude incompatible, retired and edit-only models",()=>{
  const texts=builtinModels("openai","TEXT").map(row=>row.id),images=builtinModels("alibaba","IMAGE").map(row=>row.id)
  assert.ok(texts.includes("gpt-5.5"));assert.ok(!texts.includes("text-embedding-3-large"));assert.ok(!texts.includes("chatgpt-4o-latest"));assert.ok(!texts.includes("gpt-oss-120b"))
  assert.ok(images.includes("qwen-image-3.0-pro"));for(const id of ["qwen-image-edit","wan2.5-i2i-preview","wanx2.1-imageedit"])assert.ok(!images.includes(id))
  assert.deepEqual(builtinModels("deepseek","TEXT").map(row=>row.id),["deepseek-flash","deepseek-v4-pro"])
  assert.equal(builtinModels("bytedance","TEXT").length,20);assert.equal(builtinModels("bytedance","IMAGE").length,6)
})
test("D05/D07: live metadata and denial win by exact ID without granting missing candidates",()=>{
  const publicRow=builtinModels("deepseek","TEXT")[0],newRow={...publicRow,id:"new-live",name:"Live",permission:"listed-unverified" as const}
  const rows=modelChoices("deepseek","TEXT",live("deepseek","TEXT",[{...publicRow,contextWindow:99999,available:false,permission:"listed-unverified"},newRow]))
  assert.equal(rows.filter(row=>row.id===publicRow.id).length,1);assert.equal(rows[0].available,false);assert.equal(rows[0].contextWindow,99999)
  assert.equal(rows.find(row=>row.id==="deepseek-v4-pro")?.permission,"unknown");assert.ok(rows.some(row=>row.id==="new-live"))
  assert.ok(!modelChoices("deepseek","TEXT",live("openai","TEXT",[newRow])).some(row=>row.id==="new-live"))
})
test("D07: subscription access requires current live confirmation and cannot survive a changed Key catalog reset",()=>{
  const restricted=builtinModels("minimax","TEXT").find(row=>row.id==="MiniMax-M3.1-Flash-Preview")!
  assert.equal(restricted.available,false)
  assert.equal(modelChoices("minimax","TEXT",live("minimax","TEXT",[{...restricted,available:undefined}])).find(row=>row.id===restricted.id)?.available,false)
  assert.equal(modelChoices("minimax","TEXT",live("minimax","TEXT",[{...restricted,available:true}])).find(row=>row.id===restricted.id)?.available,true)
  assert.equal(modelChoices("minimax","TEXT",null).find(row=>row.id===restricted.id)?.available,false)
})
test("D07: live additions cannot reinstate retired, OTHER, edit-only or wrong-kind IDs",()=>{
  for(const [provider,kind,ids] of [["openai","TEXT",["chatgpt-4o-latest","text-embedding-3-large","gpt-oss-20b"]],["alibaba","IMAGE",["qwen-image-edit","wan2.5-i2i-preview"]],["anthropic","TEXT",["claude-opus-4-1-20250805","claude-opus-4-20250514","claude-3-5-sonnet-20241022"]]] as const){
    const rows=modelChoices(provider,kind,live(provider,kind,ids.map(id=>({id,name:id,kind,source:"https://fixture.invalid",permission:"listed-unverified",available:true}))))
    for(const id of ids)assert.ok(!rows.some(row=>row.id===id))
  }
})

test("D01/D07: Alibaba table tails and Anthropic active IDs remain exact public candidates",()=>{
  const ali=new Set(builtinModels("alibaba","TEXT").map(row=>row.id))
  for(const id of ["qwen-plus-character-ja","qwen-flash-character","qwen2.5-omni-7b","qwen-plus","qwen-max","qwen-flash","qwen-turbo","qwq-plus","qvq-max","qwen-omni-turbo","glm-5.1","glm-5","glm-4.7","glm-4.5","glm-4.5-air","MiniMax-M2.7","MiniMax-M2.5","MiniMax-M2.1","kimi-k2.5","kimi-k2-thinking","Moonshot-Kimi-K2-Instruct","deepseek-v3.2","deepseek-v3.2-exp","deepseek-v3.1","deepseek-v3","deepseek-r1","deepseek-r1-0528","deepseek-r1-distill-llama-70b","deepseek-r1-distill-qwen-32b","deepseek-r1-distill-qwen-14b","deepseek-r1-distill-qwen-7b","deepseek-r1-distill-qwen-1.5b","deepseek-r1-distill-llama-8b"])assert.ok(ali.has(id),id)
  const claude=builtinModels("anthropic","TEXT")
  for(const id of ["claude-fable-5","claude-opus-5","claude-opus-4-8","claude-opus-4-7","claude-opus-4-6","claude-opus-4-5-20251101","claude-sonnet-5","claude-sonnet-4-6","claude-haiku-4-5-20251001"]){const entry=claude.find(row=>row.id===id);assert.ok(entry,id);assert.equal(entry.contextWindow,undefined);assert.equal(entry.maxOutputTokens,undefined)}
  assert.equal(excludedBuiltinModel("anthropic","TEXT","claude-sonnet-4-5-20250929",Date.parse("2026-11-29")),false)
  assert.equal(excludedBuiltinModel("anthropic","TEXT","claude-sonnet-4-5-20250929",Date.parse("2026-11-30")),true)
  const restricted=claude.find(row=>row.id==="claude-mythos-5-1")!
  assert.equal(restricted.available,false)
  assert.equal(modelChoices("anthropic","TEXT",live("anthropic","TEXT",[{...restricted,available:undefined}])).find(row=>row.id===restricted.id)?.available,false)
  assert.equal(modelChoices("anthropic","TEXT",live("anthropic","TEXT",[{...restricted,available:true}])).find(row=>row.id===restricted.id)?.available,true)
  assert.equal(modelChoices("anthropic","TEXT",null).find(row=>row.id===restricted.id)?.available,false)
})
