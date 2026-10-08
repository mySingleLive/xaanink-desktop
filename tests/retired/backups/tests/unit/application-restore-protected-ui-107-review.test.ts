import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import ts from 'typescript'
import {transformSync} from 'esbuild'

function declaration(path:string,name:string){const source=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),node=source.statements.find(row=>ts.isFunctionDeclaration(row)&&row.name?.text===name);assert.ok(node);return node.getText(source).replace(/^export\s+(?:default\s+)?/,'')}
function evaluate(code:string,deps:Record<string,unknown>){return new Function(...Object.keys(deps),transformSync(`return (${code})`,{loader:'tsx',jsx:'transform',jsxFactory:'React.createElement',jsxFragment:'React.Fragment'}).code)(...Object.values(deps))}

// Actual DesktopApp + WindowsMenuControl JSX, controlled hooks/native metadata
// and static React rendering. This is a Windows adaptation development check,
// not a physical Windows window/menu or full desktop acceptance test.
for(const failed of[false,true])test(`AR107-UI01 Windows protected ${failed?'failure':'checkpoint loading'} retains its menu icon without exposing ordinary workbench`,()=>{
 let hook=0,business=0
 const useDesktopStore=(select:(state:{bootstrap:null})=>unknown)=>select({bootstrap:null})
 const WindowsMenuControl=evaluate(declaration('src/components/desktop/WindowControls.tsx','WindowsMenuControl'),{React,useDesktopStore,Menu:()=>React.createElement('svg',{'aria-hidden':true})})
 const Button=({children,...props}:{children:React.ReactNode})=>React.createElement('button',props,children)
 const App=evaluate(declaration('src/components/desktop/DesktopApp.tsx','DesktopApp'),{React,useDesktopStore,useState(initial:unknown){const index=hook++;return[index===0?(failed?'actual protected startup failure':null):index===1?{sessionId:'current-protected-session',platform:'win32',systemDark:false}:initial,()=>{}]},useRef:(value:unknown)=>({current:value}),useTheme:()=>({setTheme(){}}),useQueryClient:()=>({}),useEffect(){},useDesktopCommands(){},WindowsMenuControl,Button,WorkLeasePendingDialog:()=>null,RecoveryDialog:()=>React.createElement('aside',{'data-protected-recovery':true}),DesktopCommandController(){business++;return null},DesktopNavigation(){business++;return null},DashboardShell(){business++;return null}})
 const html=renderToStaticMarkup(React.createElement(App))
 assert.equal(business,0);assert.match(html,/data-desktop-menu-button/,'Windows protected UI must retain the menu button immediately left of native window controls')
 assert.match(html,/应用程序菜单/)
})
