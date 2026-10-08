"use client"

/**
 * 情景试验场·主干视图：横向链式情节点（每回合由导演自动派生一句话情节点，溯源回合号）。
 * 轻量版主干视图：只读链 + 双击改文本 + 删除；无拖拽/连线热区/生长。
 */

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { MoreHorizontal, MoveRight, Trash2 } from "lucide-react"
import { toast } from "sonner"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import { apiSend } from "../../api"
import { invalidateScenarioDetail } from "../queries"
import type { ScenarioDetail, ScenarioNodeRecord } from "../types"

interface TrunkViewProps {
  novelId: string
  labId: string
  detail: ScenarioDetail
}

export function TrunkView({ novelId, labId, detail }: TrunkViewProps) {
  const queryClient = useQueryClient()
  const { nodes, turns } = detail
  const turnIndexById = new Map(turns.map((t) => [t.id, t.index] as const))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState("")

  const updateMutation = useMutation({
    mutationFn: ({ nodeId, text }: { nodeId: string; text: string }) =>
      apiSend(
        `/api/novels/${novelId}/scenarios/${labId}/nodes/${nodeId}`,
        "PATCH",
        { text },
        "保存情节点失败"
      ),
    onSuccess: () => invalidateScenarioDetail(queryClient, labId),
    onError: (err) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (nodeId: string) =>
      apiSend(
        `/api/novels/${novelId}/scenarios/${labId}/nodes/${nodeId}`,
        "DELETE",
        undefined,
        "删除情节点失败"
      ),
    onSuccess: () => invalidateScenarioDetail(queryClient, labId),
    onError: (err) => toast.error(err.message),
  })

  const commitEdit = (node: ScenarioNodeRecord) => {
    setEditingId(null)
    const text = editDraft.trim()
    if (text && text !== node.text) updateMutation.mutate({ nodeId: node.id, text })
  }

  if (nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-muted-foreground">
        还没有情节点——回聊天视图开局并推进几回合，主干会随推演自动生长。
      </div>
    )
  }

  return (
    <div className="h-full overflow-x-auto overflow-y-hidden">
      <div className="flex h-full items-center gap-0 px-8">
        {nodes.map((node, i) => {
          const turnIndex = node.turnId ? turnIndexById.get(node.turnId) : undefined
          return (
            <div key={node.id} className="flex shrink-0 items-center">
              {i > 0 && <MoveRight className="mx-3 size-4 shrink-0 text-muted-foreground/50" />}
              <div className="sc-node group">
                <div className="flex items-center gap-1.5">
                  <span className="sc-node-no">{i + 1}</span>
                  {turnIndex !== undefined && (
                    <span className="text-[10.5px] text-muted-foreground/70">
                      第{turnIndex}回合
                    </span>
                  )}
                  <div className="flex-1" />
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <button
                          type="button"
                          aria-label="情节点操作"
                          className="flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-hover-wash group-hover:opacity-100 data-popup-open:opacity-100"
                        />
                      }
                    >
                      <MoreHorizontal className="size-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-auto min-w-24">
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => deleteMutation.mutate(node.id)}
                      >
                        <Trash2 />
                        删除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {editingId === node.id ? (
                  <textarea
                    autoFocus
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    onBlur={() => commitEdit(node)}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing) return
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        commitEdit(node)
                      } else if (e.key === "Escape") {
                        setEditingId(null)
                      }
                    }}
                    rows={3}
                    className="mt-1 w-full resize-none rounded-inner border border-input bg-chat-surface px-1.5 py-1 text-[12.5px] leading-relaxed outline-none focus:border-primary"
                  />
                ) : (
                  <p
                    className="mt-1 cursor-text text-[12.5px] leading-relaxed"
                    title="双击编辑"
                    onDoubleClick={() => {
                      setEditDraft(node.text)
                      setEditingId(node.id)
                    }}
                  >
                    {node.text}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
