"use client"
import dynamic from "next/dynamic"
import {useEffect,useState} from "react"
const DesktopApp = dynamic(() => import("@/components/desktop/DesktopApp"), { ssr: false })
const Maintenance = dynamic(() => import("@/components/desktop/RootMaintenanceScreen").then(module=>module.RootMaintenanceScreen), { ssr: false })
const Relocation = dynamic(() => import("@/components/desktop/RootRelocationScreen").then(module=>module.RootRelocationScreen), { ssr: false })
export default function Home() {
 const [mode,setMode]=useState<"workbench"|"maintenance"|"relocation"|null>(null)
 useEffect(()=>setMode(window.desktopRootRelocation?"relocation":window.desktopMaintenance?"maintenance":"workbench"),[])
 return mode==="relocation"?<Relocation/>:mode==="maintenance"?<Maintenance/>:mode==="workbench"?<DesktopApp/>:<main className="flex h-dvh items-center justify-center text-muted-foreground" role="status">正在打开玄印写作…</main>
}
