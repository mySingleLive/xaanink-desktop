"use client";
import {
  characterStatesAt,
  constrainWindow,
  formatTime,
  timeUnit,
  timeBaseValue,
  zoomAt,
  layoutTimelineCards,
  timelineTicks,
  fitTimelineWindow,
  snapTimelineDelta,
} from "@/lib/planning/timeline";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type CSSProperties,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useChatStore } from "@/stores/chat";
import {
  CHAT_FOCUS_COMPOSER_EVENT,
  dispatchChatUiEvent,
} from "@/components/chat/ui-events";
import { Slider } from "@base-ui/react/slider";
import { BookOpen, ChevronRight, MoreHorizontal } from "lucide-react";
import { MarkdownEditor } from "@/components/editor/MarkdownEditor";
import { ReviewHistory } from "../ReviewHistory";
import { MarkdownPreview } from "@/components/editor/MarkdownPreview";
import { ScoreIndicator } from "@/components/score/ScoreIndicator";
import { buildTabId, useTabsStore } from "@/stores/tabs";
import {
  cardSchema,
  cardChapter,
  chapterProjection,
  children,
  eventSchema,
  findEvent,
  planningSchema,
  planningUndoTarget,
  readingCards,
  resolveTime,
  refinementRange,
  tellingSchema,
  worldEvents,
  type Collection,
  type NarrativeCard,
  type PlanningData,
  type PlanningEvent,
  type PlanningOperation,
} from "@/lib/planning/domain";
import type { ContentPanelProps } from "../registry";
import s from "./planning.module.css";
import { materialRefSchema, MATERIAL_LABELS, MATERIAL_ROLE_LABELS, type MaterialRef } from "@/lib/material-reference";

function MeasuredEvent({
  id,
  className,
  style,
  children,
  onHeight,
}: {
  id: string;
  className: string;
  style: CSSProperties;
  children: ReactNode;
  onHeight: (id: string, height: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(onHeight);
  useEffect(() => {
    callback.current = onHeight;
  }, [onHeight]);
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const observer = new ResizeObserver(() =>
      callback.current(id, Math.ceil(el.getBoundingClientRect().height)),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [id]);
  return (
    <div ref={ref} data-event={id} className={className} style={style}>
      {children}
    </div>
  );
}

type View = {
  version: number;
  data: PlanningData;
  characters: { id: string; name: string; avatarUrl: string | null }[];
  materials: { kind: MaterialRef["kind"]; id: string; title: string }[];
  readonly: boolean;
  history: { id: string; version: number; reason: string }[];
  proposals: { id: string; reason: string; snapshot: unknown }[];
};
async function read(novelId: string): Promise<View> {
  const r = await fetch(`/api/novels/${novelId}/planning`);
  const body = await r.json();
  if (!r.ok) throw Error(body.error);
  return { ...body, data: planningSchema.parse(body.data) };
}
const uid = () => crypto.randomUUID();
const buttonTarget = (target: EventTarget | null) =>
  target instanceof Element &&
  !!target.closest(
    "button,input,select,textarea,summary,a,label,.monaco-editor",
  );
export function WorldlinePanel(props: ContentPanelProps) {
  return <PlanningWorkspace {...props} mode="world" />;
}
export function NarrativePanel(props: ContentPanelProps) {
  return <PlanningWorkspace {...props} mode="narrative" />;
}
export function OutlineProjectionPanel(props: ContentPanelProps) {
  return <PlanningWorkspace {...props} mode="projection" />;
}
function PlanningWorkspace({
  novelId,
  refId,
  mode,
}: {
  novelId: string;
  refId?: string;
  mode: "world" | "narrative" | "projection";
}) {
  const focusRequest = useTabsStore((v) => v.panelFocus),
    consumeFocus = useTabsStore((v) => v.consumePanelFocus);
  const qc = useQueryClient(),
    storeOpenTab = useTabsStore((v) => v.openTab),
    query = useQuery({
      queryKey: ["planning", novelId],
      queryFn: () => read(novelId),
    });
  const [line, setLine] = useState(""),
    [world, setWorld] = useState(""),
    [parent, setParent] = useState<string | null>(null),
    [eventParent, setEventParent] = useState<string | null>(null),
    [view, setView] = useState(refId ? "chapters" : "cards"),
    [selected, setSelected] = useState<string[]>([]),
    [draft, setDraft] = useState<NarrativeCard | null>(null),
    [eventDraft, setEventDraft] = useState<PlanningEvent | null>(null),
    [activePov, setActivePov] = useState<Record<string, string>>({}),
    [closed, setClosed] = useState<string[]>([]),
    [expandedChapters, setExpandedChapters] = useState<string[]>([]),
    [dialog, setDialog] = useState<{
      kind: string;
      id?: string;
      before?: string | null;
      volume?: string;
      rangeDraft?: { start: number; end: number | null };
    } | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [endTimeMode, setEndTimeMode] = useState(false),
    [startUnit, setStartUnit] = useState(1),
    [durationUnit, setDurationUnit] = useState(1),
    [eventSelection, setEventSelection] = useState<string | null>(null),
    [timelineWidth, setTimelineWidth] = useState(800),
    [eventHeights, setEventHeights] = useState<Record<string, number>>({}),
    [worldPopover, setWorldPopover] = useState<
      "periods" | "pending" | "continuing" | null
    >(null),
    [table, setTable] = useState(false),
    [periods, setPeriods] = useState(true),
    [timeBase, setTimeBase] = useState(""),
    [mappingEdit, setMappingEdit] = useState(""),
    [changes, setChanges] = useState(true),
    [windowRange, setWindowRange] = useState({ start: 0, span: 240, y: 0 }),
    [dragId, setDragId] = useState<string | null>(null);
  const editor = useRef<HTMLDivElement>(null),
    timeline = useRef<HTMLDivElement>(null),
    pan = useRef<{ x: number; y: number; start: number; top: number } | null>(
      null,
    ),
    pointerInside = useRef(false),
    pointerSort = useRef<{
      id: string;
      x: number;
      y: number;
      moved: boolean;
      before: string | null | undefined;
    } | null>(null),
    suppressPeriodClick = useRef(false),
    newBefore = useRef<string | null>(null),
    initialFocusHandled = useRef<string | null>(null),
    worldBases = useRef(new Map<string, string>()),
    worldViews = useRef(
      new Map<string, { start: number; span: number; y: number }>(),
    );
  const data = query.data?.data ?? planningSchema.parse({}),
    readonly = query.data?.readonly || busy,
    activeLine =
      data.lines.find((l) => l.id === line) ||
      data.lines.find((l) => l.primary) ||
      data.lines[0],
    activeWorld = data.worlds.find((w) => w.id === world) || data.worlds[0];
  const lineId = activeLine?.id ?? "",
    worldId = activeWorld?.id ?? "",
    siblings = children(data, lineId, parent);
  const narrativePath: NarrativeCard[] = [];
  let ancestor = data.cards.find((c) => c.id === parent && c.line === lineId);
  while (ancestor && !narrativePath.some((c) => c.id === ancestor?.id)) {
    narrativePath.unshift(ancestor);
    const parentId = ancestor.parent;
    ancestor = data.cards.find((c) => c.id === parentId && c.line === lineId);
  }
  const bounds = refinementRange(data, worldId, eventParent),
    boundStart = bounds?.start,
    boundEnd = bounds?.end;
  useEffect(() => {
    const bound =
      boundStart !== undefined && boundEnd !== undefined
        ? { start: boundStart, end: boundEnd }
        : null;
    setWindowRange((v) => constrainWindow(v, bound));
  }, [boundStart, boundEnd, windowRange.start, windowRange.span]);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      pointerInside.current = !!editor.current?.contains(e.target as Node);
    };
    const click = (e: MouseEvent) => {
      if ((e.target as Element).closest?.('[role="dialog"]')) return;
      if (
        !pointerInside.current &&
        !editor.current?.contains(e.target as Node)
      ) {
        setDraft(null);
        // World events keep their draft while the canvas is inspected.
      }
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("click", click, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("click", click, true);
    };
  }, []);
  useEffect(() => {
    const tabId = buildTabId(
      mode === "world"
        ? "worldline"
        : mode === "narrative"
          ? "narrative"
          : "outline",
      novelId,
    );
    const target =
      focusRequest?.tabId === tabId ? focusRequest.settingId : refId;
    if (!target || !query.data) return;
    if (focusRequest?.tabId !== tabId && initialFocusHandled.current === refId)
      return;
    setMessage("");
    initialFocusHandled.current = refId ?? null;
    const d = query.data.data,
      card = d.cards.find((c) => c.id === target),
      chapter = d.chapters.find((c) => c.id === target);
    if (mode === "world") {
      const w = d.worlds.find(
        (w) =>
          w.id === target ||
          worldEvents(d, w.id).some(
            (e) => e.id === target || `${w.id}/${e.id}` === target,
          ),
      );
      if (w) {
        setWorld(w.id);
        const e = worldEvents(d, w.id).find(
          (e) => e.id === target || `${w.id}/${e.id}` === target,
        );
        if (e) {
          setEventParent(e.parent);
          const time = resolveTime(d, e);
          if (time.start !== null)
            setWindowRange((v) => ({ ...v, start: time.start! - 12, y: 0 }));
          setTable(true);
        }
      }
    } else if (card) {
      setLine(card.line);
      setParent(card.parent);
      setSelected([card.id]);
      setView("cards");
      if (focusRequest?.concept)
        setActivePov((v) => ({ ...v, [card.id]: focusRequest.concept! }));
    } else if (chapter) {
      setLine(chapter.line);
      setView("chapters");
    } else if (target === "chapters") setView("chapters");
    else if (d.lines.some((l) => l.id === target)) {
      setLine(target);
      setParent(null);
    }
    if (focusRequest?.tabId === tabId) consumeFocus(tabId);
  }, [refId, focusRequest, query.data, mode, novelId, consumeFocus]);
  useEffect(() => {
    const el = timeline.current;
    if (!el) return;
    const resize = new ResizeObserver(() => setTimelineWidth(el.clientWidth));
    resize.observe(el);
    const wheel = (e: WheelEvent) => {
      if ((e.target as Element).closest("input,textarea,.monaco-editor"))
        return;
      if (e.ctrlKey) {
        e.preventDefault();
        const ratio =
          (e.clientX - el.getBoundingClientRect().left - 14) /
          Math.max(1, el.clientWidth - 28);
        setWindowRange((v) => ({
          ...v,
          ...zoomAt(v.start, v.span, e.deltaY > 0 ? 1.2 : 1 / 1.2, ratio),
        }));
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        setWindowRange((v) => ({
          ...v,
          start:
            v.start +
            ((e.shiftKey ? e.deltaY : e.deltaX) /
              Math.max(1, el.clientWidth - 28)) *
              v.span,
        }));
      }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      resize.disconnect();
      el.removeEventListener("wheel", wheel);
    };
  }, [mode, table, worldId, query.isPending]);
  useEffect(() => {
    if (!dialog) return;
    const prior = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('[role="dialog"] button')?.focus(),
    );
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setDialog(null);
      }
      if (e.key === "Tab") {
        const nodes = [
          ...document.querySelectorAll<HTMLElement>(
            '[role="dialog"] button:not(:disabled),[role="dialog"] input:not(:disabled),[role="dialog"] select:not(:disabled),[role="dialog"] textarea:not(:disabled),[role="dialog"] a',
          ),
        ];
        if (!nodes.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", key);
      if (prior?.isConnected) prior.focus();
    };
  }, [dialog]);
  const fittedViews = useRef(new Set<string>());
  useEffect(() => {
    if (mode !== "world" || !query.data || !worldId) return;
    const key = `${worldId}/${eventParent ?? "root"}`;
    if (fittedViews.current.has(key)) return;
    fittedViews.current.add(key);
    if (eventParent) return;
    const times = worldEvents(query.data.data, worldId)
      .filter((e) => e.parent === null)
      .map((e) => resolveTime(query.data.data, e))
      .filter((t) => t.start !== null);
    setWindowRange({
      ...fitTimelineWindow(
        times.map((t) => ({ start: t.start!, end: t.end })),
        Math.max(1, (timeline.current?.clientWidth ?? 800) - 28),
      ),
      y: 0,
    });
  }, [mode, worldId, eventParent, query.data]);
  useEffect(() => {
    setEndTimeMode(false);
    setStartUnit(1);
    setDurationUnit(1);
  }, [eventDraft?.id]);
  function worldTimeLabel(value: number, span = windowRange.span) {
    const base = activeWorld?.timeBases.find((b) => b.id === timeBase);
    if (!activeWorld) return "";
    const converted = base ? timeBaseValue(data, worldId, base, value) : value;
    return converted === null
      ? "未映射"
      : formatTime(
          converted,
          base?.calendar ?? activeWorld.calendar,
          span * (base?.scale ?? 1),
        );
  }
  function openTab(tab: Parameters<typeof storeOpenTab>[0]) {
    storeOpenTab(tab);
    if (tab.refId && ["worldline", "narrative"].includes(tab.type))
      useTabsStore.getState().requestPanelFocus(tab.id, tab.refId);
  }
  async function reviewChapter(id: string) {
    setBusy(true);
    setMessage("正在评审章纲…");
    try {
      const res = await fetch(`/api/novels/${novelId}/review/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: "CHAPTER_OUTLINE", targetId: id }),
      });
      const result = await res.json();
      if (!res.ok) throw Error(result.error || "评审失败");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["reviews", novelId] }),
        qc.invalidateQueries({
          queryKey: ["score-report", "CHAPTER_OUTLINE", id],
        }),
        qc.invalidateQueries({ queryKey: ["chapter", id] }),
      ]);
      setMessage("章纲评审已完成");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(
    operations: PlanningOperation[],
    extra?: Record<string, unknown>,
  ) {
    if (busy) return false;
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch(`/api/novels/${novelId}/planning`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedVersion: query.data?.version ?? 0,
            operationId: uid(),
            operations,
            ...extra,
          }),
        }),
        result = await r.json();
      if (!r.ok) throw Error(result.error);
      qc.setQueryData(["planning", novelId], { ...query.data, ...result });
      await Promise.all(
        [
          ["planning", novelId],
          ["outline", novelId],
          ["novels"],
          ["chapter"],
          ["story-workflow", novelId],
          ["story-sources", novelId],
        ].map((queryKey) => qc.invalidateQueries({ queryKey })),
      );
      setMessage("已保存");
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "保存失败，输入已保留",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  function put(collection: Collection, value: Record<string, unknown>) {
    return save([{ kind: "put", collection, value }]);
  }
  function selectCard(card: NarrativeCard, shift = false, tree = false) {
    if (
      shift &&
      selected.some((id) => {
        const n = data.cards.find((v) => v.id === id);
        return n?.line !== card.line || n.parent !== card.parent;
      })
    ) {
      setMessage("多选仅限同一叙事线、同一父层级");
      return;
    }
    setSelected((v) =>
      shift
        ? v.includes(card.id)
          ? v.filter((id) => id !== card.id)
          : [...v, card.id]
        : [card.id],
    );
    if (tree) {
      setLine(card.line);
      setParent(card.parent);
      setView("cards");
    }
  }
  function addCard(before: string | null = null) {
    if (!lineId) return;
    newBefore.current = before;
    setDraft(
      cardSchema.parse({
        id: uid(),
        line: lineId,
        parent,
        title: "未命名构思",
        order: siblings.length,
        tellings: [{ id: uid() }],
      }),
    );
  }
  function materialNotes(refs: MaterialRef[]) {
    return refs.length ? <div className={s.notice} aria-label="关联创作资料">{refs.map((ref, i) => <p key={`${ref.kind}:${ref.id}:${i}`}>{MATERIAL_LABELS[ref.kind]}「{query.data?.materials?.find(m => m.kind === ref.kind && m.id === ref.id)?.title ?? "资料已失效"}」· {MATERIAL_ROLE_LABELS[ref.role]}：{ref.note}</p>)}</div> : null;
  }
  function chip(character: string | null, narrator = "待定") {
    const person = query.data?.characters.find((c) => c.id === character);
    return (
      <>
        <span className={s.avatar}>
          {person?.avatarUrl ? (
            <img src={person.avatarUrl} alt="" />
          ) : (
            person?.name.slice(0, 1) || "◌"
          )}
        </span>
        {person?.name || narrator}
      </>
    );
  }
  function treeNodes(p: string | null, l: string): React.ReactNode {
    return (
      <ul>
        {children(data, l, p).map((c) => (
          <li key={c.id}>
            <div className={s.row}>
              <button
                aria-label={`${closed.includes(c.id) ? "展开" : "折叠"}${c.title}`}
                onClick={() =>
                  setClosed((v) =>
                    v.includes(c.id)
                      ? v.filter((id) => id !== c.id)
                      : [...v, c.id],
                  )
                }
              >
                {children(data, l, c.id).length
                  ? closed.includes(c.id)
                    ? "›"
                    : "⌄"
                  : "·"}
              </button>
              <button
                className={selected.includes(c.id) ? s.selected : ""}
                aria-pressed={selected.includes(c.id)}
                onClick={(e) => selectCard(c, e.shiftKey, true)}
              >
                {c.title}
                {selected.includes(c.id) ? " ✓" : ""}
              </button>
            </div>
            {!closed.includes(c.id) && treeNodes(c.id, l)}
          </li>
        ))}
      </ul>
    );
  }
  function eventRefs(c: NarrativeCard) {
    const telling =
      c.tellings.find((t) => t.id === activePov[c.id]) || c.tellings[0];
    return (
      <div className={s.refs}>
        {telling.refs.map((r, i) => (
          <button
            key={i}
            onClick={() =>
              openTab({
                id: buildTabId("worldline", novelId),
                type: "worldline",
                novelId,
                refId: r.event,
                title: "世界线",
              })
            }
          >
            ◈ {data.worlds.find((w) => w.id === r.line)?.name} ·{" "}
            {findEvent(data, r.line, r.event)?.title}
          </button>
        ))}
      </div>
    );
  }
  function quotePlanning(
    title: string,
    id: string,
    kind: "世界事件" | "叙事卡片",
  ) {
    const current = useChatStore.getState().draft;
    const quote = `【${kind}：${title}；ID=${id}；作品=${novelId}】请通过 getNovelPlanning 读取当前资料。`;
    useChatStore.setState({
      draftNovelId: novelId,
      draft: current.trim() ? `${current.trimEnd()}\n${quote}` : quote,
    });
    dispatchChatUiEvent(CHAT_FOCUS_COMPOSER_EVENT);
    setMessage("已引用到对话输入框");
  }
  function renderCard(c: NarrativeCard, index: number) {
    const telling =
      c.tellings.find((t) => t.id === activePov[c.id]) || c.tellings[0];
    return (
      <article
        key={c.id}
        data-planning-card={c.id}
        className={`${s.card} ${selected.includes(c.id) ? s.selected : ""} ${dragId === c.id ? s.dragging : ""}`}
        tabIndex={0}
        aria-label={c.title}
        draggable={!readonly && !draft}
        onDragStart={(e) => {
          if (buttonTarget(e.target)) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.setData("text/plain", c.id);
          e.dataTransfer.effectAllowed = "move";
          setDragId(c.id);
        }}
        onDragEnd={() => setDragId(null)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (dragId && dragId !== c.id)
            void save([
              { kind: "move", id: dragId, line: lineId, parent, before: c.id },
            ]);
          setDragId(null);
        }}
        onClick={(e) => {
          if (!buttonTarget(e.target) && window.getSelection()?.isCollapsed)
            selectCard(c, e.shiftKey);
        }}
        onDoubleClick={(e) => {
          if (!readonly && !buttonTarget(e.target))
            setDraft(structuredClone(c));
        }}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && e.key === " ") {
            e.preventDefault();
            selectCard(c, e.shiftKey);
          }
        }}
      >
        <div className={s.cardHead}>
          <span
            className={s.dragHandle}
            aria-label="拖动调整顺序"
            onPointerDown={(e) => {
              if (readonly || draft) return;
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              pointerSort.current = {
                id: c.id,
                x: e.clientX,
                y: e.clientY,
                moved: false,
                before: undefined,
              };
            }}
            onPointerMove={(e) => {
              const drag = pointerSort.current;
              if (!drag) return;
              drag.moved ||=
                Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6;
              if (!drag.moved) return;
              setDragId(drag.id);
              const target = document
                .elementFromPoint(e.clientX, e.clientY)
                ?.closest<HTMLElement>(
                  "[data-drop-before],[data-planning-card]",
                );
              drag.before = target?.hasAttribute("data-drop-before")
                ? target.dataset.dropBefore || null
                : target?.dataset.planningCard;
            }}
            onPointerUp={() => {
              const drag = pointerSort.current;
              pointerSort.current = null;
              setDragId(null);
              if (
                drag?.moved &&
                drag.before !== undefined &&
                drag.before !== drag.id &&
                !(drag.before === null && siblings.at(-1)?.id === drag.id)
              )
                void save([
                  {
                    kind: "move",
                    id: drag.id,
                    line: lineId,
                    parent,
                    before: drag.before,
                  },
                ]);
            }}
            onPointerCancel={() => {
              pointerSort.current = null;
              setDragId(null);
            }}
          >
            ⠿
          </span>
          <input
            type="checkbox"
            aria-label={`选择${c.title}`}
            checked={selected.includes(c.id)}
            onChange={() => selectCard(c, true)}
          />
          <span>{String(index + 1).padStart(2, "0")}</span>
          <span>
            {
              { event: "事件描述", jump: "时间跳转", writing: "行文叙述" }[
                c.type
              ]
            }
          </span>
          <span>
            {data.chapters.find((ch) => ch.id === cardChapter(data, c))
              ?.title || "未分章"}
          </span>
          <details>
            <summary aria-label={`${c.title}更多操作`}>
              <MoreHorizontal size={18} />
            </summary>
            <div className={s.menu}>
              <button onClick={() => quotePlanning(c.title, c.id, "叙事卡片")}>
                引用到对话
              </button>
              <button
                disabled={readonly}
                onClick={() => setDraft(structuredClone(c))}
              >
                编辑
              </button>
              <button
                onClick={() => {
                  setParent(c.id);
                  setSelected([]);
                }}
              >
                展开子卡片
              </button>
              <button
                disabled={readonly}
                onClick={() =>
                  void save([
                    {
                      kind: "copy",
                      id: c.id,
                      newId: uid(),
                      line: lineId,
                      parent,
                    },
                  ])
                }
              >
                复制
              </button>
              <button
                disabled={readonly}
                onClick={() => setDialog({ kind: "move", id: c.id })}
              >
                移动 / 调整层级
              </button>
              <button
                disabled={readonly}
                onClick={() => setDialog({ kind: "delete-card", id: c.id })}
              >
                删除 / 取消分组
              </button>
            </div>
          </details>
        </div>
        <h3>{c.title}</h3>
        <div className={s.pills}>
          {c.tellings.map((t) => (
            <button
              className={s.pill}
              aria-pressed={t.id === telling.id}
              key={t.id}
              onClick={() => setActivePov((v) => ({ ...v, [c.id]: t.id }))}
            >
              {chip(t.character, t.narrator)}
            </button>
          ))}
        </div>
        <p>{telling.intent}</p>
        {materialNotes(telling.materialRefs)}
        {c.jump && (
          <div className={s.notice}>
            ↪ {c.jump.kind} · {c.jump.destination}
            {c.jump.returnContext ? " · 结束后返回原叙述" : ""}
          </div>
        )}
        {eventRefs(c)}
        <div className={s.row}>
          <small className={s.muted}>{telling.reliability}</small>
          <button
            onClick={() => {
              setParent(c.id);
              setSelected([]);
            }}
          >
            {children(data, c.line, c.id).length
              ? `展开 ${children(data, c.line, c.id).length} 张子卡片`
              : "＋ 向下细化"}
          </button>
        </div>
        <details>
          <summary>本次披露与事实参照</summary>
          {telling.refs.map((r, i) => (
            <div key={i}>
              <p>披露：{r.reveal}</p>
              <p className={s.muted}>暂不披露：{r.withheld}</p>
              <details>
                <summary>作者事实</summary>
                <p>{findEvent(data, r.line, r.event)?.fact}</p>
              </details>
            </div>
          ))}
        </details>
      </article>
    );
  }
  async function submitCard() {
    if (!draft) return;
    const existing = data.cards.some((c) => c.id === draft.id),
      ops: PlanningOperation[] = [
        { kind: "put", collection: "cards", value: draft },
      ];
    if (!existing && newBefore.current)
      ops.push({
        kind: "move",
        id: draft.id,
        line: draft.line,
        parent: draft.parent,
        before: newBefore.current,
      });
    if (await save(ops)) setDraft(null);
  }
  function cardEditor() {
    if (!draft) return null;
    const index = Math.max(
        0,
        draft.tellings.findIndex((t) => t.id === activePov[draft.id]),
      ),
      t = draft.tellings[index],
      update = (patch: Partial<typeof t>) =>
        setDraft({
          ...draft,
          tellings: draft.tellings.map((v, i) =>
            i === index ? { ...v, ...patch } : v,
          ),
        });
    return (
      <div
        ref={editor}
        className={`${s.card} ${s.editing} ${s.editor}`}
        data-planning-editor="narrative"
      >
        <div className={s.row}>
          <select
            aria-label="卡片类型"
            value={draft.type}
            onChange={(e) =>
              setDraft({
                ...draft,
                type: e.target.value as NarrativeCard["type"],
              })
            }
          >
            <option value="event">事件描述</option>
            <option value="jump">时间跳转</option>
            <option value="writing">行文叙述</option>
          </select>
          <small>编辑中</small>
        </div>
        <input
          aria-label="卡片标题"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
        <div className={s.pills}>
          {draft.tellings.map((v) => (
            <button
              key={v.id}
              className={s.pill}
              aria-pressed={t.id === v.id}
              onClick={() => setActivePov((p) => ({ ...p, [draft.id]: v.id }))}
            >
              {chip(v.character, v.narrator)}
            </button>
          ))}
          <button
            onClick={() => {
              const v = tellingSchema.parse({ id: uid() });
              setDraft({ ...draft, tellings: [...draft.tellings, v] });
              setActivePov((p) => ({ ...p, [draft.id]: v.id }));
            }}
          >
            ＋ 视角
          </button>
        </div>
        <div className={s.row}>
          <button
            disabled={index === 0}
            onClick={() => {
              const tellings = [...draft.tellings];
              [tellings[index - 1], tellings[index]] = [
                tellings[index],
                tellings[index - 1],
              ];
              setDraft({ ...draft, tellings });
            }}
          >
            视角前移
          </button>
          <button
            disabled={index === draft.tellings.length - 1}
            onClick={() => {
              const tellings = [...draft.tellings];
              [tellings[index], tellings[index + 1]] = [
                tellings[index + 1],
                tellings[index],
              ];
              setDraft({ ...draft, tellings });
            }}
          >
            视角后移
          </button>
        </div>
        <label>
          本视角
          <select
            value={t.character || ""}
            onChange={(e) =>
              update({
                character: e.target.value || null,
                narrator:
                  query.data?.characters.find((p) => p.id === e.target.value)
                    ?.name || "全知旁白",
              })
            }
          >
            <option value="">全知旁白 / 待定</option>
            {query.data?.characters.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            aria-label="本次表述"
            value={t.reliability}
            onChange={(e) =>
              update({ reliability: e.target.value as typeof t.reliability })
            }
          >
            {["客观事实", "角色有限事实", "人物推测", "可能不可靠"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
          <button
            disabled={draft.tellings.length < 2}
            onClick={() =>
              setDraft({
                ...draft,
                tellings: draft.tellings.filter((v) => v.id !== t.id),
              })
            }
          >
            移除此视角
          </button>
        </label>
        <div className={s.proseEdit}>
          <MarkdownEditor
            key={t.id}
            value={t.intent}
            onChange={(intent) => update({ intent })}
            placeholder="从这个视角讲什么…"
          />
        </div>
        <details>
          <summary>引用与讲述设置</summary>
          <button
            onClick={() => setDialog({ kind: "shared-event" })}
            disabled={!data.worlds.length}
          >
            ＋ 创建共享事件
          </button>
          <label>
            来源
            <input
              value={t.source}
              onChange={(e) => update({ source: e.target.value })}
            />
          </label>
          {t.refs.map((r, i) => (
            <fieldset key={i}>
              <legend>{findEvent(data, r.line, r.event)?.title}</legend>
              <select
                aria-label="本次引用表述"
                value={r.reliability || t.reliability}
                onChange={(e) =>
                  update({
                    refs: t.refs.map((v, j) =>
                      j === i
                        ? {
                            ...v,
                            reliability: e.target.value as typeof t.reliability,
                          }
                        : v,
                    ),
                  })
                }
              >
                {["客观事实", "角色有限事实", "人物推测", "可能不可靠"].map(
                  (k) => (
                    <option key={k}>{k}</option>
                  ),
                )}
              </select>
              <label>
                本次披露
                <input
                  value={r.reveal}
                  onChange={(e) =>
                    update({
                      refs: t.refs.map((v, j) =>
                        j === i ? { ...v, reveal: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
              <label>
                暂不披露
                <input
                  value={r.withheld}
                  onChange={(e) =>
                    update({
                      refs: t.refs.map((v, j) =>
                        j === i ? { ...v, withheld: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
              <button
                onClick={() =>
                  update({ refs: t.refs.filter((_, j) => j !== i) })
                }
              >
                移除引用
              </button>
            </fieldset>
          ))}
          <select
            aria-label="引用共享事件"
            value=""
            onChange={(e) => {
              const [line, event] = e.target.value.split("|");
              if (event)
                update({
                  refs: [
                    ...t.refs,
                    {
                      line,
                      event,
                      reveal: "",
                      withheld: "",
                      source: "作者构思",
                    },
                  ],
                });
            }}
          >
            <option value="">＋ 引用事件</option>
            {data.worlds.flatMap((w) =>
              worldEvents(data, w.id).map((ev) => (
                <option key={`${w.id}|${ev.id}`} value={`${w.id}|${ev.id}`}>
                  {w.name} · {ev.title}
                </option>
              )),
            )}
          </select>
        </details>
        {draft.type === "jump" && (
          <fieldset>
            <legend>时间跳转</legend>
            <select
              value={draft.jump?.kind || "回忆"}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  jump: {
                    kind: e.target.value as NonNullable<
                      NarrativeCard["jump"]
                    >["kind"],
                    destination: draft.jump?.destination || "",
                    connection: null,
                    returnContext: !["穿越 / 虫洞", "同一历史回返"].includes(
                      e.target.value,
                    ),
                  },
                })
              }
            >
              {[
                "回忆",
                "预叙",
                "日记 / 史书",
                "穿越 / 虫洞",
                "同一历史回返",
              ].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
            <input
              aria-label="跳转目的地"
              value={draft.jump?.destination || ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  jump: {
                    kind: draft.jump?.kind || "回忆",
                    connection: draft.jump?.connection || null,
                    returnContext: draft.jump?.returnContext ?? true,
                    destination: e.target.value,
                  },
                })
              }
            />
            <select
              aria-label="真实连接"
              value={draft.jump?.connection || ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  jump: {
                    kind: draft.jump?.kind || "穿越 / 虫洞",
                    destination: draft.jump?.destination || "",
                    connection: e.target.value || null,
                    returnContext: false,
                  },
                })
              }
            >
              <option value="">未关联真实连接</option>
              {data.connections.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </fieldset>
        )}
        <label>
          归属章节
          <select
            value={draft.chapter || ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                chapter: e.target.value || null,
                wordBudget: e.target.value ? draft.wordBudget : null,
              })
            }
          >
            <option value="">未分章</option>
            {data.chapters
              .filter((c) => c.line === draft.line)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.narrateSummary}
            onChange={(e) =>
              setDraft({ ...draft, narrateSummary: e.target.checked })
            }
          />
          先讲本层概要，再讲细节
        </label>
        <div className={s.footer}>
          <button onClick={() => setDraft(null)}>取消</button>
          <button disabled={readonly} onClick={() => void submitCard()}>
            保存卡片
          </button>
        </div>
      </div>
    );
  }
  function renderChapters(projection = false) {
    const chapters = data.chapters.filter((c) => c.line === lineId),
      actual = readingCards(data, lineId);
    return (
      <>
        <div className={s.toolbar}>
          <strong>{projection ? "大纲 · 只读投影" : "卷章大纲"}</strong>
          {projection ? (
            <button
              onClick={() =>
                openTab({
                  id: buildTabId("narrative", novelId),
                  type: "narrative",
                  novelId,
                  refId: refId || chapters[0]?.id || "chapters",
                  title: "叙事线 · 卷章大纲",
                })
              }
            >
              前往叙事线 · 卷章大纲
            </button>
          ) : (
            <>
              <button
                disabled={readonly}
                onClick={() => setDialog({ kind: "volume" })}
              >
                ＋ 卷
              </button>
              <button
                disabled={readonly}
                onClick={() => setDialog({ kind: "chapter" })}
              >
                ＋ 章
              </button>
            </>
          )}
        </div>
        {[
          ...data.volumes.filter((v) => v.line === lineId),
          {
            id: "",
            title: "未分卷",
            summary: "",
            order: Number.MAX_SAFE_INTEGER,
          },
        ]
          .sort((a, b) => a.order - b.order)
          .map((v, volumeIndex) => (
            <section
              key={v.id}
              className={s.volume}
              aria-label={
                v.id
                  ? `第${chineseOrdinal(volumeIndex + 1)}卷 · ${v.title}`
                  : v.title
              }
            >
              <div className={s.volumeHead}>
                <div>
                  <span className={s.volumeNumber}>
                    {v.id ? `第${chineseOrdinal(volumeIndex + 1)}卷` : "待整理"}
                  </span>
                  <h2>{v.title}</h2>
                  <p className={s.muted}>
                    {chapters.filter((ch) => (ch.volume || "") === v.id).length}{" "}
                    章{v.summary ? ` · ${v.summary}` : ""}
                  </p>
                </div>
                <div className={s.row}>
                  {!projection && v.id && (
                    <button
                      disabled={readonly}
                      onClick={() => setDialog({ kind: "volume", id: v.id })}
                    >
                      修改卷
                    </button>
                  )}
                  {!projection && (
                    <button
                      disabled={readonly}
                      onClick={() =>
                        setDialog({ kind: "chapter", volume: v.id })
                      }
                    >
                      ＋ 添加章节
                    </button>
                  )}
                </div>
              </div>
              {chapters
                .filter(
                  (ch) =>
                    (ch.volume || "") === v.id &&
                    (!refId || mode !== "projection" || ch.id === refId),
                )
                .sort((a, b) => a.order - b.order)
                .map((ch) => {
                  const p = chapterProjection(data, ch.id);
                  return (
                    <section
                      key={ch.id}
                      className={s.chapter}
                      data-planning-chapter={ch.id}
                      onDoubleClick={(e) => {
                        if (!projection && !buttonTarget(e.target))
                          setExpandedChapters((ids) =>
                            ids.includes(ch.id)
                              ? ids.filter((id) => id !== ch.id)
                              : [...ids, ch.id],
                          );
                      }}
                    >
                      <div className={s.row}>
                        <h3>{ch.title}</h3>
                        {!projection && (
                          <button
                            disabled={readonly}
                            onClick={() =>
                              setDialog({ kind: "chapter", id: ch.id })
                            }
                          >
                            修改章节
                          </button>
                        )}
                        <button
                          onClick={() =>
                            openTab({
                              id: buildTabId("chapter-content", novelId, {
                                refId: ch.id,
                              }),
                              type: "chapter-content",
                              novelId,
                              refId: ch.id,
                              title: ch.title,
                            })
                          }
                        >
                          正文
                        </button>
                      </div>
                      {projection ? (
                        <>
                          <p className={s.muted}>
                            本章字数 {ch.wordMin}～{ch.wordBudget} 字 · 来自{" "}
                            {activeLine?.name}
                          </p>
                          <button
                            disabled={readonly}
                            onClick={() => void reviewChapter(ch.id)}
                          >
                            AI 评审章纲
                          </button>
                          <details>
                            <summary>章纲评审记录</summary>
                            <ReviewHistory
                              novelId={novelId}
                              targetType="CHAPTER_OUTLINE"
                              targetId={ch.id}
                            />
                          </details>
                          <ScoreIndicator
                            novelId={novelId}
                            targetType="CHAPTER_OUTLINE"
                            targetId={ch.id}
                          />
                          <div style={{ minHeight: 180 }}>
                            <MarkdownPreview
                              source={p.outline || "尚未分配叙事卡片"}
                            />
                          </div>
                        </>
                      ) : (
                        <BudgetForm
                          key={`${ch.id}:${query.data?.version}`}
                          title={ch.title}
                          budget={ch.wordBudget}
                          minimum={ch.wordMin}
                          chapterId={ch.id}
                          expanded={expandedChapters.includes(ch.id)}
                          onToggle={() =>
                            setExpandedChapters((ids) =>
                              ids.includes(ch.id)
                                ? ids.filter((id) => id !== ch.id)
                                : [...ids, ch.id],
                            )
                          }
                          allCards={p.allCards}
                          cards={p.cards}
                          disabled={!!readonly}
                          onSave={(wordMin, wordBudget, allocations) =>
                            save([
                              {
                                kind: "put",
                                collection: "chapters",
                                value: { id: ch.id, wordMin, wordBudget },
                              },
                              ...allocations.map((a) => ({
                                kind: "put" as const,
                                collection: "cards" as const,
                                value: a,
                              })),
                            ])
                          }
                          onLocate={(c) => selectCard(c, false, true)}
                        />
                      )}
                    </section>
                  );
                })}
            </section>
          ))}
        {!projection && (
          <section className={s.chapter}>
            <h3>未分章</h3>
            {actual
              .filter((c) => !cardChapter(data, c))
              .map((c) => (
                <div key={c.id} className={s.chapterRow}>
                  <span>{c.title}</span>
                  <select
                    aria-label={`为${c.title}分配章节`}
                    value=""
                    disabled={readonly}
                    onChange={(e) =>
                      void put("cards", {
                        id: c.id,
                        chapter: e.target.value || null,
                      })
                    }
                  >
                    <option value="">分配卷章…</option>
                    {chapters.map((ch) => (
                      <option key={ch.id} value={ch.id}>
                        {ch.title}
                      </option>
                    ))}
                  </select>
                  <button onClick={() => selectCard(c, false, true)}>
                    定位卡片
                  </button>
                </div>
              ))}
          </section>
        )}
      </>
    );
  }
  function renderEventEditor() {
    if (!eventDraft) return null;
    const d = eventDraft;
    const calendar = activeWorld!.calendar;
    const units = [{ label: timeUnit(calendar), value: 1 }];
    if (calendar.kind !== "years" && calendar.hoursPerDay) {
      units.push({ label: "天", value: calendar.hoursPerDay });
      if (calendar.daysPerMonth) {
        const month = calendar.hoursPerDay * calendar.daysPerMonth;
        units.push({ label: "个月", value: month });
        if (calendar.monthsPerYear)
          units.push({ label: "年", value: month * calendar.monthsPerYear });
      }
    }
    const updateTime = (time: PlanningEvent["time"]) => {
      const oldEnd = resolveTime(data, d).end;
      const nextStart = resolveTime(data, { ...d, time }).start;
      setEventDraft({
        ...d,
        time,
        duration:
          endTimeMode && oldEnd !== null && nextStart !== null
            ? oldEnd - nextStart
            : d.duration,
      });
    };
    return (
      <div
        ref={editor}
        className={`${s.card} ${s.editor} ${s.editing} ${s.worldEventEditor}`}
      >
        <textarea
          rows={1}
          className={s.eventTitleInput}
          aria-label="事件标题"
          value={d.title}
          onChange={(e) => setEventDraft({ ...d, title: e.target.value })}
        />
        <div className={s.row}>
          <select
            aria-label="开始时间类型"
            value={
              d.time.kind === "window" && d.time.label === "仅同日"
                ? "day"
                : d.time.kind
            }
            onChange={(e) =>
              setEventDraft({
                ...d,
                time: {
                  ...d.time,
                  kind:
                    e.target.value === "day"
                      ? "window"
                      : (e.target.value as typeof d.time.kind),
                  precision: e.target.value === "day" ? "day" : "hour",
                  label: e.target.value === "day" ? "仅同日" : "",
                  end: ["window", "day"].includes(e.target.value)
                    ? d.time.value + (activeWorld?.calendar.hoursPerDay ?? 1)
                    : null,
                },
              })
            }
          >
            <option value="exact">精确时间</option>
            <option
              value="day"
              disabled={
                activeWorld?.calendar.kind === "years" ||
                !activeWorld?.calendar.hoursPerDay
              }
            >
              仅同日（具体时刻未知）
            </option>
            <option value="window">时间窗口</option>
            <option value="unknown">时间待定</option>
          </select>
          <select
            aria-label="时间参考"
            value={d.time.anchor || ""}
            onChange={(e) =>
              updateTime({ ...d.time, anchor: e.target.value || null })
            }
          >
            <option value="">本线零点</option>
            {worldEvents(data, d.line)
              .filter((e) => e.id !== d.id)
              .map((e) => (
                <option value={e.id} key={e.id}>
                  {e.title}
                </option>
              ))}
          </select>
          {d.time.anchor && (
            <select
              aria-label="参考边界"
              value={d.time.boundary}
              onChange={(e) =>
                setEventDraft({
                  ...d,
                  time: {
                    ...d.time,
                    boundary: e.target.value as "start" | "end",
                  },
                })
              }
            >
              <option value="start">开始</option>
              <option value="end">结束</option>
            </select>
          )}
          <label>
            开始偏移
            <input
              aria-label="开始时间偏移"
              type="number"
              value={Number((d.time.value / startUnit).toPrecision(12))}
              onChange={(e) =>
                updateTime({
                  ...d.time,
                  value: Number(e.target.value) * startUnit,
                })
              }
            />
          </label>
          <select
            aria-label="开始时间单位"
            value={startUnit}
            onChange={(e) => setStartUnit(Number(e.target.value))}
          >
            {units.map((u) => (
              <option key={u.label} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
          {d.time.kind === "window" && (
            <input
              aria-label="窗口结束"
              type="number"
              value={d.time.end ?? 0}
              onChange={(e) =>
                setEventDraft({
                  ...d,
                  time: { ...d.time, end: Number(e.target.value) },
                })
              }
            />
          )}
          <select
            aria-label="事件持续类型"
            value={
              endTimeMode
                ? "end"
                : d.ongoing
                  ? "ongoing"
                  : d.duration === null
                    ? "unknown"
                    : d.duration === 0
                      ? "point"
                      : "duration"
            }
            onChange={(ev) => {
              const type = ev.target.value;
              setEndTimeMode(type === "end");
              setEventDraft({
                ...d,
                ongoing: type === "ongoing",
                duration: ["ongoing", "unknown"].includes(type)
                  ? null
                  : type === "point"
                    ? 0
                    : d.duration || 1,
              });
            }}
          >
            <option value="point">时点</option>
            <option value="duration">持续</option>
            <option value="end">结束于</option>
            <option value="unknown">结束未定</option>
            <option value="ongoing">持续中</option>
          </select>
          {endTimeMode ? (
            <label>
              结束时间点（{timeUnit(activeWorld!.calendar)}）
              <input
                aria-label="结束时间点"
                type="number"
                value={resolveTime(data, d).end ?? ""}
                onChange={(ev) =>
                  setEventDraft({
                    ...d,
                    duration:
                      Number(ev.target.value) -
                      (resolveTime(data, d).start ?? 0),
                    ongoing: false,
                  })
                }
              />
            </label>
          ) : (
            d.duration !== null &&
            d.duration !== 0 && (
              <label>
                持续时长
                <input
                  aria-label="事件时长"
                  type="number"
                  min="0"
                  value={Number((d.duration / durationUnit).toPrecision(12))}
                  onChange={(ev) =>
                    setEventDraft({ ...d, duration: Number(ev.target.value) })
                  }
                />
              </label>
            )
          )}
        </div>
        {!endTimeMode && d.duration !== null && d.duration > 0 && (
          <select
            aria-label="持续时间单位"
            value={durationUnit}
            onChange={(e) => setDurationUnit(Number(e.target.value))}
          >
            {units.map((u) => (
              <option key={u.label} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
        )}
        <div className={s.proseEdit}>
          <MarkdownEditor
            value={d.fact}
            onChange={(fact) => setEventDraft({ ...d, fact })}
            placeholder="客观发生的事实"
          />
        </div>
        <div className={s.pills}>
          {d.people.map((id) => (
            <button
              key={id}
              className={s.pill}
              onClick={() =>
                setEventDraft({
                  ...d,
                  people: d.people.filter((p) => p !== id),
                })
              }
            >
              {chip(id)} ×
            </button>
          ))}
          <select
            aria-label="添加参与角色"
            value=""
            onChange={(e) =>
              e.target.value &&
              setEventDraft({
                ...d,
                people: [...new Set([...d.people, e.target.value])],
              })
            }
          >
            <option value="">＋ 角色</option>
            {query.data?.characters
              .filter((c) => !d.people.includes(c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </div>
        {d.changes.map((c, i) => (
          <fieldset key={c.id}>
            <legend>关键变化</legend>
            <div className={s.row}>
              <select
                aria-label="变化角色"
                value={c.character}
                onChange={(e) =>
                  setEventDraft({
                    ...d,
                    changes: d.changes.map((v, j) =>
                      i === j ? { ...v, character: e.target.value } : v,
                    ),
                  })
                }
              >
                {query.data?.characters.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {(["dimension", "before", "after"] as const).map((field) => (
                <input
                  key={field}
                  aria-label={
                    { dimension: "维度", before: "变化前", after: "变化后" }[
                      field
                    ]
                  }
                  value={c[field]}
                  onChange={(e) =>
                    setEventDraft({
                      ...d,
                      changes: d.changes.map((v, j) =>
                        i === j ? { ...v, [field]: e.target.value } : v,
                      ),
                    })
                  }
                />
              ))}
              <select
                value={c.at}
                aria-label="生效时机"
                onChange={(e) =>
                  setEventDraft({
                    ...d,
                    changes: d.changes.map((v, j) =>
                      i === j
                        ? { ...v, at: e.target.value as "start" | "end" }
                        : v,
                    ),
                  })
                }
              >
                <option value="start">开始时</option>
                <option value="end">结束时</option>
              </select>
              <button
                onClick={() =>
                  setEventDraft({
                    ...d,
                    changes: d.changes.filter((_, j) => j !== i),
                  })
                }
              >
                移除
              </button>
            </div>
          </fieldset>
        ))}
        <button
          disabled={!query.data?.characters.length}
          onClick={() =>
            setEventDraft({
              ...d,
              changes: [
                ...d.changes,
                {
                  id: uid(),
                  character: query.data!.characters[0].id,
                  dimension: "境界",
                  before: "",
                  after: "",
                  at: "end",
                },
              ],
            })
          }
        >
          ＋ 关键变化
        </button>
        {eventReferences(d, true)}
        {message && message !== "已保存" && (
          <p role="alert" className={s.muted}>
            {message}
          </p>
        )}
        <div className={s.footer}>
          <button
            onClick={() => {
              setEventDraft(null);
              setMessage("");
            }}
          >
            取消
          </button>
          <button
            disabled={readonly}
            onClick={async () => {
              if (!d.title.trim()) {
                setMessage("请填写事件名称。");
                return;
              }
              if (d.duration !== null && d.duration < 0) {
                setMessage("结束时间不能早于开始时间，请调整后再保存。");
                return;
              }
              if (
                d.time.kind === "window" &&
                (d.time.end === null || d.time.end < d.time.value)
              ) {
                setMessage("时间窗口结束不能早于开始。");
                return;
              }
              if (await put("events", d)) setEventDraft(null);
            }}
          >
            保存事件
          </button>
        </div>
      </div>
    );
  }
  function eventReferences(e: PlanningEvent, disabled = false) {
    return (
      <div className={s.refs}>
        {data.cards.flatMap((c) =>
          c.tellings
            .filter((t) =>
              t.refs.some((r) => r.line === worldId && r.event === e.id),
            )
            .map((t) => (
              <button
                disabled={disabled}
                key={`${c.id}/${t.id}`}
                onClick={() => {
                  openTab({
                    id: buildTabId("narrative", novelId),
                    type: "narrative",
                    novelId,
                    refId: c.id,
                    title: "叙事线",
                  });
                  useTabsStore
                    .getState()
                    .requestPanelFocus(
                      buildTabId("narrative", novelId),
                      c.id,
                      t.id,
                    );
                }}
              >
                {data.lines.find((l) => l.id === c.line)?.name} · {c.title} ·{" "}
                {t.narrator}
              </button>
            )),
        )}
      </div>
    );
  }
  function eventCard(e: PlanningEvent) {
    if (eventDraft?.id === e.id) return renderEventEditor();
    const t = resolveTime(data, e),
      frozen = !!activeWorld?.fork?.events.some((v) => v.id === e.id);
    return (
      <article
        className={`${s.card} ${s.worldEvent} ${eventSelection === e.id ? s.eventSelected : ""}`}
        aria-label={e.title}
        onClick={(ev) => {
          if (!buttonTarget(ev.target)) setEventSelection(e.id);
        }}
        onDoubleClick={(ev) => {
          if (!buttonTarget(ev.target) && !readonly && !frozen) {
            if (eventDraft) {
              setMessage("请先保存或取消当前事件编辑，输入已保留。");
              return;
            }
            setMessage("");
            setEventDraft(structuredClone(e));
          }
        }}
      >
        <div className={s.cardHead}>
          <h3
            title={frozen ? "冻结前史" : "拖动标题移动事件"}
            onPointerDown={(ev) => startTimeDrag(ev, "events", e.id, "move")}
          >
            {e.title}
          </h3>
          <details>
            <summary aria-label={`${e.title}更多操作`}>
              <MoreHorizontal size={18} />
            </summary>
            <div className={s.menu}>
              <button
                onClick={() =>
                  quotePlanning(e.title, `${worldId}/${e.id}`, "世界事件")
                }
              >
                引用到对话
              </button>
              <button
                onClick={() => setDialog({ kind: "event-detail", id: e.id })}
              >
                详情
              </button>
              <button
                disabled={readonly || frozen || !!eventDraft}
                onClick={() => setEventDraft(structuredClone(e))}
              >
                编辑
              </button>
              <button onClick={() => navigateWorldParent(e.id)}>
                展开子事件
              </button>
              <button
                disabled={readonly || frozen || !!eventDraft}
                onClick={() =>
                  void put("events", {
                    ...e,
                    id: uid(),
                    title: `${e.title} · 副本`,
                  })
                }
              >
                复制
              </button>
              <button
                disabled={readonly || frozen || !!eventDraft}
                onClick={() => setDialog({ kind: "delete-event", id: e.id })}
              >
                删除
              </button>
              <button
                disabled={readonly}
                onClick={() => setDialog({ kind: "fork", id: e.id })}
              >
                从此分叉
              </button>
            </div>
          </details>
        </div>
        <small className={s.muted}>
          {t.start === null
            ? "待定位"
            : worldTimeLabel(
                t.start,
                activeWorld?.calendar.kind === "gregorian" ||
                  activeWorld?.timeBases.find((b) => b.id === timeBase)
                    ?.calendar.kind === "gregorian"
                  ? 1
                  : windowRange.span,
              )}
          {e.time.kind === "window"
            ? `～${t.windowEnd} ${timeUnit(activeWorld!.calendar)} · ${e.time.label || "时间窗口"}`
            : e.duration === 0
              ? " · 时点"
              : e.duration === null
                ? ` · ${e.ongoing ? "持续中" : "结束未定"}`
                : ` · 持续 ${+e.duration.toFixed(3)} ${timeUnit(activeWorld!.calendar)}`}
          {e.duration === null ? " · 宽度仅供阅读" : ""}
          {frozen ? " · 冻结前史" : ""}
        </small>
        <div className={s.eventFact}>
          <MarkdownPreview source={e.fact} />
        </div>
        <div className={s.pills}>
          {e.people.map((id) => (
            <span className={s.pill} key={id}>
              {chip(id)}
            </span>
          ))}
        </div>
        {e.changes.map((c) => (
          <div className={s.eventChange} key={c.id}>
            <small className={s.muted}>
              {query.data?.characters.find((p) => p.id === c.character)?.name} ·{" "}
              {c.dimension} · {c.at === "start" ? "开始时" : "结束时"}
            </small>
            <p>
              {c.before} → {c.after}
            </p>
          </div>
        ))}
        {worldEvents(data, worldId).some((child) => child.parent === e.id) && (
          <button
            className={s.eventChildren}
            onClick={() => navigateWorldParent(e.id)}
          >
            展开{" "}
            {
              worldEvents(data, worldId).filter(
                (child) => child.parent === e.id,
              ).length
            }{" "}
            件子事件 ›
          </button>
        )}
        {eventReferences(e)}
      </article>
    );
  }
  const temporalDrag = useRef<{
    collection: "events" | "periods";
    id: string;
    x: number;
    edge: "move" | "start" | "end";
    delta: number;
  } | null>(null);
  const [timePreview, setTimePreview] = useState<{
    id: string;
    delta: number;
    edge: "move" | "start" | "end";
  } | null>(null);
  useEffect(() => {
    const cancel = () => {
      const origin = pan.current;
      if (origin) {
        setWindowRange((v) => ({ ...v, start: origin.start, y: -origin.top }));
        if (timeline.current) timeline.current.scrollTop = origin.top;
      }
      pan.current = null;
      temporalDrag.current = null;
      setTimePreview(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("blur", cancel);
    document.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("blur", cancel);
      document.removeEventListener("keydown", key);
    };
  }, []);
  function startTimeDrag(
    e: React.PointerEvent,
    collection: "events" | "periods",
    id: string,
    edge: "move" | "start" | "end",
  ) {
    if (
      readonly ||
      eventDraft ||
      !data[collection].some((e) => e.id === id && e.line === worldId)
    )
      return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    suppressPeriodClick.current = false;
    temporalDrag.current = { collection, id, x: e.clientX, edge, delta: 0 };
  }
  async function finishTimeDrag() {
    const drag = temporalDrag.current;
    temporalDrag.current = null;
    setTimePreview(null);
    if (
      !drag ||
      Math.abs(drag.delta) <
        (windowRange.span * 5) / Math.max(1, timelineWidth - 28)
    )
      return;
    suppressPeriodClick.current = true;
    if (drag.collection === "events") {
      const original = data.events.find(
        (e) => e.id === drag.id && e.line === worldId,
      );
      if (!original) return;
      const next = {
        ...original,
        time: {
          ...original.time,
          value: original.time.value + (drag.edge === "end" ? 0 : drag.delta),
          end:
            original.time.kind === "window" &&
            original.time.end !== null &&
            drag.edge === "move"
              ? original.time.end + drag.delta
              : original.time.end,
        },
        duration:
          original.duration === null
            ? null
            : original.duration +
              (drag.edge === "move"
                ? 0
                : drag.edge === "end"
                  ? drag.delta
                  : -drag.delta),
      };
      if (!(await put("events", next))) setEventDraft(next);
    } else {
      const p = data.periods.find(
        (p) => p.id === drag.id && p.line === worldId,
      );
      if (!p) return;
      if (
        !(await put("periods", {
          id: p.id,
          start: p.start + (drag.edge === "end" ? 0 : drag.delta),
          end:
            p.end === null
              ? null
              : p.end + (drag.edge === "start" ? 0 : drag.delta),
        }))
      )
        setDialog({
          kind: "period",
          id: p.id,
          rangeDraft: {
            start: p.start + (drag.edge === "end" ? 0 : drag.delta),
            end:
              p.end === null
                ? null
                : p.end + (drag.edge === "start" ? 0 : drag.delta),
          },
        });
    }
  }
  function navigateWorldParent(next: string | null, nextWorld = worldId) {
    worldViews.current.set(`${worldId}/${eventParent ?? "root"}`, windowRange);
    if (eventDraft) {
      setMessage("请先保存或取消当前事件编辑，输入已保留。");
      return;
    }
    worldBases.current.set(worldId, timeBase);
    if (nextWorld !== worldId)
      setTimeBase(worldBases.current.get(nextWorld) ?? "");
    setEventSelection(null);
    setWorldPopover(null);
    setWorld(nextWorld);
    setEventParent(next);
    const saved = worldViews.current.get(`${nextWorld}/${next ?? "root"}`);
    const event = next ? findEvent(data, nextWorld, next) : null;
    const time = event ? resolveTime(data, event) : null;
    const scope = refinementRange(data, nextWorld, next);
    setWindowRange(
      saved ?? {
        start: scope?.start ?? time?.start ?? 0,
        span: Math.max(
          1,
          scope
            ? scope.end - scope.start
            : time?.end !== null &&
                time?.start !== null &&
                time?.end !== undefined &&
                time?.start !== undefined
              ? time.end - time.start
              : 240,
        ),
        y: 0,
      },
    );
    requestAnimationFrame(() => {
      if (timeline.current) timeline.current.scrollTop = -(saved?.y ?? 0);
    });
  }
  function renderWorld() {
    const base = activeWorld?.timeBases?.find((b) => b.id === timeBase);
    const labelTime = worldTimeLabel;
    const fork = activeWorld?.fork;
    const forkChanged =
      fork?.events.filter((e) => {
        const source = findEvent(data, fork.source, e.id);
        return (
          !source ||
          source.fact !== e.fact ||
          source.title !== e.title ||
          JSON.stringify(resolveTime(data, source)) !==
            JSON.stringify(resolveTime(data, e)) ||
          source.duration !== e.duration ||
          JSON.stringify(source.changes) !== JSON.stringify(e.changes)
        );
      }).length ?? 0;
    const events = worldEvents(data, worldId).filter(
        (e) => e.parent === eventParent,
      ),
      placed = events.filter((e) => resolveTime(data, e).start !== null),
      pending = events.filter((e) => resolveTime(data, e).start === null),
      ps = periods
        ? [
            ...(activeWorld?.fork?.periods ?? []),
            ...data.periods.filter((p) => p.line === worldId),
          ]
        : [];
    const plotWidth = Math.max(1, timelineWidth - 28);
    const scale = plotWidth / windowRange.span;
    const toX = (value: number) => 14 + (value - windowRange.start) * scale;
    const allPeriods = [
      ...(fork?.periods ?? []),
      ...data.periods.filter((p) => p.line === worldId),
    ];
    const visiblePeriods = ps
      .map((p) => {
        const linked = p.event ? findEvent(data, worldId, p.event) : null;
        const original = linked
          ? resolveTime(data, linked)
          : { start: p.start, end: p.end };
        const preview = timePreview?.id === p.id ? timePreview : null;
        const start =
          original.start === null
            ? null
            : original.start +
              (preview && preview.edge !== "end" ? preview.delta : 0);
        const end =
          original.end === null
            ? null
            : original.end +
              (preview && preview.edge !== "start" ? preview.delta : 0);
        return { ...p, start, end };
      })
      .filter(
        (p) =>
          p.start !== null &&
          p.start <= windowRange.start + windowRange.span &&
          (p.end === null || p.end >= windowRange.start),
      );
    const tickCalendar = activeWorld?.calendar ?? {
      kind: "fixed" as const,
      epoch: "",
      hoursPerDay: 24,
      daysPerMonth: 30,
      monthsPerYear: 12,
    };
    const baseZero = base ? timeBaseValue(data, worldId, base, 0) : null;
    const ticks =
      base && baseZero !== null
        ? timelineTicks(
            windowRange.start * base.scale + baseZero,
            windowRange.span * base.scale,
            base.calendar,
            plotWidth,
          ).map((t) => (t - baseZero) / base.scale)
        : timelineTicks(
            windowRange.start,
            windowRange.span,
            tickCalendar,
            plotWidth,
          );
    const layout = layoutTimelineCards(
      placed.map((e) => {
        const t = resolveTime(data, e);
        const preview = timePreview?.id === e.id ? timePreview : null;
        return {
          id: e.id,
          start:
            t.start! + (preview && preview.edge !== "end" ? preview.delta : 0),
          end:
            t.end === null
              ? null
              : t.end +
                (preview && preview.edge !== "start" ? preview.delta : 0),
          height: eventHeights[e.id],
        };
      }),
      scale,
    );
    const continuing = placed.filter((e) => {
      const t = resolveTime(data, e);
      return (
        t.start! < windowRange.start &&
        (t.end === null || t.end > windowRange.start)
      );
    });
    const changeItems = changes
      ? placed.flatMap((e) =>
          e.changes.flatMap((c) => {
            const at = resolveTime(data, e)[c.at];
            return at === null || e.time.kind !== "exact"
              ? []
              : [{ ...c, event: e, time: at }];
          }),
        )
      : [];
    const characterGroups = [
      ...new Set(changeItems.map((c) => c.character)),
    ].map((id) => ({
      id,
      items: changeItems.filter((c) => c.character === id),
    }));
    let laneTop = layout.height + 28;
    const characterLayouts = characterGroups.map((group) => {
      const packed = layoutTimelineCards(
        group.items.map((c) => ({
          id: c.id,
          start: c.time,
          end: c.time,
          height: Math.max(
            94,
            58 +
              Math.ceil(
                (c.before.length + c.after.length + c.event.title.length) / 15,
              ) *
                22,
          ),
        })),
        scale,
        230,
      );
      const top = laneTop;
      laneTop += packed.height + 40;
      return { ...group, packed, top };
    });
    const eventPath: PlanningEvent[] = [];
    let eventAncestor = eventParent
      ? findEvent(data, worldId, eventParent)
      : undefined;
    while (
      eventAncestor &&
      !eventPath.some((e) => e.id === eventAncestor?.id)
    ) {
      eventPath.unshift(eventAncestor);
      eventAncestor = eventAncestor.parent
        ? findEvent(data, worldId, eventAncestor.parent)
        : undefined;
    }
    const locateEvent = (e: PlanningEvent) => {
      const t = resolveTime(data, e);
      setEventSelection(e.id);
      setWorldPopover(null);
      if (t.start !== null)
        setWindowRange((v) => ({
          ...v,
          start: t.start! - v.span * 0.08,
          y: 0,
        }));
      else setTable(true);
      requestAnimationFrame(() => {
        if (timeline.current)
          timeline.current.scrollTop = Math.max(
            0,
            (layout.items.find((item) => item.id === e.id)?.top ?? 0) - 24,
          );
      });
    };
    return (
      <>
        <div className={`${s.toolbar} ${s.worldToolbar}`}>
          <select
            aria-label="当前世界线"
            value={worldId}
            onChange={(e) => {
              navigateWorldParent(null, e.target.value);
            }}
          >
            {data.worlds.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
                {w.fork ? " · 分支" : ""}
              </option>
            ))}
          </select>
          <button
            disabled={readonly}
            onClick={() => setDialog({ kind: "world" })}
          >
            ＋ 世界线
          </button>
          <button
            disabled={readonly || !activeWorld}
            onClick={() => setDialog({ kind: "world", id: worldId })}
          >
            世界线设置
          </button>
          <button
            disabled={readonly || !!eventDraft || !worldId}
            onClick={() => setDialog({ kind: "period" })}
          >
            ＋ 时期
          </button>
          <button
            disabled={readonly}
            onClick={() => setDialog({ kind: "connection" })}
          >
            跨世界连接
          </button>
          <span className={s.toolbarSpacer} />
          <label>
            时间基准
            <select
              aria-label="时间基准"
              value={timeBase}
              onChange={(e) => setTimeBase(e.target.value)}
            >
              <option value="">{activeWorld?.calendar.epoch}</option>
              {activeWorld?.timeBases?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.offset === null ? " · 未映射" : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={readonly}
            onClick={() => {
              setMappingEdit(timeBase);
              setDialog({ kind: "world", id: worldId });
            }}
          >
            单位与对应
          </button>
        </div>
        <div className={`${s.toolbar} ${s.worldPath}`}>
          <nav aria-label="世界线层级" className={s.breadcrumbs}>
            <ol>
              <li>
                <button onClick={() => navigateWorldParent(null)}>
                  {activeWorld?.name || "世界线"}
                </button>
              </li>
              {eventPath.map((e, i) => (
                <li key={e.id}>
                  <ChevronRight size={13} />
                  {i === eventPath.length - 1 ? (
                    <span aria-current="page">{e.title}</span>
                  ) : (
                    <button onClick={() => navigateWorldParent(e.id)}>
                      {e.title}
                    </button>
                  )}
                </li>
              ))}
            </ol>
          </nav>
          <span className={s.toolbarSpacer} />
          <button
            disabled={readonly || !!eventDraft || !worldId}
            onClick={() =>
              setEventDraft(
                eventSchema.parse({
                  id: uid(),
                  line: worldId,
                  parent: eventParent,
                  title: "未命名事件",
                  time: { anchor: eventParent, kind: "unknown" },
                }),
              )
            }
          >
            ＋ 事件
          </button>
        </div>
        {!worldId ? (
          <div className={s.empty}>
            先建立一条独立世界线，记录客观发生的历史。
          </div>
        ) : (
          <>
            <div className={s.toolbar}>
              <button aria-pressed={!table} onClick={() => setTable(false)}>
                时间线
              </button>
              <button aria-pressed={table} onClick={() => setTable(true)}>
                事件表
              </button>
              <button
                aria-label="缩小时间刻度"
                onClick={() =>
                  setWindowRange((v) => ({
                    ...v,
                    ...zoomAt(v.start, v.span, 1.5, 0.5),
                  }))
                }
              >
                −
              </button>
              <button
                aria-label="放大时间刻度"
                onClick={() =>
                  setWindowRange((v) => ({
                    ...v,
                    ...zoomAt(v.start, v.span, 1 / 1.5, 0.5),
                  }))
                }
              >
                ＋
              </button>
              <button
                onClick={() => {
                  setWindowRange({
                    ...fitTimelineWindow(
                      placed.map((e) => {
                        const t = resolveTime(data, e);
                        return { start: t.start!, end: t.end };
                      }),
                      plotWidth,
                    ),
                    y: 0,
                  });
                  if (timeline.current) timeline.current.scrollTop = 0;
                }}
              >
                全貌
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={periods}
                  onChange={(e) => setPeriods(e.target.checked)}
                />
                时期
              </label>
              <button
                aria-expanded={worldPopover === "periods"}
                onClick={() =>
                  setWorldPopover((v) => (v === "periods" ? null : "periods"))
                }
              >
                时期 {allPeriods.length}
              </button>

              <label>
                <input
                  type="checkbox"
                  checked={changes}
                  onChange={(e) => setChanges(e.target.checked)}
                />
                角色变化
              </label>
              <span className={s.toolbarSpacer} />
              <button
                aria-expanded={worldPopover === "continuing"}
                onClick={() =>
                  setWorldPopover((v) =>
                    v === "continuing" ? null : "continuing",
                  )
                }
              >
                延续事件 {continuing.length}
              </button>
              <button
                aria-expanded={worldPopover === "pending"}
                onClick={() =>
                  setWorldPopover((v) => (v === "pending" ? null : "pending"))
                }
              >
                待定位 {pending.length}
              </button>
              {fork && (
                <span>
                  前史固定于源版本{fork.version}
                  {forkChanged
                    ? ` · ${forkChanged}项源事实已有变化，当前分支保持冻结`
                    : ""}
                </span>
              )}
            </div>
            {worldPopover && (
              <section
                className={s.worldList}
                aria-label={
                  worldPopover === "periods"
                    ? "时期列表"
                    : worldPopover === "pending"
                      ? "待定位事件"
                      : "延续事件"
                }
              >
                <div className={s.row}>
                  <strong>
                    {worldPopover === "periods"
                      ? "所有时期"
                      : worldPopover === "pending"
                        ? "时间待定位"
                        : "从视窗外延续的事件"}
                  </strong>
                  <button onClick={() => setWorldPopover(null)}>收起</button>
                </div>
                {worldPopover === "periods"
                  ? allPeriods.map((p) => (
                      <div className={s.row} key={p.id}>
                        <span>{p.title}</span>
                        <button
                          onClick={() => {
                            const linked = p.event
                              ? findEvent(data, worldId, p.event)
                              : null;
                            const t = linked ? resolveTime(data, linked) : p;
                            navigateWorldParent(null);
                            setWindowRange({
                              start: (t.start ?? p.start) - 2,
                              span:
                                Math.max(
                                  24,
                                  (t.end ?? p.start + 24) -
                                    (t.start ?? p.start),
                                ) * 1.2,
                              y: 0,
                            });
                          }}
                        >
                          定位时期
                        </button>
                        <button
                          onClick={() =>
                            setDialog({ kind: "period-detail", id: p.id })
                          }
                        >
                          查看时期
                        </button>
                      </div>
                    ))
                  : (worldPopover === "pending" ? pending : continuing).map(
                      (e) => (
                        <div key={e.id} className={s.row}>
                          <button onClick={() => locateEvent(e)}>
                            {e.title}
                          </button>
                          <button
                            onClick={() =>
                              setDialog({ kind: "event-detail", id: e.id })
                            }
                          >
                            详情
                          </button>
                          <button
                            disabled={
                              readonly ||
                              !data.events.some(
                                (v) => v.id === e.id && v.line === worldId,
                              )
                            }
                            onClick={() => {
                              setEventDraft(structuredClone(e));
                              setTable(true);
                              setWorldPopover(null);
                            }}
                          >
                            编辑时间
                          </button>
                        </div>
                      ),
                    )}
              </section>
            )}
            <div className={s.worldRange}>
              <span>
                {labelTime(windowRange.start)} —{" "}
                {labelTime(windowRange.start + windowRange.span)}
              </span>
              <span>当前层 · {events.length} 件事件</span>
            </div>
            {eventDraft &&
              !worldEvents(data, worldId).some((e) => e.id === eventDraft.id) &&
              renderEventEditor()}
            {table ? (
              <div className={s.cards}>
                {events.map((e) => (
                  <div key={e.id} style={{ marginBottom: 15 }}>
                    {eventCard(e)}
                  </div>
                ))}
              </div>
            ) : (
              <div
                ref={timeline}
                tabIndex={0}
                aria-label="世界时间线"
                className={s.timeline}
                onScroll={(ev) => {
                  const y = -ev.currentTarget.scrollTop;
                  setWindowRange((v) =>
                    v.y === y || (v.y > 0 && y === 0) ? v : { ...v, y },
                  );
                }}
                onPointerDown={(ev) => {
                  if (
                    buttonTarget(ev.target) ||
                    (ev.target as Element).closest(
                      "article,[data-event], [data-period]",
                    )
                  )
                    return;
                  pan.current = {
                    x: ev.clientX,
                    y: ev.clientY,
                    start: windowRange.start,
                    top:
                      ev.currentTarget.scrollTop - Math.max(0, windowRange.y),
                  };
                  ev.currentTarget.setPointerCapture(ev.pointerId);
                }}
                onPointerMove={(ev) => {
                  if (temporalDrag.current) {
                    const drag = temporalDrag.current;
                    drag.delta = snapTimelineDelta(
                      ((ev.clientX - drag.x) / plotWidth) * windowRange.span,
                      windowRange.span,
                      plotWidth,
                      activeWorld?.calendar.kind === "years",
                    );
                    setTimePreview({
                      id: drag.id,
                      delta: drag.delta,
                      edge: drag.edge,
                    });
                    return;
                  }
                  if (pan.current) {
                    const origin = pan.current,
                      dx = ev.clientX - origin.x,
                      dy = ev.clientY - origin.y;
                    if (Math.hypot(dx, dy) < 5) return;
                    const vertical = origin.top - dy;
                    ev.currentTarget.scrollTop = Math.max(0, vertical);
                    const nextY =
                      vertical < 0 ? -vertical : -ev.currentTarget.scrollTop;
                    setWindowRange((v) => ({
                      ...v,
                      start: origin.start - (dx / plotWidth) * v.span,
                      y: nextY,
                    }));
                  }
                }}
                onPointerUp={() => {
                  pan.current = null;
                  void finishTimeDrag();
                }}
                onPointerCancel={() => {
                  if (pan.current) {
                    const p = pan.current;
                    setWindowRange((v) => ({
                      ...v,
                      start: p.start,
                      y: -p.top,
                    }));
                    if (timeline.current) timeline.current.scrollTop = p.top;
                  }
                  pan.current = null;
                  temporalDrag.current = null;
                  setTimePreview(null);
                }}
                onKeyDown={(ev) => {
                  if (ev.target !== ev.currentTarget) return;
                  if (ev.key === "Escape") {
                    if (pan.current) {
                      const p = pan.current;
                      setWindowRange((v) => ({
                        ...v,
                        start: p.start,
                        y: -p.top,
                      }));
                      ev.currentTarget.scrollTop = p.top;
                    }
                    pan.current = null;
                    temporalDrag.current = null;
                    setTimePreview(null);
                  }
                  if (
                    [
                      "ArrowUp",
                      "ArrowDown",
                      "ArrowLeft",
                      "ArrowRight",
                    ].includes(ev.key)
                  ) {
                    ev.preventDefault();
                    if (ev.key === "ArrowUp" || ev.key === "ArrowDown")
                      ev.currentTarget.scrollTop +=
                        ev.key === "ArrowUp" ? -60 : 60;
                    else
                      setWindowRange((v) => ({
                        ...v,
                        start:
                          v.start +
                          ((ev.key === "ArrowRight" ? 1 : -1) * v.span) / 10,
                      }));
                  }
                }}
              >
                <div className={s.timelineHeader}>
                  <div className={s.ruler}>
                    {ticks.map((tick) => (
                      <span key={tick} style={{ left: toX(tick) }}>
                        {worldTimeLabel(
                          tick,
                          ticks.length > 1
                            ? ticks[1] - ticks[0]
                            : windowRange.span,
                        )}
                      </span>
                    ))}
                  </div>
                  {visiblePeriods.map((p) => {
                    const left = Math.max(14, toX(p.start!)),
                      right = Math.min(
                        timelineWidth - 14,
                        p.end === null ? timelineWidth - 14 : toX(p.end),
                      );
                    const colorIndex =
                      [...p.id].reduce((n, c) => n + c.charCodeAt(0), 0) % 5;
                    const clippedStart = p.start! < windowRange.start,
                      clippedEnd =
                        p.end !== null &&
                        p.end > windowRange.start + windowRange.span;
                    const mutable =
                      !readonly &&
                      !p.event &&
                      data.periods.some(
                        (v) => v.id === p.id && v.line === worldId,
                      );
                    return (
                      <div key={p.id} className={s.periodRow}>
                        <div
                          data-period={p.id}
                          className={`${s.period} ${p.end === null ? s.periodOpen : ""}`}
                          style={
                            {
                              marginLeft: left,
                              width: Math.max(1, right - left),
                              "--period-color": `var(--chart-${colorIndex + 1})`,
                              borderLeftStyle: clippedStart
                                ? "dashed"
                                : "solid",
                              borderRightStyle: clippedEnd ? "dashed" : "solid",
                            } as CSSProperties
                          }
                          onClick={() => {
                            if (suppressPeriodClick.current) {
                              suppressPeriodClick.current = false;
                              return;
                            }
                            setDialog({ kind: "period-detail", id: p.id });
                          }}
                          onPointerDown={(ev) => {
                            if (mutable)
                              startTimeDrag(ev, "periods", p.id, "move");
                          }}
                        >
                          {mutable && !clippedStart && right - left >= 64 && (
                            <button
                              aria-label={`调整${p.title}开始`}
                              className={s.periodStart}
                              onPointerDown={(ev) =>
                                startTimeDrag(ev, "periods", p.id, "start")
                              }
                            >
                              │
                            </button>
                          )}
                          <button className={s.periodTitle} title={p.title}>
                            {clippedStart ? "‹ " : ""}
                            {p.title}
                            {p.end === null
                              ? p.ongoing
                                ? " · 持续中 ›"
                                : " · 结束未定"
                              : clippedEnd
                                ? " ›"
                                : ""}
                          </button>
                          {mutable &&
                            p.end !== null &&
                            !clippedEnd &&
                            right - left >= 64 && (
                              <button
                                className={s.periodEnd}
                                aria-label={`调整${p.title}结束`}
                                onPointerDown={(ev) =>
                                  startTimeDrag(ev, "periods", p.id, "end")
                                }
                              >
                                │
                              </button>
                            )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div
                  className={s.eventSurface}
                  style={{
                    height: Math.max(300, laneTop + Math.max(0, windowRange.y)),
                  }}
                >
                  <div className={s.timelineGrid}>
                    {ticks.map((tick) => (
                      <i key={tick} style={{ left: toX(tick) }} />
                    ))}
                  </div>
                  {!placed.length && (
                    <p className={s.canvasEmpty}>
                      当前层还没有已定位事件。添加事件，或为待定位事件设置时间。
                    </p>
                  )}
                  {layout.items.map((item) => {
                    const e = placed.find((e) => e.id === item.id)!;
                    const x = toX(item.start);
                    const barWidth =
                      item.intervalWidth === null
                        ? Math.max(item.width, timelineWidth - 14 - x)
                        : item.intervalWidth;
                    return (
                      <MeasuredEvent
                        key={e.id}
                        id={e.id}
                        className={s.eventCard}
                        style={{
                          left: x,
                          top: item.top + Math.max(0, windowRange.y),
                          width: item.width,
                          zIndex:
                            eventDraft?.id === e.id
                              ? 8
                              : eventSelection === e.id
                                ? 4
                                : 2,
                        }}
                        onHeight={(id, height) =>
                          setEventHeights((old) =>
                            old[id] === height ? old : { ...old, [id]: height },
                          )
                        }
                      >
                        <div
                          className={`${s.timeBar} ${e.duration === 0 && e.time.kind !== "window" ? s.timePoint : ""} ${e.time.kind === "window" ? s.timeWindow : ""} ${e.duration === null ? s.timeOpen : ""}`}
                          style={{
                            width:
                              e.time.kind === "window"
                                ? Math.max(
                                    1,
                                    ((resolveTime(data, e).windowEnd ??
                                      item.start) -
                                      item.start) *
                                      scale,
                                  )
                                : barWidth,
                          }}
                          title={
                            e.duration === 0
                              ? "时点"
                              : "真实时间跨度 · 拖动移动"
                          }
                          onPointerDown={(ev) =>
                            startTimeDrag(ev, "events", e.id, "move")
                          }
                        >
                          {x < 14 && (
                            <span
                              className={s.barNote}
                              style={{ left: 14 - x }}
                            >
                              ‹ 起点在视野外
                            </span>
                          )}
                          {item.intervalWidth !== null &&
                            x + item.intervalWidth > timelineWidth - 14 && (
                              <span
                                className={s.barNote}
                                style={{
                                  right: Math.max(
                                    0,
                                    item.intervalWidth -
                                      (timelineWidth - 14 - x),
                                  ),
                                }}
                              >
                                延续到视野外 ›
                              </span>
                            )}
                          {!readonly &&
                            data.events.some(
                              (v) => v.id === e.id && v.line === worldId,
                            ) &&
                            e.duration !== null &&
                            e.duration > 0 &&
                            barWidth >= 36 && (
                              <>
                                <button
                                  aria-label={`调整${e.title}开始`}
                                  onPointerDown={(ev) =>
                                    startTimeDrag(ev, "events", e.id, "start")
                                  }
                                />
                                <button
                                  aria-label={`调整${e.title}结束`}
                                  onPointerDown={(ev) =>
                                    startTimeDrag(ev, "events", e.id, "end")
                                  }
                                />
                              </>
                            )}
                        </div>
                        {eventCard(e)}
                      </MeasuredEvent>
                    );
                  })}
                  {characterLayouts.map((group) => (
                    <section
                      key={group.id}
                      className={s.characterLane}
                      style={{
                        top: group.top + Math.max(0, windowRange.y),
                        height: group.packed.height + 32,
                      }}
                      aria-label={`${query.data?.characters.find((c) => c.id === group.id)?.name ?? "角色"}变化轨道`}
                    >
                      <div className={s.characterLaneTitle}>
                        {chip(group.id)}
                        <span>角色变化</span>
                      </div>
                      {group.packed.items.map((item) => {
                        const change = group.items.find(
                          (c) => c.id === item.id,
                        )!;
                        return (
                          <button
                            key={item.id}
                            className={s.characterChange}
                            style={{
                              left: toX(item.start),
                              top: item.top + 22,
                            }}
                            onClick={() => locateEvent(change.event)}
                          >
                            <small>
                              {labelTime(change.time)} · {change.dimension}
                            </small>
                            <span>
                              {change.before} → {change.after}
                            </span>
                            <small>{change.event.title}</small>
                          </button>
                        );
                      })}
                    </section>
                  ))}
                </div>
              </div>
            )}
            <div className={s.timelineFooter}>
              <span>
                拖动空白处平移 · Ctrl + 滚轮缩放 · Shift + 滚轮横移 ·
                双击卡片原位编辑
              </span>
              <button
                disabled={!eventSelection}
                onClick={() =>
                  setDialog({ kind: "event-detail", id: eventSelection! })
                }
              >
                查看事件详情
              </button>
            </div>

            {changes && (
              <details>
                <summary>角色在视窗末端的状态（无基线的属性保持未知）</summary>
                {characterStatesAt(
                  data,
                  worldId,
                  windowRange.start + windowRange.span,
                ).map((state) => (
                  <p key={`${state.character}/${state.dimension}`}>
                    {chip(state.character)} · {state.dimension}：
                    {state.values.join(" / ")}
                    {state.conflict ? " · 同时变化存在冲突" : ""}
                  </p>
                ))}
              </details>
            )}
            <details>
              <summary>时期与连接列表</summary>
              {[
                ...(activeWorld?.fork?.periods ?? []),
                ...data.periods.filter((p) => p.line === worldId),
              ].map((p) => (
                <button
                  key={p.id}
                  disabled={
                    readonly ||
                    !data.periods.some(
                      (v) => v.id === p.id && v.line === worldId,
                    )
                  }
                  onClick={() => setDialog({ kind: "period-detail", id: p.id })}
                >
                  {p.title}
                </button>
              ))}
              {data.connections
                .filter((c) => c.from.line === worldId || c.to.line === worldId)
                .map((c) => (
                  <button
                    key={c.id}
                    disabled={readonly}
                    onClick={() => setDialog({ kind: "connection", id: c.id })}
                  >
                    {c.title}
                  </button>
                ))}
            </details>
          </>
        )}
      </>
    );
  }
  async function submitDialog(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!dialog) return;
    const fd = new FormData(e.currentTarget),
      title = String(fd.get("title") || ""),
      id = dialog.id || uid();
    let ops: PlanningOperation[] = [];
    if (dialog.kind === "line")
      ops = [
        {
          kind: "put",
          collection: "lines",
          value: {
            id,
            name: title,
            primary:
              data.lines.find((l) => l.id === id)?.primary ??
              !data.lines.length,
          },
        },
      ];
    if (dialog.kind === "world") {
      const previous = data.worlds.find((w) => w.id === id);
      ops = [
        {
          kind: "put",
          collection: "worlds",
          value: {
            id,
            name: title,
            calendar: {
              ...(previous?.calendar || {}),
              epoch: String(fd.get("epoch") || "故事开始"),
              kind: String(fd.get("calendarKind") || "fixed"),
              hoursPerDay:
                fd.get("calendarKind") === "years"
                  ? null
                  : Number(fd.get("day") || 24),
              daysPerMonth:
                fd.get("month") === "" ? null : Number(fd.get("month") || 30),
              monthsPerYear:
                fd.get("year") === "" ? null : Number(fd.get("year") || 12),
            },
            timeBases: fd.get("removeBase")
              ? (previous?.timeBases ?? []).filter(
                  (b) => b.id !== fd.get("baseId"),
                )
              : String(fd.get("baseName") || "").trim()
                ? [
                    ...(previous?.timeBases?.filter(
                      (b) => b.id !== String(fd.get("baseId") || ""),
                    ) ?? []),
                    {
                      id: String(fd.get("baseId") || uid()),
                      name: String(fd.get("baseName")),
                      offset:
                        fd.get("baseOffset") === ""
                          ? null
                          : Number(fd.get("baseOffset")),
                      scale: Number(fd.get("baseScale") || 1),
                      anchor: String(fd.get("baseAnchor") || "") || null,
                      boundary: String(fd.get("baseBoundary") || "start"),
                      calendar: {
                        kind: String(fd.get("baseKind") || "fixed"),
                        epoch: String(fd.get("baseEpoch") || "对应零点"),
                        hoursPerDay: 24,
                        daysPerMonth: null,
                        monthsPerYear: null,
                      },
                    },
                  ]
                : (previous?.timeBases ?? []),
            ...(previous ? {} : { worldId: null }),
          },
        },
      ];
    }
    if (dialog.kind === "volume")
      ops = [
        {
          kind: "put",
          collection: "volumes",
          value: {
            id,
            line: lineId,
            title,
            summary: String(fd.get("summary") || ""),
            order: Number(fd.get("order") ?? data.volumes.length),
          },
        },
      ];
    if (dialog.kind === "chapter")
      ops = [
        {
          kind: "put",
          collection: "chapters",
          value: {
            id,
            line: lineId,
            title,
            volume: String(fd.get("volume") || "") || null,
            order: Number(fd.get("order") ?? data.chapters.length),
            wordMin: Number(fd.get("minimum") ?? 0),
            wordBudget: Number(fd.get("budget") || 3000),
          },
        },
      ];
    if (dialog.kind === "shared-event") {
      const w = String(fd.get("world"));
      ops = [
        {
          kind: "put",
          collection: "events",
          value: {
            id,
            line: w,
            title,
            time: {
              kind: fd.get("eventTime") === "" ? "unknown" : "exact",
              value: Number(fd.get("eventTime") || 0),
            },
          },
        },
      ];
      if (await save(ops)) {
        setDraft((d) =>
          d
            ? {
                ...d,
                tellings: d.tellings.map((t) =>
                  t.id === (activePov[d.id] || d.tellings[0].id)
                    ? {
                        ...t,
                        refs: [
                          ...t.refs,
                          {
                            line: w,
                            event: id,
                            reveal: "",
                            withheld: "",
                            source: "作者构思",
                          },
                        ],
                      }
                    : t,
                ),
              }
            : d,
        );
        setDialog(null);
      }
      return;
    }
    if (dialog.kind === "group")
      ops = [{ kind: "group", ids: selected, id, title }];
    if (dialog.kind === "assign")
      ops = selected.map((id) => ({
        kind: "put",
        collection: "cards",
        value: {
          id,
          chapter: String(fd.get("chapter") || "") || null,
          ...(!fd.get("chapter") ? { wordBudget: null } : {}),
        },
      }));
    if (dialog.kind === "import-card")
      ops = [
        {
          kind: "copy",
          id: String(fd.get("sourceCard")),
          newId: uid(),
          line: lineId,
          parent,
        },
      ];
    if (dialog.kind === "move")
      ops = [
        {
          kind: "move",
          id,
          line: String(fd.get("line")),
          parent: String(fd.get("parent") || "") || null,
          before: null,
        },
      ];
    if (dialog.kind === "delete-card") {
      const n = data.cards.find((c) => c.id === id)!;
      ops = [
        ...children(data, n.line, id).map((c) => ({
          kind: "put" as const,
          collection: "cards" as const,
          value: { id: c.id, parent: n.parent },
        })),
        { kind: "delete", collection: "cards", id },
      ];
    }
    if (dialog.kind === "delete-event")
      ops = [{ kind: "delete", collection: "events", id }];
    if (dialog.kind === "fork")
      ops = [
        { kind: "fork", id: uid(), source: worldId, event: id, name: title },
      ];
    if (dialog.kind === "period")
      ops = [
        {
          kind: "put",
          collection: "periods",
          value: {
            id,
            line: worldId,
            title,
            start: Number(fd.get("start")),
            end:
              fd.get("ongoing") === "on" || fd.get("end") === ""
                ? null
                : Number(fd.get("end")),
            ongoing: fd.get("ongoing") === "on",
            event: String(fd.get("event") || "") || null,
          },
        },
      ];
    if (dialog.kind === "connection") {
      const [fl, fe] = String(fd.get("from")).split("|"),
        [tl, te] = String(fd.get("to")).split("|");
      ops = [
        {
          kind: "put",
          collection: "connections",
          value: {
            id,
            title,
            kind: String(fd.get("kind")),
            from: { line: fl, event: fe },
            to: { line: tl, event: te },
          },
        },
      ];
    }
    if (await save(ops)) {
      if (dialog.kind === "group") setSelected([id]);
      if (dialog.kind === "line") {
        setLine(id);
        setParent(null);
      }
      if (dialog.kind === "world") setWorld(id);
      setDialog(null);
    }
  }
  function renderDialog() {
    if (!dialog) return null;
    if (dialog.kind === "period-detail") {
      const p = [
        ...(activeWorld?.fork?.periods ?? []),
        ...data.periods.filter((p) => p.line === worldId),
      ].find((p) => p.id === dialog.id);
      if (!p) return null;
      const source = p.event ? findEvent(data, worldId, p.event) : null;
      const range = source ? resolveTime(data, source) : p;
      const frozen = !!activeWorld?.fork?.periods.some((v) => v.id === p.id);
      return (
        <div
          className={`${s.dialog} ${s.eventDrawer}`}
          role="dialog"
          aria-modal="true"
          aria-label="时期详情"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDialog(null);
          }}
        >
          <section className={s.detail}>
            <div className={s.cardHead}>
              <h3>{p.title}</h3>
              <button onClick={() => setDialog(null)}>关闭详情</button>
            </div>
            <p>
              {frozen
                ? "冻结前史"
                : source
                  ? `共用事件范围：${source.title}`
                  : "独立时期"}
            </p>
            <p>
              开始：
              {range.start === null ? "未定" : worldTimeLabel(range.start)}
            </p>
            <p>
              结束：
              {range.end === null
                ? p.ongoing
                  ? "持续中"
                  : "结束未定"
                : worldTimeLabel(range.end)}
            </p>
            <button
              disabled={readonly || frozen}
              onClick={() => setDialog({ kind: "period", id: p.id })}
            >
              修改时期
            </button>
          </section>
        </div>
      );
    }
    const frozenPeriod =
      dialog.kind === "period" &&
      activeWorld?.fork?.periods.find((p) => p.id === dialog.id);
    if (frozenPeriod)
      return (
        <div
          className={s.dialog}
          role="dialog"
          aria-modal="true"
          aria-label="冻结时期详情"
        >
          <section className={s.detail}>
            <h3>{frozenPeriod.title}</h3>
            <p>冻结前史 · 源版本 {activeWorld?.fork?.version}</p>
            <p>
              {worldTimeLabel(frozenPeriod.start)} —{" "}
              {frozenPeriod.end === null
                ? "结束未定"
                : worldTimeLabel(frozenPeriod.end)}
            </p>
            <button onClick={() => setDialog(null)}>关闭</button>
          </section>
        </div>
      );
    if (dialog.kind === "event-detail") {
      const event = findEvent(data, worldId, dialog.id!);
      if (!event) return null;
      const time = resolveTime(data, event);
      return (
        <div
          className={`${s.dialog} ${s.eventDrawer}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) setDialog(null);
          }}
          role="dialog"
          aria-modal="true"
          aria-label="事件详情"
        >
          <section className={s.detail}>
            <h3>{event.title}</h3>
            <p>
              {activeWorld?.name} · {time.start ?? "未定"} —{" "}
              {time.end ?? time.windowEnd ?? "未定"}{" "}
              {timeUnit(activeWorld!.calendar)}
            </p>
            <MarkdownPreview source={event.fact} />
            {materialNotes(event.materialRefs)}
            <div className={s.pills}>
              {event.people.map((id) => (
                <span className={s.pill} key={id}>
                  {chip(id)}
                </span>
              ))}
            </div>
            {event.changes.map((c) => (
              <p key={c.id}>
                {query.data?.characters.find((p) => p.id === c.character)
                  ?.name || "未知角色"}{" "}
                · {c.dimension} · {c.at === "end" ? "结束时" : "开始时"}：
                {c.before} → {c.after}
              </p>
            ))}
            <button onClick={() => setDialog(null)}>关闭详情</button>
          </section>
        </div>
      );
    }
    const mapping = data.worlds
      .find((w) => w.id === dialog.id)
      ?.timeBases?.find((b) => b.id === mappingEdit);
    const titles: Record<string, string> = {
        "shared-event": "创建并引用同一共享事件",
        line: "叙事线设置",
        world: "世界线设置",
        volume: "卷设置",
        chapter: "章节设置",
        group: "归组所选",
        assign: "分配卷章",
        move: "移动卡片",
        "import-card": "从其他线引入",
        "delete-card": "删除卡片 / 取消分组",
        "delete-event": "删除事件",
        fork: "建立历史分支",
        period: "时期设置",
        connection: "跨世界连接",
      },
      previous =
        dialog.kind === "world"
          ? data.worlds.find((w) => w.id === dialog.id)
          : null,
      ch = data.chapters.find((c) => c.id === dialog.id),
      v = data.volumes.find((v) => v.id === dialog.id),
      p = data.periods.find((p) => p.id === dialog.id),
      connection = data.connections.find((c) => c.id === dialog.id);
    return (
      <div
        className={s.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={titles[dialog.kind]}
      >
        <form onSubmit={submitDialog}>
          <h3>{titles[dialog.kind]}</h3>
          {dialog.id &&
            [
              "line",
              "world",
              "volume",
              "chapter",
              "period",
              "connection",
            ].includes(dialog.kind) && (
              <button
                type="button"
                disabled={readonly}
                onClick={async () => {
                  const collection = (
                    {
                      line: "lines",
                      world: "worlds",
                      volume: "volumes",
                      chapter: "chapters",
                      period: "periods",
                      connection: "connections",
                    } as const
                  )[dialog.kind as "line"];
                  if (
                    await save([{ kind: "delete", collection, id: dialog.id! }])
                  )
                    setDialog(null);
                }}
              >
                删除（有引用时先解除，可撤销）
              </button>
            )}
          {![
            "assign",
            "move",
            "import-card",
            "delete-card",
            "delete-event",
          ].includes(dialog.kind) && (
            <label>
              名称
              <input
                name="title"
                required
                defaultValue={
                  previous?.name ||
                  data.lines.find((l) => l.id === dialog.id)?.name ||
                  ch?.title ||
                  v?.title ||
                  p?.title ||
                  connection?.title ||
                  ""
                }
              />
            </label>
          )}
          {dialog.kind === "shared-event" && (
            <>
              <label>
                所属世界线
                <select name="world">
                  {data.worlds.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                开始时间（留空待定）
                <input name="eventTime" type="number" />
              </label>
              <p>
                创建同一份共享事件；本卡披露内容另行填写。之后可在世界线补充事实。
              </p>
            </>
          )}
          {dialog.kind === "world" && (
            <>
              <label>
                历法类型
                <select
                  name="calendarKind"
                  defaultValue={previous?.calendar.kind || "fixed"}
                >
                  <option value="fixed">固定单位换算</option>
                  <option value="gregorian">公历（零点填写 ISO 日期）</option>
                  <option value="years">仅定义年</option>
                </select>
              </label>
              <label>
                参考零点
                <input
                  name="epoch"
                  defaultValue={previous?.calendar.epoch || "故事开始"}
                />
              </label>
              <label>
                一天的小时数
                <input
                  name="day"
                  type="number"
                  min="1"
                  defaultValue={previous?.calendar.hoursPerDay || 24}
                />
              </label>
            </>
          )}
          {dialog.kind === "world" && (
            <>
              <label>
                一月天数（留空未知）
                <input
                  name="month"
                  type="number"
                  min="1"
                  defaultValue={previous?.calendar.daysPerMonth ?? ""}
                />
              </label>
              <label>
                一年月数（留空未知）
                <input
                  name="year"
                  type="number"
                  min="1"
                  defaultValue={previous?.calendar.monthsPerYear ?? ""}
                />
              </label>
            </>
          )}
          {dialog.kind === "world" && (
            <details>
              <summary>添加或修改时间基准映射</summary>
              <p>只改变刻度显示，不移动事件。对应值留空即保留未知。</p>
              <label>
                时间基准
                <select
                  name="baseId"
                  value={mappingEdit}
                  onChange={(e) => setMappingEdit(e.target.value)}
                >
                  <option value="">新增基准</option>
                  {previous?.timeBases?.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <div key={mapping?.id || "new"}>
                <label>
                  参考点
                  <select
                    name="baseAnchor"
                    defaultValue={mapping?.anchor || ""}
                  >
                    <option value="">本世界零点</option>
                    {previous &&
                      worldEvents(data, previous.id).map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.title}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  事件参考边界
                  <select
                    name="baseBoundary"
                    defaultValue={mapping?.boundary || "start"}
                  >
                    <option value="start">开始</option>
                    <option value="end">结束</option>
                  </select>
                </label>
                {mapping && (
                  <label>
                    <input type="checkbox" name="removeBase" />
                    删除此时间基准
                  </label>
                )}

                <label>
                  基准名称
                  <input
                    name="baseName"
                    defaultValue={mapping?.name || ""}
                    placeholder="公元 / 大乾 / 星际 / 事件参考"
                  />
                </label>
                <label>
                  历法
                  <select
                    name="baseKind"
                    defaultValue={mapping?.calendar.kind || "fixed"}
                  >
                    <option value="fixed">相对小时</option>
                    <option value="gregorian">公历</option>
                    <option value="years">年</option>
                  </select>
                </label>
                <label>
                  显示零点
                  <input
                    name="baseEpoch"
                    defaultValue={mapping?.calendar.epoch || ""}
                    placeholder="公历示例：2000-01-01T00:00:00Z"
                  />
                </label>
                <label>
                  参考点对应值（留空未知）
                  <input
                    type="number"
                    step="any"
                    name="baseOffset"
                    defaultValue={mapping?.offset ?? ""}
                  />
                </label>
                <label>
                  本线一单位对应多少显示单位
                  <input
                    type="number"
                    step="any"
                    min="0.000001"
                    name="baseScale"
                    defaultValue={mapping?.scale ?? 1}
                  />
                </label>
              </div>
            </details>
          )}
          {dialog.kind === "import-card" && (
            <>
              <label>
                来源卡片
                <select name="sourceCard" required>
                  {data.cards
                    .filter((c) => c.line !== lineId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {data.lines.find((l) => l.id === c.line)?.name} ·{" "}
                        {c.title}
                      </option>
                    ))}
                </select>
              </label>
              <p>
                复制为本线当前层的独立卡片并保留子树，共用原事件事实。不会改变来源线，也不继承来源卷章。
              </p>
            </>
          )}
          {dialog.kind === "volume" && (
            <label>
              卷概要
              <input name="summary" defaultValue={v?.summary || ""} />
            </label>
          )}
          {["chapter", "volume"].includes(dialog.kind) && (
            <label>
              编排序号（从0开始）
              <input
                name="order"
                type="number"
                min="0"
                defaultValue={
                  ch?.order ??
                  v?.order ??
                  (dialog.kind === "chapter"
                    ? data.chapters.length
                    : data.volumes.length)
                }
              />
            </label>
          )}
          {dialog.kind === "chapter" && (
            <>
              <label>
                所属卷
                <select
                  name="volume"
                  defaultValue={ch?.volume ?? dialog.volume ?? ""}
                >
                  <option value="">未分卷</option>
                  {data.volumes
                    .filter((v) => v.line === lineId)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.title}
                      </option>
                    ))}
                </select>
              </label>
              <ChapterRangeFields
                key={ch?.id || "new"}
                minimum={ch?.wordMin ?? 2000}
                maximum={ch?.wordBudget ?? 3000}
              />
            </>
          )}
          {dialog.kind === "group" && (
            <p>
              所选 {selected.length}{" "}
              张卡片按当前顺序集中到首张所选位置，成为新父卡片的子卡片。非连续选择会跨过未选内容；其余卡片相对顺序不变。
            </p>
          )}
          {dialog.kind === "assign" && (
            <label>
              归属章节
              <select name="chapter">
                <option value="">未分章</option>
                {data.chapters
                  .filter((c) => c.line === lineId)
                  .map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {ch.title}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {dialog.kind === "move" && (
            <>
              <select aria-label="目标叙事线" name="line" defaultValue={lineId}>
                {data.lines.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <select aria-label="目标父卡片" name="parent">
                <option value="">根层</option>
                {data.cards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {data.lines.find((l) => l.id === c.line)?.name} · {c.title}
                  </option>
                ))}
              </select>
              <p>跨线移动保留子树和引用，清除原线卷章归属。</p>
            </>
          )}
          {dialog.kind.startsWith("delete") && (
            <p>
              {dialog.kind === "delete-event"
                ? "删除该事件；存在叙事引用、子事件或时间依赖时会阻止删除。删除后可撤销恢复。"
                : "父卡片的直接子卡片会提升一级；共享事件、正文和历史保留。"}
            </p>
          )}
          {dialog.kind === "fork" && (
            <p>冻结所选事件结束之前的完整历史，不复制未来，也不改原世界。</p>
          )}
          {dialog.kind === "period" && (
            <>
              <label>
                开始（{timeUnit(activeWorld!.calendar)}）
                <input
                  type="number"
                  name="start"
                  defaultValue={dialog.rangeDraft?.start ?? p?.start ?? 0}
                />
              </label>
              <label>
                结束（留空未定）
                <input
                  type="number"
                  name="end"
                  defaultValue={
                    dialog.rangeDraft
                      ? (dialog.rangeDraft.end ?? "")
                      : (p?.end ?? "")
                  }
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  name="ongoing"
                  defaultChecked={p?.ongoing ?? false}
                />
                持续中（结束时间保持未定）
              </label>
              <label>
                或共用事件范围
                <select name="event" defaultValue={p?.event || ""}>
                  <option value="">独立时期</option>
                  {worldEvents(data, worldId).map((e) => (
                    <option value={e.id} key={e.id}>
                      {e.title}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {dialog.kind === "connection" && (
            <>
              <select
                name="kind"
                aria-label="连接类型"
                defaultValue={connection?.kind}
              >
                <option>穿越 / 虫洞</option>
                <option>同一历史回返</option>
              </select>
              {["from", "to"].map((key) => (
                <label key={key}>
                  {key === "from" ? "离开事件" : "抵达事件"}
                  <select
                    name={key}
                    required
                    defaultValue={
                      connection
                        ? `${connection[key as "from" | "to"].line}|${connection[key as "from" | "to"].event}`
                        : undefined
                    }
                  >
                    {data.worlds.flatMap((w) =>
                      worldEvents(data, w.id).map((e) => (
                        <option
                          key={`${w.id}|${e.id}`}
                          value={`${w.id}|${e.id}`}
                        >
                          {w.name} · {e.title}
                        </option>
                      )),
                    )}
                  </select>
                </label>
              ))}
            </>
          )}
          <div className={s.footer}>
            <button type="button" onClick={() => setDialog(null)}>
              取消
            </button>
            <button disabled={readonly}>确认</button>
          </div>
          {message && <p role="alert">{message}</p>}
        </form>
      </div>
    );
  }
  if (query.isPending)
    return <div className={s.workspace}>加载世界线与叙事线…</div>;
  if (query.error)
    return (
      <div className={s.workspace}>
        <p role="alert">{query.error.message}</p>
        <button onClick={() => void query.refetch()}>重试</button>
      </div>
    );
  return (
    <div
      className={`${s.workspace} ${mode === "world" ? s.worldWorkspace : ""}`}
    >
      <header className={s.toolbar}>
        <h2>
          {mode === "world"
            ? "世界线"
            : mode === "projection"
              ? "大纲"
              : "叙事线"}
        </h2>
        <small>
          版本 {query.data?.version} ·{" "}
          {mode === "projection"
            ? "只读投影"
            : query.data?.readonly
              ? "只读"
              : "修改保存到当前作品"}
        </small>
        {mode !== "projection" && (
          <button
            disabled={
              readonly ||
              !planningUndoTarget(
                query.data?.history ?? [],
                query.data?.version ?? 0,
              )
            }
            onClick={async () => {
              const h = planningUndoTarget(
                query.data?.history ?? [],
                query.data?.version ?? 0,
              );
              if (h) await save([], { action: "restore", snapshotId: h.id });
            }}
          >
            撤销上次规划修改
          </button>
        )}
      </header>
      {message && (
        <div className={s.notice} role="status">
          {message}
        </div>
      )}
      {mode === "world" ? (
        renderWorld()
      ) : (
        <>
          <div className={s.toolbar}>
            <select
              aria-label="当前叙事线"
              value={lineId}
              onChange={(e) => {
                setLine(e.target.value);
                setParent(null);
                setSelected([]);
              }}
            >
              {data.lines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.primary ? " · 主" : ""}
                </option>
              ))}
            </select>
            {mode !== "projection" && (
              <>
                <button
                  disabled={readonly}
                  onClick={() => setDialog({ kind: "line" })}
                >
                  ＋ 叙事线
                </button>
                <button
                  disabled={readonly || !lineId}
                  onClick={() => setDialog({ kind: "line", id: lineId })}
                >
                  叙事线设置
                </button>
                <button
                  disabled={readonly || !lineId || activeLine?.primary}
                  onClick={() =>
                    void save(
                      data.lines.map((l) => ({
                        kind: "put",
                        collection: "lines",
                        value: { id: l.id, primary: l.id === lineId },
                      })),
                    )
                  }
                >
                  设为主叙事线
                </button>
                <button
                  onClick={() => {
                    setView("cards");
                    setSelected([]);
                  }}
                  aria-pressed={view === "cards"}
                >
                  结构编排
                </button>
                <button
                  onClick={() => {
                    setView("chapters");
                    setSelected([]);
                  }}
                  aria-pressed={view === "chapters"}
                >
                  卷章大纲
                </button>
                <button
                  onClick={() => setView("preview")}
                  aria-pressed={view === "preview"}
                >
                  披露预览
                </button>
              </>
            )}
          </div>
          {!data.lines.length ? (
            <div className={s.empty}>
              <p>
                可以先写细纲，再安排卷章。已有大纲可接入，正文与历史保持不变。
              </p>
              <button
                disabled={readonly}
                onClick={() => void save([], { action: "import" })}
              >
                接入已有大纲 / 开始构思
              </button>
            </div>
          ) : mode === "projection" ? (
            renderChapters(true)
          ) : (
            <div className={s.layout}>
              <aside className={s.tree}>
                {data.lines.map((l) => (
                  <section key={l.id}>
                    <button
                      className={s.rootLine}
                      aria-label={`打开叙事线：${l.name}`}
                      aria-current={
                        lineId === l.id && parent === null && view === "cards"
                          ? "page"
                          : undefined
                      }
                      onClick={(e) => {
                        e.currentTarget
                          .closest(`.${s.workspace}`)
                          ?.scrollTo({ top: 0 });
                        setDraft(null);
                        setMessage("");
                        setClosed((ids) =>
                          ids.filter(
                            (id) =>
                              !data.cards.some(
                                (c) => c.line === l.id && c.id === id,
                              ),
                          ),
                        );
                        setLine(l.id);
                        setParent(null);
                        setSelected([]);
                        setView("cards");
                      }}
                    >
                      <BookOpen size={14} style={{ display: "inline" }} />{" "}
                      {l.name}
                    </button>
                    {treeNodes(null, l.id)}
                  </section>
                ))}
              </aside>
              <main>
                {view === "chapters" ? (
                  renderChapters()
                ) : view === "preview" ? (
                  <div>
                    {readingCards(data, lineId).flatMap((c) =>
                      c.tellings.map((t) => (
                        <section key={t.id} className={s.chapter}>
                          <h3>
                            {c.title} · {t.narrator}
                          </h3>
                          <p>{t.intent}</p>
                          {t.refs.map((r, i) => (
                            <p key={i}>{r.reveal}</p>
                          ))}
                        </section>
                      )),
                    )}
                  </div>
                ) : (
                  <>
                    <nav className={s.breadcrumbs} aria-label="叙事层级">
                      <ol>
                        <li>
                          <BookOpen size={15} aria-hidden="true" />
                          <button
                            title={activeLine?.name}
                            aria-current={parent ? undefined : "page"}
                            onClick={() => {
                              setParent(null);
                              setSelected([]);
                            }}
                          >
                            {activeLine?.name}
                          </button>
                        </li>
                        {narrativePath.map((card, index) => (
                          <li key={card.id}>
                            <ChevronRight size={13} aria-hidden="true" />
                            {index === narrativePath.length - 1 ? (
                              <span aria-current="page" title={card.title}>
                                {card.title}
                              </span>
                            ) : (
                              <button
                                title={card.title}
                                onClick={() => {
                                  setParent(card.id);
                                  setSelected([]);
                                }}
                              >
                                {card.title}
                              </button>
                            )}
                          </li>
                        ))}
                      </ol>
                    </nav>
                    <div className={s.toolbar}>
                      <button disabled={readonly} onClick={() => addCard()}>
                        ＋ 卡片
                      </button>
                      <button
                        disabled={readonly || selected.length < 2}
                        onClick={() => setDialog({ kind: "group" })}
                      >
                        归组所选
                      </button>
                      <button
                        disabled={readonly || !selected.length}
                        onClick={() => setDialog({ kind: "assign" })}
                      >
                        分配卷章
                      </button>
                      <button
                        disabled={
                          readonly || !data.cards.some((c) => c.line !== lineId)
                        }
                        onClick={() => setDialog({ kind: "import-card" })}
                      >
                        从其他线引入
                      </button>
                      <small>已选 {selected.length} 张</small>
                      {!!selected.length && (
                        <button onClick={() => setSelected([])}>
                          取消选择
                        </button>
                      )}
                    </div>
                    <div className={s.cards}>
                      {siblings.map((c, i) => (
                        <div key={c.id}>
                          <button
                            className={s.insert}
                            aria-label={`在${c.title}之前插入卡片`}
                            data-drop-before={c.id}
                            disabled={readonly || !!draft}
                            onDragOver={(e) => {
                              if (dragId) e.preventDefault();
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              if (dragId && dragId !== c.id)
                                void save([
                                  {
                                    kind: "move",
                                    id: dragId,
                                    line: lineId,
                                    parent,
                                    before: c.id,
                                  },
                                ]);
                              setDragId(null);
                            }}
                            onClick={() => addCard(c.id)}
                          >
                            ＋
                          </button>
                          {draft &&
                            !data.cards.some((c) => c.id === draft.id) &&
                            newBefore.current === c.id && (
                              <div style={{ marginBottom: 30 }}>
                                {cardEditor()}
                              </div>
                            )}
                          {draft?.id === c.id ? cardEditor() : renderCard(c, i)}
                        </div>
                      ))}
                      {draft &&
                        !data.cards.some((c) => c.id === draft.id) &&
                        !newBefore.current &&
                        cardEditor()}
                      <button
                        className={s.insert}
                        aria-label="在末尾插入卡片"
                        data-drop-before=""
                        disabled={readonly || !!draft}
                        onDragOver={(e) => {
                          if (dragId) e.preventDefault();
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (dragId && siblings.at(-1)?.id !== dragId)
                            void save([
                              {
                                kind: "move",
                                id: dragId,
                                line: lineId,
                                parent,
                                before: null,
                              },
                            ]);
                          setDragId(null);
                        }}
                        onClick={() => addCard()}
                      >
                        ＋
                      </button>
                    </div>
                    <p className={s.muted}>
                      单击选择 · Shift单击多选同层 · 拖动换序 · 双击原位编辑
                    </p>
                  </>
                )}
              </main>
            </div>
          )}
        </>
      )}
      {!!query.data?.proposals?.length && mode !== "projection" && (
        <details>
          <summary>AI规划建议（采用前不改变事实）</summary>
          {query.data.proposals.map((p) => (
            <section className={s.chapter} key={p.id}>
              <p>规划修改建议 · 采用后同步世界线、叙事线和卷章投影</p>
              <ul>
                {(
                  (p.snapshot as { operations?: PlanningOperation[] })
                    .operations ?? []
                ).map((op, i) => (
                  <li key={i}>
                    {op.kind === "put"
                      ? `${{ worlds: "世界线", lines: "叙事线", events: "事件", periods: "时期", cards: "卡片", volumes: "卷", chapters: "章", connections: "世界连接" }[op.collection]}：${String(op.value.title || op.value.name || (data[op.collection].find((v) => v.id === op.value.id) && ("title" in data[op.collection].find((v) => v.id === op.value.id)! ? (data[op.collection].find((v) => v.id === op.value.id)! as { title: string }).title : (data[op.collection].find((v) => v.id === op.value.id)! as { name: string }).name)) || "已有条目")}`
                      : op.kind === "delete"
                        ? `删除：${op.id}`
                        : op.kind === "group"
                          ? `归组${op.ids.length}张卡片：${op.title}`
                          : op.kind === "fork"
                            ? `历史分支：${op.name}`
                            : `${op.kind === "copy" ? "复制" : "移动"}卡片：${op.id}`}
                  </li>
                ))}
              </ul>
              <details>
                <summary>查看叙述与披露内容</summary>
                {(
                  (p.snapshot as { operations?: PlanningOperation[] })
                    .operations ?? []
                )
                  .filter((op) => op.kind === "put")
                  .map((op, i) =>
                    op.kind === "put" ? (
                      <section key={i}>
                        <strong>
                          {String(op.value.title || op.value.name || "")}
                        </strong>
                        {typeof op.value.fact === "string" && (
                          <p>{op.value.fact}</p>
                        )}
                        {Array.isArray(op.value.materialRefs) && materialNotes(op.value.materialRefs.flatMap(r => { const parsed = materialRefSchema.safeParse(r); return parsed.success ? [parsed.data] : []; }))}
                        {Array.isArray(op.value.tellings) &&
                          op.value.tellings.map((t, j) => {
                            const telling = tellingSchema.safeParse(t);
                            return telling.success ? (
                              <div key={j}>
                                <p>
                                  {telling.data.narrator} ·{" "}
                                  {telling.data.reliability}：
                                  {telling.data.intent}
                                </p>
                                {materialNotes(telling.data.materialRefs)}
                                {telling.data.refs.map((r, k) => (
                                  <p key={k}>
                                    披露：{r.reveal}；保留：{r.withheld}
                                  </p>
                                ))}
                              </div>
                            ) : null;
                          })}
                      </section>
                    ) : null,
                  )}
              </details>
              <button
                disabled={readonly}
                onClick={() =>
                  void save([], { action: "apply-proposal", proposalId: p.id })
                }
              >
                采用此建议
              </button>
            </section>
          ))}
        </details>
      )}
      {renderDialog()}
    </div>
  );
}
function chineseOrdinal(n: number): string {
  const digits = "零一二三四五六七八九";
  if (n < 10) return digits[n];
  if (n < 100)
    return `${n < 20 ? "" : digits[Math.floor(n / 10)]}十${n % 10 ? digits[n % 10] : ""}`;
  return String(n);
}
function WordRange({
  title,
  minimum,
  maximum,
  disabled,
  onChange,
}: {
  title: string;
  minimum: number;
  maximum: number;
  disabled?: boolean;
  onChange: (min: number, max: number) => void;
}) {
  const scale = Math.min(
    200000,
    Math.max(10000, Math.ceil(Math.max(minimum, maximum) / 1000) * 1000),
  );
  return (
    <div className={s.wordRange}>
      <div className={s.row}>
        <label>
          下限{" "}
          <input
            name="minimum"
            type="number"
            min="0"
            max="200000"
            required
            aria-label={`${title}字数下限`}
            value={minimum}
            disabled={disabled}
            onChange={(e) => onChange(Number(e.target.value), maximum)}
          />
        </label>
        <span className={s.muted}>至</span>
        <label>
          上限{" "}
          <input
            name="budget"
            type="number"
            min="1"
            max="200000"
            required
            aria-label={`${title}字数上限`}
            value={maximum}
            disabled={disabled}
            onChange={(e) => onChange(minimum, Number(e.target.value))}
          />
        </label>
        <span className={s.muted}>字</span>
      </div>
      <Slider.Root
        className={s.rangeRoot}
        min={0}
        max={scale}
        step={100}
        disabled={disabled}
        value={[
          Math.max(0, Math.min(minimum, maximum, scale)),
          Math.max(0, Math.min(maximum, scale)),
        ]}
        onValueChange={(values) => onChange(values[0], Math.max(1, values[1]))}
      >
        <Slider.Control className={s.rangeControl}>
          <Slider.Track className={s.rangeTrack}>
            <Slider.Indicator className={s.rangeIndicator} />
          </Slider.Track>
          <Slider.Thumb
            index={0}
            className={s.rangeThumb}
            aria-label={`${title}下限滑块`}
          />
          <Slider.Thumb
            index={1}
            className={s.rangeThumb}
            aria-label={`${title}上限滑块`}
          />
        </Slider.Control>
      </Slider.Root>
      {minimum > maximum && (
        <span role="alert" className={s.error}>
          下限不能超过上限
        </span>
      )}
    </div>
  );
}
function ChapterRangeFields({
  minimum,
  maximum,
}: {
  minimum: number;
  maximum: number;
}) {
  const [range, setRange] = useState([minimum, maximum]);
  return (
    <WordRange
      title="章节"
      minimum={range[0]}
      maximum={range[1]}
      onChange={(min, max) => setRange([min, max])}
    />
  );
}
function BudgetForm({
  title,
  chapterId,
  minimum,
  budget,
  cards,
  allCards,
  expanded,
  onToggle,
  disabled,
  onSave,
  onLocate,
}: {
  title: string;
  chapterId: string;
  minimum: number;
  budget: number;
  cards: NarrativeCard[];
  allCards: NarrativeCard[];
  expanded: boolean;
  onToggle: () => void;
  disabled: boolean;
  onSave: (
    minimum: number,
    budget: number,
    alloc: { id: string; wordBudget: number | null }[],
  ) => Promise<boolean>;
  onLocate: (c: NarrativeCard) => void;
}) {
  const [range, setRange] = useState([minimum, budget]),
    [amounts, setAmounts] = useState<Record<string, string>>(
      Object.fromEntries(
        cards.map((c) => [c.id, c.wordBudget?.toString() ?? ""]),
      ),
    );
  const allocated = Object.values(amounts).reduce(
    (sum, v) => sum + Number(v || 0),
    0,
  );
  const depthOf = (c: NarrativeCard) => {
    let depth = 0,
      parent = c.parent;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const ancestor = allCards.find((a) => a.id === parent);
      if (!ancestor) break;
      depth++;
      parent = ancestor.parent;
    }
    return depth;
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(
          range[0],
          range[1],
          cards.map((c) => ({
            id: c.id,
            wordBudget: amounts[c.id] === "" ? null : Number(amounts[c.id]),
          })),
        );
      }}
    >
      <div className={s.budget}>
        <WordRange
          title={title}
          minimum={range[0]}
          maximum={range[1]}
          disabled={disabled}
          onChange={(min, max) => setRange([min, max])}
        />
        <span className={s.muted}>
          已分配 {allocated} · 上限余量 {range[1] - allocated}
        </span>
      </div>
      <div className={s.chapterDisclosure}>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={`chapter-cards-${chapterId}`}
          onClick={onToggle}
        >
          <ChevronRight
            size={14}
            className={expanded ? s.expandedChevron : undefined}
          />
          {expanded ? "收起" : "展开"} {allCards.length} 张叙事卡片
        </button>
        <span className={s.muted}>
          双击章节卡片也可{expanded ? "收起" : "展开"}
        </span>
      </div>
      <div id={`chapter-cards-${chapterId}`} hidden={!expanded}>
        {!allCards.length && (
          <p className={s.empty}>
            本章尚未分配叙事卡片，可在结构编排中选择卡片后分配到本章。
          </p>
        )}
        {allCards.map((c) => (
          <article
            key={c.id}
            className={s.chapterStory}
            style={{ marginInlineStart: Math.min(5, depthOf(c)) * 16 }}
            aria-label={c.title}
          >
            <div className={s.row}>
              <strong>{c.title}</strong>
              <span className={s.muted}>
                {cards.some((a) => a.id === c.id) ? "讲述内容" : "构思概要"}
              </span>
            </div>
            {c.tellings.map((t) => (
              <div className={s.chapterTelling} key={t.id}>
                <span className={s.muted}>{t.narrator || "待定视角"}</span>
                {t.intent && <p>{t.intent}</p>}
                {t.refs.map(
                  (r, i) =>
                    r.reveal && (
                      <p className={s.muted} key={i}>
                        {r.reveal}
                      </p>
                    ),
                )}
              </div>
            ))}
            <div className={s.row}>
              {cards.some((a) => a.id === c.id) && (
                <label>
                  字数{" "}
                  <input
                    aria-label={`${c.title}字数预算`}
                    type="number"
                    min="1"
                    max="200000"
                    placeholder="AI分配"
                    value={amounts[c.id]}
                    disabled={disabled}
                    onChange={(e) => {
                      const value = e.target.value;
                      setAmounts((v) => ({ ...v, [c.id]: value }));
                    }}
                  />
                </label>
              )}
              <button type="button" onClick={() => onLocate(c)}>
                定位卡片
              </button>
            </div>
          </article>
        ))}
      </div>
      <button disabled={disabled || range[0] > range[1]}>保存字数范围</button>
    </form>
  );
}
