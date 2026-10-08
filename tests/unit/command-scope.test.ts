import assert from 'node:assert/strict'
import {test} from 'node:test'
import {commandScope} from '../../src/lib/desktop/command-scope'
const target=(surface:string,insideMonaco=true)=>({closest(selector:string){if(selector==='.monaco-editor')return insideMonaco?{}:null;if(selector==='input,textarea,[contenteditable="true"]')return this;return null},matches(selector:string){return selector.split(',').includes('.'+surface)}} as HTMLElement)
test('installed Monaco 0.56 edit and IME fallback surfaces all retain manuscript command scope',()=>{
 for(const surface of ['inputarea','native-edit-context','ime-text-area'])assert.equal(commandScope(target(surface)),'markdown',surface)
})
test('nested find and comment controls still receive ordinary input commands',()=>{
 for(const surface of ['find-input','comment-composer'])assert.equal(commandScope(target(surface)),'input')
 assert.equal(commandScope(target('outside-input',false)),'input')
})
