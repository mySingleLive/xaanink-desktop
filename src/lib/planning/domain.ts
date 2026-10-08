import { z } from "zod";
import { materialRefSchema, MATERIAL_LABELS, MATERIAL_ROLE_LABELS } from "../material-reference";

const id = z.string().min(1).max(160);
const text = z.string().max(100000);
const name = z.string().trim().min(1).max(300);
const budget = z.number().int().min(1).max(200000);
const timeSchema = z.object({
  kind: z.enum(["exact", "window", "unknown"]).default("unknown").describe("exact=确定起点（可用duration表示持续事件）；window=起点不确定的候选区间，不是持续事件的起止区间；unknown=未知"),
  value: z.number().finite().default(0).describe("相对零点或anchor的小时数；第30天=720。precision只影响显示精度，不改变单位"),
  end: z.number().finite().nullable().default(null).describe("仅window使用：不确定起点的最晚小时数。持续事件请用exact+duration"),
  anchor: id.nullable().default(null),
  boundary: z.enum(["start", "end"]).default("start"),
  precision: z.enum(["hour", "day", "month", "year"]).default("hour"),
  label: z.string().max(500).default(""),
});
const calendarSchema = z.object({
  kind: z.enum(["fixed", "gregorian", "years"]).default("fixed"),
  epoch: z.string().max(100).default("故事开始"),
  hoursPerDay: z.number().positive().max(10000).nullable().default(24),
  daysPerMonth: z.number().int().positive().max(1000).nullable().default(30),
  monthsPerYear: z.number().int().positive().max(1000).nullable().default(12),
});
export const eventSchema = z.object({
  id,
  line: id.describe("所属世界线ID，必须引用worlds[].id，不能引用叙事线lines[].id"),
  parent: id.nullable().default(null),
  title: name,
  fact: text.default(""),
  materialRefs: z.array(materialRefSchema).max(40).default([]),
  people: z.array(id).max(100).default([]),
  time: timeSchema.default(() => timeSchema.parse({})),
  duration: z.number().finite().nonnegative().nullable().default(0).describe("持续小时数；父事件覆盖90天应为2160。精度为day/year时仍使用小时数"),
  ongoing: z.boolean().default(false),
  changes: z
    .array(
      z.object({
        id,
        character: id,
        dimension: name,
        before: text,
        after: text,
        at: z.enum(["start", "end"]).default("end"),
      }),
    )
    .max(100)
    .default([]),
});
export const periodSchema = z.object({
  id,
  line: id.describe("所属世界线ID，引用worlds[].id"),
  title: name,
  start: z.number().finite(),
  end: z.number().finite().nullable(),
  event: id.nullable().default(null),
  ongoing: z.boolean().default(false),
});
export const worldlineSchema = z.object({
  id,
  name,
  worldId: id.nullable().default(null),
  timeBases: z
    .array(
      z.object({
        id,
        name,
        calendar: calendarSchema,
        offset: z.number().finite().nullable().default(null),
        scale: z.number().positive().default(1),
        anchor: id.nullable().default(null),
        boundary: z.enum(["start", "end"]).default("start"),
      }),
    )
    .max(20)
    .default([]),
  calendar: calendarSchema.default(() => calendarSchema.parse({})),
  fork: z
    .object({
      source: id,
      event: id,
      version: z.number().int().nonnegative(),
      events: z.array(eventSchema),
      periods: z.array(periodSchema),
      calendar: calendarSchema,
    })
    .nullable()
    .default(null),
});
export const lineSchema = z.object({
  id,
  name,
  primary: z.boolean().default(false),
});
const refSchema = z.object({
  reliability: z
    .enum(["客观事实", "角色有限事实", "人物推测", "可能不可靠"])
    .optional(),
  character: id.nullable().optional(),
  line: id,
  event: id,
  reveal: text.default(""),
  withheld: text.default(""),
  source: text.default("作者构思"),
});
/** 段落节拍：叶卡某视角下「这一段写什么」的段落级细纲；数组顺序即段落顺序。 */
export const beatTypeSchema = z.enum([
  "事件",
  "人物",
  "环境",
  "回忆",
  "心理",
  "分析",
  "对话",
  "动作",
  "感受",
  "过渡",
]);
export const beatSchema = z.object({
  type: beatTypeSchema.describe("本段的描写类型"),
  summary: z.string().min(1).max(200).describe("本段要写什么：具体到人、事、信息点，一两句话说清"),
});
export const tellingSchema = z.object({
  id,
  character: id.nullable().default(null),
  narrator: z.string().max(100).default("待定"),
  intent: text.default(""),
  materialRefs: z.array(materialRefSchema).max(40).default([]),
  source: text.default("作者构思"),
  reliability: z
    .enum(["客观事实", "角色有限事实", "人物推测", "可能不可靠"])
    .default("客观事实"),
  refs: z.array(refSchema).max(100).default([]),
  beats: z
    .array(beatSchema)
    .max(30)
    .default([])
    .describe("段落级细纲：本视角段按顺序逐段列出描写类型与内容提要；进入正文章纲的阅读卡必须填写，粒度约每300-400字一拍"),
});
export const cardSchema = z.object({
  id,
  line: id,
  parent: id.nullable().default(null),
  order: z.number().int().nonnegative().default(0),
  title: name,
  type: z.enum(["event", "jump", "writing"]).default("event"),
  tellings: z.array(tellingSchema).min(1).max(100),
  chapter: id.nullable().default(null).describe("正式章节ID，必须引用chapters[].id（可同批建立）；章节尚未创建时填null。预标第01章等顺序写在卡片title/tags，不得在此填写尚不存在的编号"),
  wordBudget: budget.nullable().default(null).describe("仅已分配正式章节的实际讲述卡可填写；未分章或纯组织父卡必须为null。章节总字数范围在chapters.wordMin/wordBudget设置"),
  narrateSummary: z.boolean().default(false).describe("有子卡时false表示仅组织层级、不进入正文；true表示父卡本身也要作为独立讲述参与正文。必要剧情不能仅写在纯组织父卡内"),
  tags: z.array(z.string().max(100)).max(50).default([]),
  jump: z
    .object({
      kind: z.enum([
        "回忆",
        "预叙",
        "日记 / 史书",
        "穿越 / 虫洞",
        "同一历史回返",
      ]),
      destination: text,
      connection: id.nullable().default(null).describe("仅真实穿越/同一历史回返引用connections[].id，且kind须相同；回忆、预叙、日记/史书属于叙述手法，填null，不引用穿越连接"),
      returnContext: z.boolean().default(true),
    })
    .nullable()
    .default(null),
});
export const volumeSchema = z.object({
  id,
  line: id,
  title: name,
  summary: text.default(""),
  order: z.number().int().nonnegative().default(0),
});
export const chapterSchema = z.object({
  id,
  line: id,
  volume: id.nullable().default(null),
  title: name,
  order: z.number().int().nonnegative().default(0),
  wordMin: z.number().int().min(0).max(200000).default(0),
  wordBudget: budget.default(3000),
});
const endpointSchema = z.object({
  line: id,
  event: id,
  boundary: z.enum(["start", "end"]).default("start"),
});
export const connectionSchema = z.object({
  id,
  title: name,
  kind: z.enum(["穿越 / 虫洞", "同一历史回返"]),
  from: endpointSchema,
  to: endpointSchema,
  characters: z.array(id).max(100).default([]),
  instanceNote: text.default(""),
});
export const planningSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  worlds: z.array(worldlineSchema).max(500).default([]),
  lines: z.array(lineSchema).max(500).default([]),
  events: z.array(eventSchema).max(10000).default([]),
  periods: z.array(periodSchema).max(2000).default([]),
  cards: z.array(cardSchema).max(10000).default([]),
  volumes: z.array(volumeSchema).max(1000).default([]),
  chapters: z.array(chapterSchema).max(10000).default([]),
  connections: z.array(connectionSchema).max(2000).default([]),
});
export type PlanningData = z.infer<typeof planningSchema>;
/** 空规划文档：新小说创建时一并写入，自始接入规划投影。 */
export function emptyPlanning(): PlanningData {
  return planningSchema.parse({});
}
export type PlanningEvent = z.infer<typeof eventSchema>;
export type NarrativeCard = z.infer<typeof cardSchema>;
export type NarrativeTelling = z.infer<typeof tellingSchema>;
export type PlanningChapter = z.infer<typeof chapterSchema>;
export type Collection =
  | "worlds"
  | "lines"
  | "events"
  | "periods"
  | "cards"
  | "volumes"
  | "chapters"
  | "connections";
export const collections = [
  "worlds",
  "lines",
  "events",
  "periods",
  "cards",
  "volumes",
  "chapters",
  "connections",
] as const;
export const operationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("put"),
    collection: z.enum(collections),
    value: z.record(z.string(), z.unknown()),
  }),
  z.object({ kind: z.literal("delete"), collection: z.enum(collections), id }),
  z.object({
    kind: z.literal("group"),
    ids: z.array(id).min(2).max(1000),
    id,
    title: name,
  }),
  z.object({
    kind: z.literal("move"),
    id,
    line: id,
    parent: id.nullable(),
    before: id.nullable().default(null),
  }),
  z.object({
    kind: z.literal("copy"),
    id,
    newId: id,
    line: id,
    parent: id.nullable(),
  }),
  z.object({ kind: z.literal("fork"), id, source: id, event: id, name }),
]);
export type PlanningOperation = z.infer<typeof operationSchema>;
export class PlanningError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
function check(
  condition: unknown,
  message: string,
  code = "PLANNING_INVALID",
): asserts condition {
  if (!condition) throw new PlanningError(code, message);
}
export function worldEvents(data: PlanningData, line: string): PlanningEvent[] {
  return [
    ...(data.worlds.find((w) => w.id === line)?.fork?.events ?? []),
    ...data.events.filter((e) => e.line === line),
  ];
}
export function findEvent(data: PlanningData, line: string, event: string) {
  return worldEvents(data, line).find((e) => e.id === event);
}
export function resolveTime(
  data: PlanningData,
  event: PlanningEvent,
  path: string[] = [],
): { start: number | null; end: number | null; windowEnd: number | null } {
  check(!path.includes(event.id), `时间依赖形成环：${event.title}`);
  let offset = 0;
  if (event.time.anchor) {
    const anchor = findEvent(data, event.line, event.time.anchor);
    check(anchor, `事件“${event.title}”的时间参考已不存在`);
    const resolved = resolveTime(data, anchor, [...path, event.id]),
      point = event.time.boundary === "start" ? resolved.start : resolved.end;
    // A window bounds an uncertain instant; its lower edge is not an exact anchor.
    if (point === null || resolved.windowEnd !== null)
      return { start: null, end: null, windowEnd: null };
    offset = point;
  }
  if (event.time.kind === "unknown")
    return { start: null, end: null, windowEnd: null };
  const start = offset + event.time.value;
  return {
    start,
    end:
      event.time.kind === "exact" && event.duration !== null
        ? start + event.duration
        : null,
    windowEnd:
      event.time.kind === "window"
        ? offset + (event.time.end ?? event.time.value)
        : null,
  };
}
/** Allowed refinement interval is the intersection of every ancestor's known range. */
export function refinementRange(
  data: PlanningData,
  line: string,
  eventId: string | null,
): { start: number; end: number } | null {
  const world = data.worlds.find((w) => w.id === line);
  if (!world || !eventId) return null;
  let start = -Infinity,
    end = Infinity;
  const seen = new Set<string>();
  let current: PlanningEvent | undefined = findEvent(data, line, eventId);
  while (current) {
    check(!seen.has(current.id), "子事件形成循环");
    seen.add(current.id);
    const t = resolveTime(data, current);
    const last =
      current.time.kind === "window"
        ? t.windowEnd
        : current.duration === 0 &&
            world.calendar.kind !== "years" &&
            world.calendar.hoursPerDay !== null &&
            t.start !== null
          ? t.start + world.calendar.hoursPerDay
          : t.end;
    if (t.start !== null) start = Math.max(start, t.start);
    if (last !== null) end = Math.min(end, last);
    current = current.parent
      ? findEvent(data, line, current.parent)
      : undefined;
  }
  return Number.isFinite(start) && Number.isFinite(end) && end > start
    ? { start, end }
    : null;
}
export function children(
  data: PlanningData,
  line: string,
  parent: string | null,
): NarrativeCard[] {
  return data.cards
    .filter((c) => c.line === line && c.parent === parent)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
export function orderedCards(
  data: PlanningData,
  line: string,
  parent: string | null = null,
  seen = new Set<string>(),
): NarrativeCard[] {
  return children(data, line, parent).flatMap((c) => {
    check(!seen.has(c.id), "叙事卡片形成循环");
    check(seen.size < 10000, "叙事结构过大");
    seen.add(c.id);
    return [c, ...orderedCards(data, line, c.id, seen)];
  });
}
export function cardChapter(
  data: PlanningData,
  card: NarrativeCard,
): string | null {
  const seen = new Set<string>();
  let current: NarrativeCard | undefined = card;
  while (current) {
    check(!seen.has(current.id), "叙事卡片形成循环");
    seen.add(current.id);
    if (current.chapter) return current.chapter;
    current = data.cards.find((c) => c.id === current!.parent);
  }
  return null;
}
export function readingCards(
  data: PlanningData,
  line: string,
): NarrativeCard[] {
  return orderedCards(data, line).filter(
    (c) => c.narrateSummary || !children(data, line, c.id).length,
  );
}
export function validatePlanning(input: unknown): PlanningData {
  const data = planningSchema.parse(input),
    ids = new Set<string>();
  for (const collection of collections)
    for (const entity of data[collection]) {
      check(!ids.has(entity.id), `对象ID重复：${entity.id}`);
      ids.add(entity.id);
    }
  check(data.lines.filter((l) => l.primary).length <= 1, "只能有一条主叙事线");
  for (const world of data.worlds)
    if (world.fork) {
      check(
        data.worlds.some((w) => w.id === world.fork!.source),
        "分支来源不存在",
      );
      check(
        world.fork.events.every((e) => e.line === world.id),
        "冻结历史必须属于该分支",
      );
    }
  for (const world of data.worlds) {
    const bases = new Set<string>();
    for (const base of world.timeBases) {
      check(!bases.has(base.id), "时间基准ID重复");
      bases.add(base.id);
      if (base.anchor)
        check(
          findEvent(data, world.id, base.anchor),
          "时间基准引用事件不存在，请先解除引用",
        );
    }
  }
  for (const e of data.events) {
    check(
      data.worlds.some((w) => w.id === e.line),
      `“${e.title}”的世界线不存在`,
    );
    check(
      !data.worlds
        .find((w) => w.id === e.line)
        ?.fork?.events.some((f) => f.id === e.id),
      "不可覆盖冻结前史",
    );
    const resolved = resolveTime(data, e);
    check(!e.ongoing || e.duration === null, "持续中事件不能同时设置结束");
    check(
      e.time.kind !== "window" ||
        (e.time.end !== null && e.time.end >= e.time.value),
      "时间窗口结束不得早于开始",
    );
    let parentId = e.parent;
    const seen = new Set([e.id]);
    while (parentId) {
      check(!seen.has(parentId), "子事件形成循环");
      seen.add(parentId);
      const parent = findEvent(data, e.line, parentId);
      check(parent, "子事件父级不存在或跨世界");
      const bound = resolveTime(data, parent),
        world = data.worlds.find((w) => w.id === e.line)!;
      const end =
        parent.time.kind === "window"
          ? bound.windowEnd
          : parent.duration === 0 &&
              world.calendar.kind !== "years" &&
              bound.start !== null &&
              world.calendar.hoursPerDay !== null
            ? bound.start + world.calendar.hoursPerDay
            : bound.end;
      if (resolved.start !== null) {
        check(
          bound.start !== null && end !== null,
          "父事件范围尚未明确，请先保留为待定位事件",
        );
        check(
          resolved.start >= bound.start &&
            (resolved.end ?? resolved.windowEnd ?? resolved.start) <= end,
          `“${e.title}”超出祖先“${parent.title}”允许范围`,
        );
      }
      parentId = parent.parent;
    }
  }
  for (const p of data.periods) {
    check(
      data.worlds.some((w) => w.id === p.line),
      "时期所属世界线不存在",
    );
    check(p.end === null || p.end > p.start, "时期结束须晚于开始");
    if (p.event) check(findEvent(data, p.line, p.event), "时期关联事件不存在");
  }
  for (const c of data.cards) {
    check(
      data.lines.some((l) => l.id === c.line),
      "卡片所属叙事线不存在",
    );
    let parent = c.parent;
    const seen = new Set([c.id]);
    while (parent) {
      check(!seen.has(parent), "叙事卡片不能移入自身或后代");
      seen.add(parent);
      const p = data.cards.find((n) => n.id === parent);
      check(p && p.line === c.line, "父卡片不存在或不属于同一叙事线");
      parent = p.parent;
    }
    if (c.chapter)
      check(
        data.chapters.some((ch) => ch.id === c.chapter && ch.line === c.line),
        "章节不存在或不属于本叙事线",
      );
    check(
      new Set(c.tellings.map((t) => t.id)).size === c.tellings.length,
      "视角ID重复",
    );
    for (const t of c.tellings)
      for (const r of t.refs)
        check(
          findEvent(data, r.line, r.event),
          `“${c.title}”引用的事件不存在，请先处理引用`,
        );
    for (const t of c.tellings) for (const ref of t.materialRefs.filter(r => r.role === "plant"))
      check(t.refs.some(r => findEvent(data, r.line, r.event)?.materialRefs.some(source => source.kind === "foreshadow" && source.id === ref.id && source.role === "plant")), `“${c.title}”的首次埋入伏笔未关联同一讲述引用的世界事件`);
    if (c.jump && ["穿越 / 虫洞", "同一历史回返"].includes(c.jump.kind))
      check(c.jump.connection, "真实穿越须选择离开与抵达的连接");
    if (c.jump?.connection)
      check(
        data.connections.some(
          (v) => v.id === c.jump!.connection && v.kind === c.jump!.kind,
        ),
        `“${c.title}”的跳转连接不存在或类型不同；回忆/预叙/日记应填connection:null，真实穿越/回返须引用同kind连接`,
      );
    if (c.wordBudget !== null)
      check(
        cardChapter(data, c) &&
          (!children(data, c.line, c.id).length || c.narrateSummary),
        "只有已分章的实际讲述可以分配字数",
      );
  }
  for (const v of data.volumes)
    check(
      data.lines.some((l) => l.id === v.line),
      "卷所属叙事线不存在",
    );
  for (const ch of data.chapters) {
    check(
      ch.wordMin <= ch.wordBudget,
      `“${ch.title}”字数下限不能超过上限`,
      "BUDGET_RANGE_INVALID",
    );
    check(
      data.lines.some((l) => l.id === ch.line),
      "章所属叙事线不存在",
    );
    if (ch.volume)
      check(
        data.volumes.some((v) => v.id === ch.volume && v.line === ch.line),
        "章所属卷不存在或跨叙事线",
      );
    const cards = readingCards(data, ch.line).filter(
        (c) => cardChapter(data, c) === ch.id,
      ),
      sum = cards.reduce((n, c) => n + (c.wordBudget ?? 0), 0);
    check(
      sum <= ch.wordBudget,
      `“${ch.title}”卡片已分配${sum}字，超过本章${ch.wordBudget}字上限`,
      "BUDGET_EXCEEDED",
    );
    check(
      !cards.length ||
        cards.some((c) => c.wordBudget === null) ||
        sum >= ch.wordMin,
      `“${ch.title}”卡片字数上限合计${sum}字，无法达到本章${ch.wordMin}字下限，请增加预算或保留AI分配卡片`,
      "BUDGET_RANGE_INVALID",
    );
    check(
      !cards.some((c) => c.wordBudget === null) || sum < ch.wordBudget,
      `“${ch.title}”需为未分配卡片保留字数余量`,
      "BUDGET_EXCEEDED",
    );
  }
  for (const c of data.connections)
    for (const end of [c.from, c.to]) {
      const e = findEvent(data, end.line, end.event);
      check(e, "跨世界连接端点事件不存在");
      check(
        resolveTime(data, e)[end.boundary] !== null,
        "跨世界连接端点必须有明确时间",
      );
    }
  return data;
}
export function chapterProjection(data: PlanningData, chapterId: string) {
  const chapter = data.chapters.find((c) => c.id === chapterId);
  check(chapter, "章节规划不存在");
  const cards = readingCards(data, chapter.line).filter(
    (c) => cardChapter(data, c) === chapterId,
  );
  const outline = cards
    .map(
      (c) =>
        `## ${c.title}${c.wordBudget ? `（最多${c.wordBudget}字）` : "（AI分配字数）"}\n${c.tellings.map((t) => `### ${t.narrator} · ${t.reliability}\n${t.intent}\n${t.beats.length ? `段落节拍（按序展开，每拍一段）：\n${t.beats.map((b, i) => `${i + 1}. [${b.type}] ${b.summary}`).join("\n")}\n` : ""}${t.refs.map((r) => `披露：${r.reveal}\n暂不披露（禁止写进本段正文）：${r.withheld.trim() || "无"}`).join("\n\n")}`).join("\n")}\n${c.jump ? `叙述跳转：${c.jump.kind} / ${c.jump.destination}${c.jump.returnContext ? "；结束后返回原叙述" : ""}` : ""}`,
    )
    .join("\n\n");
  return {
    chapter,
    cards,
    allCards: orderedCards(data, chapter.line).filter(
      (c) => cardChapter(data, c) === chapterId,
    ),
    outline: `本章字数范围：${chapter.wordMin}—${chapter.wordBudget} 字（上限不可超过${chapter.wordBudget}字）。\n\n${outline}${cards.some(c => c.tellings.some(t => t.materialRefs.length)) ? `\n\n本章资料用途（伏笔只写本次线索，不自行揭晓档案真相）：\n${cards.flatMap(c => c.tellings.flatMap(t => t.materialRefs.map(r => `${c.title} / ${t.narrator} · ${MATERIAL_LABELS[r.kind]} · ${MATERIAL_ROLE_LABELS[r.role]}：${r.note}`))).join("\n")}` : ""}`,
    allocated: cards.reduce((n, c) => n + (c.wordBudget ?? 0), 0),
  };
}
export function applyPlanningOperations(
  input: PlanningData,
  raw: unknown,
  version = 0,
): PlanningData {
  const ops = z.array(operationSchema).min(1).max(200).parse(raw),
    data = structuredClone(input);
  for (const op of ops) {
    if (op.kind === "put") {
      const list = data[op.collection] as { id: string }[],
        entity = op.value;
      check(typeof entity.id === "string", "缺少对象ID");
      const at = list.findIndex((v) => v.id === entity.id);
      if (op.collection === "worlds" && "fork" in entity)
        check(
          JSON.stringify(
            at < 0 ? null : (list[at] as PlanningData["worlds"][number]).fork,
          ) === JSON.stringify(entity.fork),
          "冻结前史不可改写",
        );
      const schemas = {
        worlds: worldlineSchema,
        lines: lineSchema,
        events: eventSchema,
        periods: periodSchema,
        cards: cardSchema,
        volumes: volumeSchema,
        chapters: chapterSchema,
        connections: connectionSchema,
      };
      const parsed = schemas[op.collection].parse(
        at < 0 ? entity : { ...list[at], ...entity },
      );
      if (at < 0) list.push(parsed);
      else list[at] = parsed;
    } else if (op.kind === "delete") {
      const list = data[op.collection] as { id: string }[],
        at = list.findIndex((v) => v.id === op.id);
      check(at >= 0, "对象不存在");
      list.splice(at, 1);
    } else if (op.kind === "group") {
      check(new Set(op.ids).size === op.ids.length, "不能重复选择同一卡片");
      const first = data.cards.find((c) => c.id === op.ids[0]);
      check(first, "所选卡片不存在");
      const siblings = children(data, first.line, first.parent),
        chosen = siblings.filter((c) => op.ids.includes(c.id));
      check(chosen.length === op.ids.length, "组合仅限同一叙事线同一父层级");
      const group = cardSchema.parse({
        id: op.id,
        line: first.line,
        parent: first.parent,
        title: op.title,
        tellings: [{ id: `${op.id}-pov` }],
      });
      const next = siblings.flatMap((c) =>
        c.id === chosen[0].id ? [group] : op.ids.includes(c.id) ? [] : [c],
      );
      next.forEach((c, i) => (c.order = i));
      chosen.forEach((c, i) => {
        c.parent = group.id;
        c.order = i;
      });
      data.cards.push(group);
    } else if (op.kind === "move") {
      const c = data.cards.find((v) => v.id === op.id);
      check(c, "卡片不存在");
      const descendants = orderedCards(data, c.line, c.id);
      check(
        ![c.id, ...descendants.map((d) => d.id)].includes(op.parent ?? ""),
        "不能移入自身或后代",
      );
      const siblings = children(data, op.line, op.parent).filter(
          (n) => n.id !== c.id,
        ),
        index = op.before
          ? siblings.findIndex((n) => n.id === op.before)
          : siblings.length;
      check(index >= 0, "目标位置不存在");
      for (const n of [c, ...descendants]) {
        if (n.line !== op.line) {
          n.chapter = null;
          n.wordBudget = null;
        }
        n.line = op.line;
      }
      c.parent = op.parent;
      siblings.splice(index, 0, c);
      siblings.forEach((n, i) => (n.order = i));
    } else if (op.kind === "copy") {
      const c = data.cards.find((v) => v.id === op.id);
      check(c, "卡片不存在");
      const all = [c, ...orderedCards(data, c.line, c.id)],
        ids = new Map(
          all.map((n, i) => [n.id, i ? `${op.newId}-${i}` : op.newId]),
        );
      for (const n of all) {
        const clone = structuredClone(n);
        clone.id = ids.get(n.id)!;
        clone.line = op.line;
        clone.parent = n.id === c.id ? op.parent : ids.get(n.parent!)!;
        clone.order =
          n.id === c.id ? children(data, op.line, op.parent).length : n.order;
        if (n.line !== op.line) {
          clone.chapter = null;
          clone.wordBudget = null;
        }
        data.cards.push(clone);
      }
    } else if (op.kind === "fork") {
      const source = data.worlds.find((w) => w.id === op.source),
        event = findEvent(data, op.source, op.event);
      check(source && event, "分叉来源不存在");
      const boundary = resolveTime(data, event).end;
      check(boundary !== null, "分叉须有明确结束边界");
      check(
        worldEvents(data, source.id).every((e) => {
          const t = resolveTime(data, e);
          return (
            t.start === null ||
            t.start >= boundary ||
            (t.end !== null && t.end <= boundary)
          );
        }),
        "存在跨越分叉边界或结束未定的事件，请先明确处理范围",
      );
      const prior = worldEvents(data, source.id).filter((e) => {
        const t = resolveTime(data, e);
        return t.start !== null && t.end !== null && t.end <= boundary;
      });
      check(
        prior.some((e) => e.id === event.id) &&
          prior.every((e) => !e.parent || prior.some((p) => p.id === e.parent)),
        "分叉前史存在跨边界祖先，请先调整结构",
      );
      const frozen = prior.map((e) => {
        const t = resolveTime(data, e);
        return {
          ...structuredClone(e),
          line: op.id,
          time: { ...e.time, value: t.start!, anchor: null },
        };
      });
      data.worlds.push(
        worldlineSchema.parse({
          id: op.id,
          name: op.name,
          calendar: source.calendar,
          timeBases: source.timeBases.filter(
            (b) => !b.anchor || prior.some((e) => e.id === b.anchor),
          ),
          fork: {
            source: source.id,
            event: event.id,
            version,
            events: frozen,
            periods: [
              ...(source.fork?.periods ?? []),
              ...data.periods.filter((p) => p.line === source.id),
            ]
              .map((p) => {
                const event = p.event
                  ? findEvent(data, source.id, p.event)
                  : null;
                const range = event
                  ? resolveTime(data, event)
                  : { start: p.start, end: p.end };
                return {
                  ...p,
                  line: op.id,
                  start: range.start ?? boundary,
                  end: Math.min(range.end ?? boundary, boundary),
                  event: null,
                  ongoing: false,
                };
              })
              .filter((p) => p.end > p.start),
            calendar: source.calendar,
          },
        }),
      );
    }
  }
  return validatePlanning(data);
}

/** A restore creates a revision, but undo continues from the restored state instead of undoing the undo. */
export function planningUndoTarget<
  T extends { version: number; reason: string },
>(history: T[], currentVersion: number): T | undefined {
  let cursor = currentVersion;
  const seen = new Set<number>();
  while (!seen.has(cursor)) {
    seen.add(cursor);
    const current = history.find((h) => h.version === cursor);
    const restored = current?.reason.match(/^恢复规划版本：(\d+)$/);
    if (!restored) return history.find((h) => h.version === cursor - 1);
    cursor = Number(restored[1]);
  }
  return undefined;
}
