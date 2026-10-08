"use client"
import type { ContentPanelProps } from "./registry"
import { SceneWorkspace } from "./scene/SceneWorkspace"
export function ScenesPanel({novelId}: ContentPanelProps) {return <SceneWorkspace novelId={novelId}/>}
