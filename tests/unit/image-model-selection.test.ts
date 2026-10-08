import assert from "node:assert/strict"
import { test } from "node:test"
import { imageModelSelection } from "../../src/lib/desktop/image-model-selection"
const models=[{id:"one",name:"图像一",modelId:"image-1",provider:"openai"},{id:"two",name:"图像二",modelId:"image-2",provider:"google"}]
test("image task preview uses only the configured default, with its own provider logo", () => {
  const choice=imageModelSelection(models,"two","auto")
  assert.equal(choice.selected?.id,"two");assert.equal(choice.selected?.provider,"google")
  assert.equal(choice.label,"默认：图像二")
})
test("image default absent or unavailable never falls back to the first or latest model", () => {
  assert.equal(imageModelSelection(models,null,"auto").selected,undefined)
  assert.equal(imageModelSelection(models,null,"auto").label,"尚未设置默认模型")
  assert.equal(imageModelSelection(models,"removed","auto").label,"默认模型不可用")
})
test("an explicit unavailable image model stays unavailable after changing the default", () => {
  const choice=imageModelSelection(models,"two","removed")
  assert.equal(choice.selected,undefined);assert.equal(choice.label,"所选模型不可用")
  assert.equal(imageModelSelection(models,"two","one").selected?.id,"one")
})
