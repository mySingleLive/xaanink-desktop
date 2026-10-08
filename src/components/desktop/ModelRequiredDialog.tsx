"use client"
import { Box } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import type { ModelRequiredNotice } from "@desktop/shared/ipc"

export function ModelRequiredDialog({ notice, onClose, onConfigure }: { notice: ModelRequiredNotice | null; onClose(): void; onConfigure(): void }) {
  const role = notice?.role === "image" ? "文生图模型" : notice?.role === "review" ? "审核模型" : "文本模型"
  const reason = notice?.code === "MODEL_NOT_CONFIGURED" ? `当前任务需要${role}，请先添加自己的模型。`
    : notice?.code === "MODEL_NOT_SELECTED" ? `当前任务尚未选择${role}。请在任务中选择，或为新任务配置默认模型。`
    : notice?.code === "MODEL_DISABLED" ? `当前任务选择的${role}已停用。`
    : notice?.code === "MODEL_NOT_FOUND" ? `当前任务选择的${role}已不存在。`
    : notice?.code === "MODEL_KEY_MISSING" ? `当前${role}的 API Key 不可用，请重新配置。`
    : notice?.code === "MODEL_KIND_MISMATCH" ? `当前选择的模型不能执行此任务，需要${role}。`
    : notice?.code === "AUTHORIZATION_REVOKED" ? `当前${role}的授权已更改，请检查配置后重新执行。`
    : `当前${role}不可用，请检查配置。`
  return <Dialog open={!!notice} onOpenChange={open => { if (!open) onClose() }}><DialogContent><DialogTitle>{notice?.code === "MODEL_NOT_CONFIGURED" ? "尚未配置模型" : "当前任务没有可用模型"}</DialogTitle><Box className="size-9 text-primary" /><DialogDescription>{reason}</DialogDescription><p className="text-sm text-muted-foreground">配置完成后请再次执行，本次不会自动发送。</p><div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>取消</Button><Button onClick={onConfigure}>去配置模型</Button></div></DialogContent></Dialog>
}
