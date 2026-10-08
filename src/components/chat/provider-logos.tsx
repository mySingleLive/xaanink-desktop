"use client"
import { Boxes } from "lucide-react"
import { cn } from "@/lib/utils"

// Approved local brand assets; provenance and license remain in design/*-logo-provenance.json.
const names: Record<string,string> = { openai:"OpenAI",anthropic:"Anthropic",google:"Google",xai:"xAI",deepseek:"深度求索",kimi:"月之暗面",zai:"智谱",xiaomi:"Xiaomi",qwen:"阿里巴巴",minimax:"MiniMax",tencent:"腾讯",bytedance:"字节跳动" }
const aliases: Record<string,string> = { zhipu:"zai",moonshot:"kimi",alibaba:"qwen",hunyuan:"tencent",volcengine:"bytedance" }
const modelAssets = new Set(["openai","anthropic","google","xai","kimi","qwen","tencent","bytedance"])
export function ProviderLogo({ provider, className, variant = "model" }: { provider: string; className?: string; variant?: "provider" | "model" }) {
  const id = aliases[provider.toLowerCase()] ?? provider.toLowerCase()
  if (!names[id]) return <Boxes className={className} data-provider-logo={provider} aria-hidden="true" />
  const family = variant === "model" && modelAssets.has(id) ? "models" : "providers"
  return <img src={`/brands/${family}/${id}.svg`} alt={names[id]} draggable={false} data-provider-logo={id} className={cn("shrink-0 object-contain",family === "models" && id === "openai" && "dark:invert",className)} />
}
