"use client"
import type { ContentPanelProps } from "./registry"
import { SceneWorkspace } from "./scene/SceneWorkspace"
export function ScenePanel({novelId, refId}: ContentPanelProps) {return <SceneWorkspace novelId={novelId} selected={refId}/>}
