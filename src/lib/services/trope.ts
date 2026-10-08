import type { Trope, TropeKind } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"

/** 爽点/泪点合并视图条目：平台库条目 + 本小说自定义条目 */
export interface TropeLibraryItem {
  /** 平台条目 id（isCustom=false）或本小说自定义条目 id（isCustom=true） */
  id: string
  kind: TropeKind
  category: string
  content: string
  referenceCase: string
  isCustom: boolean
  /** 本小说是否已选中 */
  selected: boolean
  /** 本小说对应行的 id（选中副本或自定义行本身）；未选中的平台条目为 null */
  userTropeId: string | null
}

/** 判断一条用户 Trope 是否为平台库条目的「选中副本」（kind+category+content 相同） */
function isCopyOf(novelRow: Trope, platformRow: Trope): boolean {
  return (
    novelRow.kind === platformRow.kind &&
    novelRow.category === platformRow.category &&
    novelRow.content === platformRow.content
  )
}

async function findPlatformMatch(novelRow: Trope) {
  return prisma.trope.findFirst({
    where: {
      novelId: null,
      kind: novelRow.kind,
      category: novelRow.category,
      content: novelRow.content,
    },
  })
}

/**
 * 平台预置库（novelId=null）+ 本小说已选/自定义的合并视图。
 * 平台条目的选中状态由本小说的副本行（kind+category+content 匹配）推导；
 * 不匹配任何平台条目的本小说行视为自定义条目。
 */
export async function listTropeLibrary(novelId: string): Promise<TropeLibraryItem[]> {
  const [platformRows, myRows] = await Promise.all([
    prisma.trope.findMany({
      where: { novelId: null },
      orderBy: [{ kind: "asc" }, { category: "asc" }],
    }),
    prisma.trope.findMany({
      where: { novelId },
      orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
    }),
  ])

  const items: TropeLibraryItem[] = platformRows.map((p) => {
    const copy = myRows.find((m) => isCopyOf(m, p))
    return {
      id: p.id,
      kind: p.kind,
      category: p.category,
      content: p.content,
      referenceCase: p.referenceCase,
      isCustom: false,
      selected: copy?.selected ?? false,
      userTropeId: copy?.id ?? null,
    }
  })

  const customs = myRows.filter((m) => !platformRows.some((p) => isCopyOf(m, p)))
  for (const c of customs) {
    items.push({
      id: c.id,
      kind: c.kind,
      category: c.category,
      content: c.content,
      referenceCase: c.referenceCase,
      isCustom: true,
      selected: c.selected,
      userTropeId: c.id,
    })
  }

  return items
}

/**
 * 选中平台库条目：复制为本小说的行且 selected=true。
 * 幂等：已有副本则只确保 selected=true，不重复复制。
 */
export async function selectTrope(input: { novelId: string; tropeId: string }) {
  const { novelId, tropeId } = input
  const platform = await prisma.trope.findUnique({ where: { id: tropeId } })
  if (!platform || platform.novelId !== null) {
    throw new Error("平台爽点/泪点条目不存在")
  }

  const existing = await prisma.trope.findFirst({
    where: {
      novelId,
      kind: platform.kind,
      category: platform.category,
      content: platform.content,
    },
  })
  if (existing) {
    return existing.selected
      ? existing
      : prisma.trope.update({ where: { id: existing.id }, data: { selected: true } })
  }

  return prisma.trope.create({
    data: {
      novelId,
      kind: platform.kind,
      category: platform.category,
      content: platform.content,
      referenceCase: platform.referenceCase,
      selected: true,
    },
  })
}

/** 勾选/取消勾选本小说的某条记录（选中的副本或自定义条目） */
export async function toggleTrope(id: string, selected: boolean) {
  return prisma.trope.update({ where: { id }, data: { selected } })
}

export interface CustomTropeInput {
  novelId: string
  kind: TropeKind
  category: string
  content: string
  referenceCase: string
}

/** 新建自定义爽点/泪点，默认选中 */
export async function createCustomTrope(input: CustomTropeInput) {
  return prisma.trope.create({
    data: { ...input, selected: true },
  })
}

/**
 * 删除自定义条目。仅自定义（不匹配任何平台条目）且属于某小说的行可删，
 * 平台库条目与「选中副本」不可删（副本取消勾选即可）。不满足条件抛 Error。
 */
export async function deleteCustomTrope(id: string) {
  const trope = await prisma.trope.findUnique({ where: { id } })
  if (!trope || trope.novelId === null) {
    throw new Error("平台库条目不可删除")
  }
  const platformMatch = await findPlatformMatch(trope)
  if (platformMatch) {
    throw new Error("该条目来自平台库，不可删除，取消勾选即可")
  }
  return prisma.trope.delete({ where: { id } })
}
