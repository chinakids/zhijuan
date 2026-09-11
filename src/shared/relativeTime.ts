// ===== 织卷 V2 · 相对时间显示（shared 纯约定，无 fs） =====
// 「最近」类列表（最近素材 / 最近打开）的次级信息：刚刚 / N 分钟前 / N 小时前 / N 天前 / MM-DD。
// 与 Apple HIG「relative dates」一致；纯函数便于单测与两端复用。

export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  if (!Number.isFinite(ts) || ts <= 0) return ''
  const diff = now - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  const d = new Date(ts)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${mm}-${dd}`
}
