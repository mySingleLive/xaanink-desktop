import type { Metadata } from "next"
import { Providers } from "./providers"
import "./globals.css"
import "./desktop.css"
export const metadata: Metadata = { title: "玄印写作", description: "本地创作，由你的模型驱动" }
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN" suppressHydrationWarning><body><Providers>{children}</Providers></body></html>
}
