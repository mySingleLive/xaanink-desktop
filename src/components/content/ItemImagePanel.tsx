"use client"

import { useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ImageIcon, Loader2, Package, Sparkles, Upload, Wand2 } from "lucide-react"
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
import type { ItemImageSource } from "@/generated/prisma/enums"
import { buildItemImagePrompt } from "@/lib/item-image-prompt"
import { cn } from "@/lib/utils"

import { apiGet, apiSend, readError } from "./api"
import { CroppedImage } from "./CroppedImage"
import { ImageCropEditor } from "./ImageCropEditor"
import type { ContentPanelProps } from "./registry"
import { normalizeCrop, type CropRect, type ItemRecord } from "./types"
import { SaveStatusIndicator, type SaveStatus } from "./use-autosave"

/** GET /api/novels/[id]/items/[itemId]/images 图标版本记录 */
interface ItemImageRecord {
  id: string
  itemId: string
  source: ItemImageSource
  url: string
  prompt: string
  createdAt: string
}

interface ImageModelOption {
  id: string
  name: string
  provider: string
  modelId: string
}

function IconWorkspace({ novelId, item }: { novelId: string; item: ItemRecord }) {
  const queryClient = useQueryClient()
  const itemId = item.id

  const url = item.iconUrl
  const serverCrop = normalizeCrop(item.iconCrop)

  const [prompt, setPrompt] = useState(() => buildItemImagePrompt(item))
  const [modelId, setModelId] = useState("auto")
  const [crop, setCrop] = useState<CropRect | null>(serverCrop)
  const [cropStatus, setCropStatus] = useState<SaveStatus>("idle")
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 切换当前版本（url 变化）后，裁剪区域跟随服务端重置（渲染期间派生，React 官方模式）
  const [lastUrl, setLastUrl] = useState(url)
  if (url !== lastUrl) {
    setLastUrl(url)
    setCrop(serverCrop)
  }

  const { data: modelsData } = useQuery({
    queryKey: ["image-models"],
    queryFn: () =>
      apiGet<{ models: ImageModelOption[]; defaultModelId: string | null }>("/api/image-models", "加载文生图模型失败"),
  })
  const models = modelsData?.models ?? []
  const { selected: selectedModel, label: modelLabel, defaultModel, defaultLabel } = imageModelSelection(models, modelsData?.defaultModelId, modelId)

  const { data: imagesData } = useQuery({
    queryKey: ["item-images", novelId, itemId],
    queryFn: () =>
      apiGet<{ images: ItemImageRecord[] }>(
        `/api/novels/${novelId}/items/${itemId}/images`,
        "加载历史版本失败"
      ),
  })
  const versions = imagesData?.images ?? []

  // 物品列表缓存一并失效：图标在管理面板卡片、芯片与悬停卡上联动
  const invalidateImages = () => {
    queryClient.invalidateQueries({ queryKey: ["items", novelId] })
    queryClient.invalidateQueries({ queryKey: ["item-images", novelId, itemId] })
  }

  const generateMutation = useMutation({
    mutationFn: () =>
      apiSend<{ url: string }>(
        `/api/novels/${novelId}/items/${itemId}/image`,
        "POST",
        { prompt: prompt.trim(), ...(modelId !== "auto" ? { modelId } : {}) },
        "图片生成失败"
      ),
    onSuccess: () => {
      invalidateImages()
      toast.success("图标已生成")
    },
    onError: (err) => toast.error(err.message),
  })

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.append("file", file)
      const res = await fetch(`/api/novels/${novelId}/items/${itemId}/images`, {
        method: "POST",
        body: form,
      })
      if (!res.ok) throw new Error(await readError(res, "上传失败"))
      return (await res.json()) as { url: string }
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
        `/api/novels/${novelId}/items/${itemId}/image-prompt`,
        "POST",
        undefined,
        "AI 帮写失败"
      ),
    onSuccess: ({ text }) => {
      setPrompt(text)
      toast.success("提示词已写好，可继续修改")
    },
    onError: (err) => toast.error(err.message),
  })

  const selectVersionMutation = useMutation({
    mutationFn: (version: ItemImageRecord) =>
      apiSend(
        `/api/novels/${novelId}/items/${itemId}/image`,
        "PATCH",
        { url: version.url },
        "切换版本失败"
      ),
    onSuccess: (_data, version) => {
      if (version.prompt) setPrompt(version.prompt)
      invalidateImages()
    },
    onError: (err) => toast.error(err.message),
  })

  /** 裁剪结束（拖动松手/默认裁剪产生）时持久化 */
  const persistCrop = async (next: CropRect) => {
    setCropStatus("saving")
    try {
      await apiSend(
        `/api/novels/${novelId}/items/${itemId}/image`,
        "PATCH",
        { crop: next },
        "保存裁剪失败"
      )
      setCropStatus("saved")
      queryClient.invalidateQueries({ queryKey: ["items", novelId] })
    } catch (err) {
      setCropStatus("error")
      toast.error(err instanceof Error ? err.message : "保存裁剪失败")
    }
  }

  const busy = generateMutation.isPending || uploadMutation.isPending

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b px-6 py-3">
        <span className="text-lg font-medium">{item.name} · 图标</span>
        <Badge variant="outline">1:1</Badge>
        <SaveStatusIndicator status={cropStatus} />
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 主区：原始图像 + 提示词 + 操作 */}
        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
          <div className="relative flex min-h-[340px] flex-1 items-center justify-center overflow-hidden rounded-xl border bg-muted/30 p-4">
            {url ? (
              <ImageCropEditor
                key={url}
                src={url}
                aspect={1}
                crop={crop}
                onChange={setCrop}
                onCommit={persistCrop}
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <ImageIcon className="size-10 text-muted-foreground/50" />
                <p className="text-sm">还没有原始图像</p>
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
              onChange={(e) => setPrompt(e.target.value)}
              rows={10}
              maxLength={4000}
              className="min-h-56 resize-y leading-relaxed"
              placeholder="描述想要的画面：构图、形制、材质、颜色、画风…"
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
              图标预览（实际效果）
            </span>
            <div className="relative size-32 overflow-hidden rounded-lg border bg-muted/40">
              {url ? (
                <CroppedImage src={url} crop={crop} alt={`${item.name}图标`} />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-muted-foreground/50">
                  <Package className="size-8" />
                </span>
              )}
            </div>
            <p className="text-center text-xs text-muted-foreground">
              拖动左侧大图中的虚线框，调整显示区域
            </p>
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
                      "relative aspect-square overflow-hidden rounded-md border transition-shadow",
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

/** 物品图标生成面板（type=item-image，refId=物品 id；物品只有图标一种图，固定 1:1） */
export function ItemImagePanel({ novelId, refId }: ContentPanelProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["items", novelId],
    queryFn: () =>
      apiGet<{ items: ItemRecord[] }>(`/api/novels/${novelId}/items`, "加载物品失败"),
  })

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }
  if (isError) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        物品加载失败，请稍后重试
      </div>
    )
  }

  const item = (data?.items ?? []).find((i) => i.id === refId)
  if (!item) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        物品不存在或已被删除
      </div>
    )
  }

  return <IconWorkspace key={item.id} novelId={novelId} item={item} />
}
