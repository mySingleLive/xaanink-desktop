/** 秒数 → "45 秒" / "3 分 33 秒" / "1 小时 2 分"（§7.1 中文化：数字与中文单位间留半角空格） */
export function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (h > 0) return m > 0 ? `${h} 小时 ${m} 分` : `${h} 小时`
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`
}
