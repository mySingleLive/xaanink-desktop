import {
  findEvent,
  resolveTime,
  worldEvents,
  type PlanningData,
} from "./domain";

/** No baseline is inferred from a character's current profile. Conflicting concurrent changes stay visible. */
export function characterStatesAt(
  data: PlanningData,
  line: string,
  at: number,
) {
  const groups = new Map<
    string,
    {
      character: string;
      dimension: string;
      time: number;
      values: string[];
      events: string[];
    }
  >();
  for (const event of worldEvents(data, line))
    for (const change of event.changes) {
      const resolved = resolveTime(data, event),
        time = resolved[change.at];
      if (time === null || time > at || event.time.kind !== "exact") continue;
      const key = `${change.character}/${change.dimension}`,
        old = groups.get(key);
      if (!old || time > old.time)
        groups.set(key, {
          character: change.character,
          dimension: change.dimension,
          time,
          values: [change.after],
          events: [event.id],
        });
      else if (time === old.time) {
        old.values = [...new Set([...old.values, change.after])];
        old.events.push(event.id);
      }
    }
  return [...groups.values()].map((s) => ({
    ...s,
    conflict: s.values.length > 1,
  }));
}
export type Calendar = PlanningData["worlds"][number]["calendar"];
export function timeUnit(calendar: Calendar) {
  return calendar.kind === "years" ? "年" : "小时";
}
export function formatTime(value: number, calendar: Calendar, span: number) {
  if (calendar.kind === "years") return `${+value.toFixed(3)}年`;
  if (calendar.kind === "gregorian") {
    const epoch = Date.parse(calendar.epoch);
    if (Number.isFinite(epoch)) {
      const d = new Date(epoch + value * 3600000);
      if (Number.isFinite(d.valueOf()))
        return d
          .toISOString()
          .slice(0, span < 48 ? 16 : 10)
          .replace("T", " ");
    }
    return `${+value.toFixed(2)}小时（未映射）`;
  }
  const day = calendar.hoursPerDay,
    month = day && calendar.daysPerMonth ? day * calendar.daysPerMonth : null,
    year =
      month && calendar.monthsPerYear ? month * calendar.monthsPerYear : null;
  const [divisor, label] =
    year && span > year * 3
      ? [year, "年"]
      : month && span > month * 3
        ? [month, "个月"]
        : day && span > day * 3
          ? [day, "天"]
          : [1, "小时"];
  return `${value < 0 ? "前" : "后"}${+Math.abs(value / divisor).toFixed(2)}${label}`;
}
export function zoomAt(
  start: number,
  span: number,
  factor: number,
  ratio: number,
) {
  const next = Math.max(0.001, Math.min(1e12, span * factor));
  return { start: start + span * ratio - next * ratio, span: next };
}

/** Display mappings never mutate canonical event coordinates. Uncertain anchors stay unknown. */
export function timeBaseValue(
  data: PlanningData,
  world: string,
  base: PlanningData["worlds"][number]["timeBases"][number],
  value: number,
): number | null {
  if (base.offset === null) return null;
  let origin = 0;
  if (base.anchor) {
    const event = findEvent(data, world, base.anchor);
    if (!event || event.time.kind !== "exact") return null;
    const at = resolveTime(data, event)[base.boundary];
    if (at === null) return null;
    origin = at;
  }
  return (value - origin) * base.scale + base.offset;
}

export function constrainWindow<T extends { start: number; span: number }>(
  view: T,
  bounds: { start: number; end: number } | null,
): T {
  if (!bounds) return view;
  const span = Math.min(view.span, bounds.end - bounds.start);
  const start = Math.max(bounds.start, Math.min(view.start, bounds.end - span));
  return start === view.start && span === view.span
    ? view
    : { ...view, start, span };
}

export const EVENT_CARD_MIN_WIDTH = 320;
export const EVENT_CARD_MIN_HEIGHT = 190;

export function fitTimelineWindow(
  items: { start: number; end: number | null }[],
  width: number,
) {
  if (!items.length) return { start: 0, span: 240 };
  const first = Math.min(...items.map((i) => i.start));
  const lastStart = Math.max(...items.map((i) => i.start));
  const lastEnd = Math.max(...items.map((i) => i.end ?? i.start));
  const readable = Math.min(0.85, EVENT_CARD_MIN_WIDTH / Math.max(1, width));
  const span = Math.max(
    24,
    (lastEnd - first) / 0.9,
    (lastStart - first) / Math.max(0.05, 0.95 - readable),
  );
  return { start: first - span * 0.05, span };
}

/** Pack full reading surfaces, not just temporal intervals. World coordinates make
 * the lane assignment invariant under panning. Measured heights include the bar. */
export function layoutTimelineCards(
  items: { id: string; start: number; end: number | null; height?: number }[],
  pixelsPerUnit: number,
  minWidth = EVENT_CARD_MIN_WIDTH,
) {
  const rows: { right: number; height: number }[] = [];
  const packed = [...items]
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
    .map((item) => {
      const x = item.start * pixelsPerUnit;
      const intervalWidth =
        item.end === null
          ? null
          : Math.max(0, (item.end - item.start) * pixelsPerUnit);
      const width = Math.max(minWidth, intervalWidth ?? 0);
      let row = rows.findIndex((r) => r.right + 24 <= x);
      if (row < 0) {
        row = rows.length;
        rows.push({ right: -Infinity, height: 0 });
      }
      rows[row].right = x + width;
      rows[row].height = Math.max(
        rows[row].height,
        item.height ?? EVENT_CARD_MIN_HEIGHT + 24,
      );
      return { ...item, x, width, intervalWidth, row };
    });
  const tops: number[] = [];
  let height = 24;
  for (const row of rows) {
    tops.push(height);
    height += row.height + 24;
  }
  return {
    items: packed.map((item) => ({ ...item, top: tops[item.row] })),
    height,
  };
}

/** Round ticks in explicitly configured calendar units, rather than eight arbitrary decimals. */
export function timelineTicks(
  start: number,
  span: number,
  calendar: Calendar,
  width: number,
) {
  const target = span / Math.max(2, Math.floor(width / 120));
  const day = calendar.kind === "years" ? null : calendar.hoursPerDay;
  const month =
    day && calendar.daysPerMonth ? day * calendar.daysPerMonth : null;
  const year =
    month && calendar.monthsPerYear ? month * calendar.monthsPerYear : null;
  const unit =
    year && target >= year
      ? year
      : month && target >= month
        ? month
        : day && target >= day
          ? day
          : 1;
  const raw = target / unit;
  const power = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-12)));
  const step =
    ([1, 2, 5, 10].find((n) => n * power >= raw) ?? 10) * power * unit;
  const ticks: number[] = [];
  for (
    let i = Math.ceil(start / step);
    i * step <= start + span && ticks.length < 100;
    i++
  )
    ticks.push(Number((i * step).toPrecision(12)));
  return ticks;
}

/** Snap dragging to readable increments at the current scale; preserve fractional source offsets. */
export function snapTimelineDelta(
  delta: number,
  span: number,
  width: number,
  years = false,
) {
  const minimum = (span / Math.max(1, width)) * 3;
  const steps = years
    ? [0.001, 0.01, 0.1, 1, 10, 100, 1000, 10000]
    : [1 / 60, 1 / 12, 0.25, 1, 6, 24, 120, 720, 8640];
  const step =
    steps.find((s) => s >= minimum) ?? 10 ** Math.ceil(Math.log10(minimum));
  return Number((Math.round(delta / step) * step).toFixed(8));
}
