import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import ts from 'typescript'
import {transformSync} from 'esbuild'

function declaration(path:string,name:string){const source=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),node=source.statements.find(row=>ts.isFunctionDeclaration(row)&&row.name?.text===name);assert.ok(node);return node.getText(source).replace(/^export\s+(?:default\s+)?/,'')}
function evaluate(code:string,deps:Record<string,unknown>){return new Function(...Object.keys(deps),transformSync(`return (${code})`,{loader:'tsx',jsx:'transform',jsxFactory:'React.createElement',jsxFragment:'React.Fragment'}).code)(...Object.values(deps))}
function protectedApp(platform:'darwin'|'win32',failed:boolean,dark=false){
 let hook=0,business=0,writes=0;const calls:string[]=[],bootstrap=null
 const useDesktopStore=Object.assign((select:(value:{bootstrap:null})=>unknown)=>select({bootstrap}),{setState(){writes++}}),window={desktop:{command:async(id:string)=>{calls.push(id)}}}
 const WindowsMenuControl=evaluate(declaration('src/components/desktop/WindowControls.tsx','WindowsMenuControl'),{React,useDesktopStore,window,Menu:()=>React.createElement('svg')})
 const Button=({children,...props}:{children:React.ReactNode})=>React.createElement('button',props,children)
 const App=evaluate(declaration('src/components/desktop/DesktopApp.tsx','DesktopApp'),{React,useDesktopStore,window,useState(initial:unknown){const index=hook++;return[index===0?(failed?'actual protected error':null):index===1?{sessionId:'actual-session',platform,systemDark:dark}:initial,()=>{}]},useRef:(value:unknown)=>({current:value}),useTheme:()=>({setTheme(){}}),useQueryClient:()=>({}),useEffect(){},useDesktopCommands(){},WindowsMenuControl,Button,WorkLeasePendingDialog:()=>null,RecoveryDialog:()=>React.createElement('aside',{'data-protected-recovery':true}),DesktopCommandController(){business++;return null},DesktopNavigation(){business++;return null},DashboardShell(){business++;return null},toast:{error(){}}})
 return{App,WindowsMenuControl,calls,get business(){return business},get writes(){return writes},get bootstrap(){return bootstrap}}
}
for(const failed of[false,true])test(`PC36-01 actual protected Windows ${failed?'error':'loading'} keeps native menu and readonly chrome with ordinary bootstrap absent`,{timeout:15000},()=>{
 const f=protectedApp('win32',failed),html=renderToStaticMarkup(React.createElement(f.App))
 assert.match(html,/data-desktop-menu-button/);assert.match(html,/desktop-drag/);assert.match(html,/data-protected-quit-button/);assert.equal(f.business,0);assert.equal(f.writes,0);assert.equal(f.bootstrap,null)
 assert.doesNotMatch(html,/正在打开本地工作台|重新打开工作台/)
})
test('PC36-02 protected mac chrome reserves original native system button space and uses safe dark metadata only',{timeout:15000},()=>{
 const f=protectedApp('darwin',false,true),html=renderToStaticMarkup(React.createElement(f.App));assert.match(html,/desktop-drag/);assert.match(html,/w-\[76px\]/);assert.match(html,/class="ink /);assert.doesNotMatch(html,/data-desktop-menu-button/);assert.equal(f.business,0);assert.equal(f.bootstrap,null)
})
test('PC36-03 Windows platform override issues only original fixed app.menu, normal fallback stays intact',{timeout:15000},async()=>{
 const calls:string[]=[],useDesktopStore=(select:(value:{bootstrap:{platform:'darwin'}})=>unknown)=>select({bootstrap:{platform:'darwin'}}),control=evaluate(declaration('src/components/desktop/WindowControls.tsx','WindowsMenuControl'),{React,useDesktopStore,window:{desktop:{command:async(id:string)=>calls.push(id)}},Menu:()=>React.createElement('svg')})
 assert.equal(control(),null);const item=control({platform:'win32'});assert.equal(item.props['data-desktop-menu-button'],true);await item.props.onClick();assert.deepEqual(calls,['app.menu']);assert.equal(control({platform:'darwin'}),null)
})
test('PC36-04 actual protected quit button issues only native app.quit while ordinary workbench stays absent',{timeout:15000},async()=>{
 const f=protectedApp('win32',true)
 const find=(node:unknown):React.ReactElement<Record<string,unknown>>|null=>{
  if(Array.isArray(node)){for(const child of node){const result=find(child);if(result)return result}return null}
  if(!React.isValidElement<Record<string,unknown>>(node))return null
  if(node.props['data-protected-quit-button']===true)return node
  return find(node.props.children)
 }
 const button=find(f.App());assert.ok(button);await (button.props.onClick as ()=>void)();assert.deepEqual(f.calls,['app.quit']);assert.equal(f.bootstrap,null);assert.equal(f.business,0);assert.equal(f.writes,0)
})
