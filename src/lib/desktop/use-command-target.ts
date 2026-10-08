"use client"
import {useEffect,useRef,type RefObject} from "react"
import {registerDesktopCommandTarget} from "./command-runtime"
import type {CommandHandler} from "./command-targets"
export function useDesktopCommands(commands:Record<string,CommandHandler>,root?:RefObject<HTMLElement|null>){
 const latest=useRef(commands);latest.current=commands
 const keys=Object.keys(commands).sort().join("\n")
 useEffect(()=>{
  const owner={}
  return registerDesktopCommandTarget({owner,accepts:target=>!root||!!(root.current?.isConnected&&root.current.getClientRects().length&&target&&root.current.contains(target)),
   commands:Object.fromEntries(keys.split("\n").filter(Boolean).map(id=>[id,{
    enabled:()=>{const command=latest.current[id];return !!command&&(typeof command==="function"||command.enabled?.()!==false)},
    run:()=>{const command=latest.current[id];return typeof command==="function"?command():command.run()},
   }]))})
 },[keys,root])
}
