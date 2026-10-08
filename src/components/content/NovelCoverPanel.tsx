"use client"

import { useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BookOpen,
  ImageIcon,
  Loader2,
  Sparkles,
  Upload,
  Wand2,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ProviderLogo } from "@/components/chat/provider-logos"
import { imageModelSelection } from "@/lib/desktop/image-model-selection"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { buildCoverImagePrompt } from "@/lib/cover-image-prompt"
import { cn } from "@/lib/utils"

import { apiGet, apiSend, readError } from "./api"
import type { ContentPanelProps } from "./registry"
import type { NovelCoverImageRecord, NovelDetail } from "./types"

interface ImageModelOption {
  id: string
  name: string
  provider: string
  modelId: string
}

interface CoverThemeData {
  title: string
  synopsis: string
  genre: string
  tags: string[]
}

function CoverWorkspace({
  novelId,
  novel,
}: {
  novelId: string
  novel: NovelDetail
}) {
  const queryClient = useQueryClient()
  const url = novel.coverUrl

  const [prompt, setPrompt] = useState("")
  const [promptTouched, setPromptTouched] = useState(false)
  const [modelId, setModelId] = useState("auto")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: themeData } = useQuery({
    queryKey: ["theme", novelId],
    queryFn: () =>
      apiGet<{ theme: CoverThemeData | null }>(
        `/api/novels/${novelId}/theme`,
        "加载主题失败"
      ),
  })
  const theme = themeData?.theme

  // 主题查询首次返回且用户尚未手动编辑过时，渲染期间派生填入初始提示词（React 官方模式，不用 useEffect）
  const [promptSeeded, setPromptSeeded] = useState(false)
  if (!promptSeeded && !promptTouched && themeData !== undefined) {
    setPromptSeeded(true)
    setPrompt(
      buildCoverImagePrompt({
        title: theme?.title || novel.title || "",
        synopsis: theme?.synopsis,
        genre: theme?.genre,
        tags: theme?.tags,
      })
    )
  }

  const { data: modelsData } = useQuery({
    queryKey: ["image-models"],
    queryFn: () =>
      apiGet<{ models: ImageModelOption[]; defaultModelId: string | null }>("/api/image-models", "加载文生图模型失败"),
  })
  const models = modelsData?.models ?? []
  const { selected: selectedModel, label: modelLabel, defaultModel, defaultLabel } = imageModelSelection(models, modelsData?.defaultModelId, modelId)

  const { data: imagesData } = useQuery({
    queryKey: ["cover-images", novelId],
    queryFn: () =>
      apiGet<{ images: NovelCoverImageRecord[] }>(
        `/api/novels/${novelId}/cover/images`,
        "加载历史版本失败"
      ),
  })
  const versions = imagesData?.images ?? []

  const invalidateImages = () => {
    queryClient.invalidateQueries({ queryKey: ["novels", novelId] })
    queryClient.invalidateQueries({ queryKey: ["novels"] })
    queryClient.invalidateQueries({ queryKey: ["cover-images", novelId] })
  }

  const generateMutation = useMutation({
    mutationFn: () =>
      apiSend<{ url: string; image: NovelCoverImageRecord }>(
        `/api/novels/${novelId}/cover`,
        "POST",
        { prompt: prompt.trim(), ...(modelId !== "auto" ? { modelId } : {}) },
        "封面生成失败"
      ),
    onSuccess: () => {
      invalidateImages()
      toast.success("封面已生成")
    },
    onError: (err) => toast.error(err.message),
  })

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.append("file", file)
      const res = await fetch(`/api/novels/${novelId}/cover/images`, {
        method: "POST",
        body: form,
      })
      if (!res.ok) throw new Error(await readError(res, "上传失败"))
      return (await res.json()) as { url: string; image: NovelCoverImageRecord }
    },
    onSuccess: () => {
      invalidateImages()
      toast.success("图片已上传")
    },
    onError: (err) => toast.error(err.message),
  })

  const aiWriteMutation = useMutation({
    mutationFn: () =>
      apiSend<{ text: string }>(
        `/api/novels/${novelId}/cover/image-prompt`,
        "POST",
        undefined,
        "AI 帮写失败"
      ),
    onSuccess: ({ text }) => {
      setPromptTouched(true)
      setPrompt(text)
      toast.success("提示词已写好，可继续修改")
    },
    onError: (err) => toast.error(err.message),
  })

  const selectVersionMutation = useMutation({
    mutationFn: (version: NovelCoverImageRecord) =>
      apiSend(`/api/novels/${novelId}/cover`, "PATCH", { url: version.url }, "切换版本失败"),
    onSuccess: (_data, version) => {
      if (version.prompt) {
        setPromptTouched(true)
        setPrompt(version.prompt)
      }
      invalidateImages()
    },
    onError: (err) => toast.error(err.message),
  })

  const busy = generateMutation.isPending || uploadMutation.isPending

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b px-6 py-3">
        <span className="text-lg font-medium">封面 · {novel.title}</span>
        <Badge variant="outline">2:3</Badge>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 主区：封面图 + 提示词 + 操作 */}
        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
          <div
            className={cn(
              "relative flex min-h-[340px] flex-1 items-center justify-center overflow-hidden rounded-xl border bg-muted/30 p-4",
              !url && "border-dashed"
            )}
          >
            {url ? (
              /* eslint-disable-next-line @next/next/no-img-element -- 本地封面原图直接展示 */
              <img
                src={url}
                alt={`${novel.title}封面`}
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <ImageIcon className="size-10 text-muted-foreground/50" />
                <p className="text-sm">还没有封面</p>
                <p className="text-xs">点击下方「生成图片」，或从本地上传一张</p>
              </div>
            )}

            <div className="absolute top-3 right-3">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadMutation.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Upload />
                )}
                上传图片
              </Button>
            </div>

            {generateMutation.isPending && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/70">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  生成中，可能需要几十秒…
                </p>
              </div>
            )}
          </div>

          <div className="grid gap-2">
            <Label>文生图提示词</Label>
            <Textarea
              value={prompt}
              onChange={(e) => {
                setPromptTouched(true)
                setPrompt(e.target.value)
              }}
              rows={10}
              maxLength={4000}
              className="min-h-56 resize-y leading-relaxed"
              placeholder="描述想要的画面：构图、主体、色调、氛围、画风…"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select value={modelId} onValueChange={(v) => v && setModelId(v)}>
              <SelectTrigger className="w-60" aria-label="选择文生图模型">
                <SelectValue>{selectedModel && <ProviderLogo provider={selectedModel.provider} className="size-4" />}{modelLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{defaultModel && <ProviderLogo provider={defaultModel.provider} className="size-4" />}{defaultLabel}</SelectItem>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    <ProviderLogo provider={m.provider} className="size-4" />
                    {m.name}（{m.modelId}）
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              disabled={aiWriteMutation.isPending || busy}
              onClick={() => aiWriteMutation.mutate()}
            >
              {aiWriteMutation.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Sparkles />
              )}
              AI 帮写提示词
            </Button>
            <div className="ml-auto" />
            <Button
              disabled={!prompt.trim() || busy}
              onClick={() => generateMutation.mutate()}
            >
              {generateMutation.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Wand2 />
              )}
              生成图片
            </Button>
          </div>
          {models.length === 0 && (
            <p className="text-xs text-muted-foreground">
              尚未配置文生图模型：请到「设置 → 模型」添加一条类型为「图像（文生图）」的模型（如
              gpt-image、seedream），否则生成会失败。
            </p>
          )}
        </div>

        {/* 右侧栏：实际效果预览 + 历史版本 */}
        <aside className="flex w-60 shrink-0 flex-col gap-4 overflow-y-auto border-l bg-card/40 p-4">
          <div className="grid justify-items-center gap-2">
            <span className="justify-self-start text-xs font-medium text-muted-foreground">
              封面预览（实际效果）
            </span>
            <div className="relative aspect-[2/3] w-28 overflow-hidden rounded-lg border bg-muted/40">
              {url ? (
                /* eslint-disable-next-line @next/next/no-img-element -- 本地封面缩略预览 */
                <img
                  src={url}
                  alt={`${novel.title}封面预览`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-muted-foreground/50">
                  <BookOpen className="size-8" />
                </span>
              )}
            </div>
          </div>

          <Separator />

          <div className="grid gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              历史版本{versions.length > 0 ? `（${versions.length}）` : ""}
            </span>
            {versions.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                生成或上传的图片会保留在这里，可随时切回任意版本。
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {versions.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    title={`${new Date(v.createdAt).toLocaleString("zh-CN")} · ${v.source === "AI" ? "AI 生成" : "手动上传"}${v.url === url ? "（当前）" : "，点击设为当前"}`}
                    disabled={selectVersionMutation.isPending || v.url === url}
                    onClick={() => selectVersionMutation.mutate(v)}
                    className={cn(
                      "relative aspect-[2/3] overflow-hidden rounded-md border transition-shadow",
                      v.url === url
                        ? "ring-2 ring-primary"
                        : "hover:ring-2 hover:ring-primary/50"
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- 本地版本缩略图 */}
                    <img
                      src={v.url}
                      alt="历史版本"
                      className="h-full w-full object-cover"
                    />
                    <span className="absolute right-0.5 bottom-0.5 rounded-[3px] bg-background/85 px-1 text-[9px] leading-[1.5] text-muted-foreground">
                      {v.source === "AI" ? "AI" : "上传"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ""
          if (file) uploadMutation.mutate(file)
        }}
      />
    </div>
  )
}

/** 小说封面面板（type=novel-cover）：文生图生成/上传封面 + 历史版本切换 */
export function NovelCoverPanel({ novelId }: ContentPanelProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["novels", novelId],
    queryFn: () =>
      apiGet<{ novel: NovelDetail }>(`/api/novels/${novelId}`, "加载小说失败"),
  })

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }
  if (isError || !data?.novel) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        小说加载失败，请稍后重试
      </div>
    )
  }

  return <CoverWorkspace novelId={novelId} novel={data.novel} />
}
