"use client"

import { FileCode, Files, FileText, FileType } from "lucide-react"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import type { ManuscriptExportFormat } from "@/lib/manuscript-export"

export function ManuscriptExportItems({ disabled, onExport }: { disabled?: boolean; onExport: (format: ManuscriptExportFormat) => void }) {
  return <>{([
    ["txt", "TXT 文本 (.txt)", FileText], ["md", "Markdown (.md)", FileCode],
    ["docx", "Word (.docx)", FileType], ["pdf", "PDF (.pdf)", Files],
  ] as const).map(([format, label, Icon]) => (
    <DropdownMenuItem key={format} disabled={disabled} onClick={() => onExport(format)}>
      <Icon aria-hidden="true" />{label}
    </DropdownMenuItem>
  ))}</>
}
