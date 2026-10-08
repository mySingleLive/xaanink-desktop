import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import {createRequire} from 'node:module'
import {join,resolve} from 'node:path'
import {desktopMenu} from '../../desktop/shared/command-registry'
import ts from 'typescript'

const project=resolve(import.meta.dirname,'../..'),require=createRequire(import.meta.url)
const read=(name:string)=>readFileSync(join(project,name),'utf8')
function nodes(name:string,predicate:(node:ts.Node)=>boolean){
 const source=ts.createSourceFile(name,read(name),ts.ScriptTarget.Latest,true,name.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS),found:ts.Node[]=[]
 const visit=(node:ts.Node)=>{if(predicate(node))found.push(node);ts.forEachChild(node,visit)};visit(source);return found
}
const string=(node:ts.Node|undefined)=>node&&ts.isStringLiteral(node)?node.text:undefined

test('BRAND-P01: package and native executable identities use the approved Chinese and English names',()=>{
 const metadata=JSON.parse(read('package.json')),lock=JSON.parse(read('package-lock.json')),config=require('../../electron-builder.config.cjs')
 assert.equal(metadata.name,'xaanink');assert.equal(lock.name,'xaanink');assert.equal(lock.packages[''].name,'xaanink')
 assert.equal(config.productName,'玄印写作');assert.equal(config.appId,'ink.xaanink.desktop')
 assert.equal(config.artifactName,'XaanInk-${version}-${os}-${arch}.${ext}')
 for(const platform of ['darwin','win32'] as const){
  const groups=desktopMenu(platform,{}),commands=groups.flatMap(group=>group.items)
  if(platform==='darwin')assert.equal(groups[0].label,'玄印')
  assert.equal(commands.find(command=>command.id==='app.about')?.label,'关于玄印写作')
  assert.equal(commands.find(command=>command.id==='app.quit')?.label,'退出玄印')
 }
})

test('BRAND-P02: actual UI, custom protocol and exported manuscript metadata carry the new brand',()=>{
 const metadata=nodes('src/app/layout.tsx',node=>ts.isVariableDeclaration(node)&&node.name.getText()==='metadata')[0] as ts.VariableDeclaration
 assert.ok(metadata&&metadata.initializer&&ts.isObjectLiteralExpression(metadata.initializer))
 const title=metadata.initializer.properties.find(node=>ts.isPropertyAssignment(node)&&node.name.getText()==='title') as ts.PropertyAssignment|undefined
 assert.equal(string(title?.initializer),'玄印写作')
 assert.ok(nodes('src/app/page.tsx',node=>ts.isJsxText(node)&&node.text.includes('正在打开玄印写作')).length)
 const label=nodes('src/components/marketing/seal.tsx',node=>ts.isJsxAttribute(node)&&node.name.getText()==='aria-label')[0] as ts.JsxAttribute
 assert.equal(string(label?.initializer),'玄印写作')
 const creator=nodes('src/lib/manuscript-export-docx.ts',node=>ts.isPropertyAssignment(node)&&node.name.getText()==='creator')[0] as ts.PropertyAssignment
 assert.ok(creator&&ts.isBinaryExpression(creator.initializer));assert.equal(string(creator.initializer.right),'玄印写作')
 const pdf=nodes('src/lib/manuscript-export-pdf.ts',node=>ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='setCreator')[0] as ts.CallExpression
 assert.equal(string(pdf?.arguments[0]),'玄印写作')
 const scheme=nodes('desktop/main/index.ts',node=>ts.isPropertyAssignment(node)&&node.name.getText()==='scheme')[0] as ts.PropertyAssignment
 assert.equal(string(scheme?.initializer),'xaanink')
 const handles=nodes('desktop/main/index.ts',node=>ts.isCallExpression(node)&&node.expression.getText()==='protocol.handle') as ts.CallExpression[]
 assert.ok(handles.some(node=>string(node.arguments[0])==='xaanink'))
 for(const name of ['desktop/preload/index.ts','src/lib/desktop/transport.ts'])assert.ok(nodes(name,node=>ts.isStringLiteral(node)&&node.text==='xaanink-response-port').length,`${name}: both port endpoints use the new identity`)
 assert.ok(nodes('desktop/main/index.ts',node=>ts.isStringLiteral(node)&&node.text==='xaanink://app/').length)
})

test('BRAND-P03: every shipped brand vector is named correctly and wordmarks are real paths',()=>{
 const previous=['玄','香','印'].join('')
 for(const directory of ['public/brand','design/assets'])for(const name of readdirSync(join(project,directory)).filter(name=>name.endsWith('.svg')&&/logo|seal|favicon/.test(name))){
  const svg=read(join(directory,name));assert.ok(svg.includes('玄印写作'),`${directory}/${name}`);assert.equal(svg.includes(previous),false,`${directory}/${name}`)
  if(/horizontal|formal/.test(name)){assert.ok(svg.includes('data-wordmark="玄印写作"'),`${name} must regenerate outlined lettering`);assert.ok(svg.includes('<path'),name);assert.equal(/<text\b/.test(svg),false,name)}
 }
})
