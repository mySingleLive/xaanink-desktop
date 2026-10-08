"use client"

/**
 * 情景试验场·样文视图：把推演流水 AI 改写成连贯正文（落 lab.prose，与正文列表完全隔离）。
 * MarkdownEditor（Monaco 内核，编辑/分屏/预览三态）编辑 + 「保存」手动落库。
 */

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, ScrollText, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { MarkdownEditor } from "@/components/editor/MarkdownEditor"

import { apiSend } from "../../api"
import { Button } from "@/components/ui/button"
import { invalidateScenarioDetail } from "../queries"
import type { ScenarioDetail, ScenarioLabRecord } from "../types"

interface ProseViewProps {
  novelId: string
  labId: string
  detail: ScenarioDetail
}

export function ProseView({ novelId, labId, detail }: ProseViewProps) {
  const queryClient = useQueryClient()
  const { scenario: lab, turns } = detail
  const [draft, setDraft] = useState<string | null>(null)

  const prose = draft ?? lab.prose
  const dirty = draft !== null && draft !== lab.prose

  const generateMutation = useMutation({
    mutationFn: () =>
      apiSend<{ scenario: ScenarioLabRecord }>(
        `/api/novels/${novelId}/scenarios/${labId}/prose`,
        "POST",
        undefined,
        "生成样文失败"
      ),
    onSuccess: (data) => {
      setDraft(null)
      toast.success(`样文已生成（约 ${data.scenario.prose.length} 字）`)
      invalidateScenarioDetail(queryClient, labId)
    },
    onError: (err) => toast.error(err.message),
  })

  const saveMutation = useMutation({
    mutationFn: (value: string) =>
      apiSend<{ scenario: ScenarioLabRecord }>(
        `/api/novels/${novelId}/scenarios/${labId}`,
        "PATCH",
        { prose: value },
        "保存样文失败"
      ),
    onSuccess: () => {
      setDraft(null)
      toast.success("样文已保存")
      invalidateScenarioDetail(queryClient, labId)
    },
    onError: (err) => toast.error(err.message),
  })

  const busy = generateMutation.isPending || saveMutation.isPending

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-4 py-2">
        <span className="text-[11.5px] text-muted-foreground">
          {lab.proseAt
            ? `上次生成于 ${new Date(lab.proseAt).toLocaleString("zh-CN")} · 样文独立于正文列表，仅作推演记录`
            : "样文由推演流水 AI 改写而来，独立于正文列表"}
        </span>
        <div className="flex-1" />
        {dirty && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => saveMutation.mutate(prose)}
          >
            {saveMutation.isPending && <Loader2 className="animate-spin" />}
            保存
          </Button>
        )}
        <Button
          size="sm"
          variant={lab.prose ? "outline" : "default"}
          disabled={turns.length === 0 || busy}
          title={turns.length === 0 ? "先开局并推进几回合" : "按当前全部推演流水重新改写"}
          onClick={() => {
            if (
              lab.prose &&
              !window.confirm("将按当前推演流水重新生成样文，现有样文（含你的手动修改）会被覆盖。继续？")
            )
              return
            generateMutation.mutate()
          }}
        >
          {generateMutation.isPending ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          {lab.prose ? "重新生成样文" : "生成样文"}
        </Button>
      </div>

      <div className="min-h-0 flex-1 px-4 pb-4">
        {lab.prose || draft !== null ? (
          <MarkdownEditor
            value={prose}
            onChange={setDraft}
            placeholder="样文"
            className="h-full"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-[13px] text-muted-foreground">
            <ScrollText className="size-7 text-muted-foreground/50" />
            还没有样文——推进几回合后点右上角「生成样文」，AI 会把推演流水改写成连贯正文。
          </div>
        )}
      </div>
    </div>
  )
}
