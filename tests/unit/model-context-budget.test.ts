import assert from "node:assert/strict"
import { test } from "node:test"
import { localModelRecord, snapshotForRecord } from "../../desktop/service/models"
import type { PublicModel } from "../../desktop/core/settings"
const model: PublicModel = { id:crypto.randomUUID(),provider:"custom",modelId:"fixture",protocol:"openai",endpoint:"https://fixture.invalid/v1",name:"fixture",kind:"TEXT",contextWindow:0,enabled:true,authRevision:1,keyMask:"••••••••",thinkingLevels:[],defaultThinking:"default" }
test("unknown model capacity uses an internal conservative budget while preserving unknown public metadata", () => {
  const record=localModelRecord(model)
  assert.equal(record.contextWindow,16_000)
  assert.equal(snapshotForRecord(record).contextWindow,0)
  assert.equal(model.contextWindow,0)
  assert.equal(localModelRecord({...model,contextWindow:128000}).contextWindow,128000)
})
