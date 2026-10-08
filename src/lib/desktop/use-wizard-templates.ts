"use client"
import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { z } from "zod"
import { apiFetch } from "@/components/admin/shared"
import { WIZARD_TEMPLATES } from "@/lib/creation-wizard/templates"
import { portableWizardSchema } from "@desktop/shared/template-library"

const activeTemplatesSchema=z.object({templates:z.array(portableWizardSchema),revision:z.number().int().nonnegative()}).strict()
/** Desktop consumes its persisted catalog; a failed read cannot pick a bundled fallback. */
export function useWizardTemplates(open:boolean){
 const desktop=typeof window!=="undefined"&&!!window.desktop
 const query=useQuery({queryKey:["desktop","wizard-templates","active"],enabled:desktop&&open,queryFn:async()=>activeTemplatesSchema.parse(await apiFetch("/api/templates/wizard?enabled=true"))})
 const templates=useMemo(()=>desktop?(query.data?.templates.filter(row=>row.enabled).map(row=>row.template)??[]):WIZARD_TEMPLATES,[desktop,query.data])
 return{templates,loading:desktop&&open&&!query.data&&query.isPending,error:desktop?query.error:null,reload:()=>query.refetch()}
}
