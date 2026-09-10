// ===== 项目列表排序/过滤纯逻辑（Home 首页用；无 fs，可单测） =====
// 语义：搜索按名称/简介过滤；排序「最近打开优先」——打开过的按最近打开时间降序，没打开过的按最近编辑降序。
// 「最近打开」是应用内部状态（main/recent.ts 维护，userData/zhijuan-recents.json），不落项目库、不进 AppSettings。
import type { ProjectSummary } from './types'

export interface RecentEntry {
  id: string
  openedAt: number
}

/**
 * 过滤 + 排序项目列表。
 * - query（空白视为无）按 名称/简介 子串匹配（大小写不敏感）
 * - recents 中存在的项目排前，按 openedAt 降序；其余按 updatedAt 降序
 */
export function orderProjects(list: ProjectSummary[], recents: RecentEntry[], query: string): ProjectSummary[] {
  const q = query.trim().toLowerCase()
  const filtered = q
    ? list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.description || '').toLowerCase().includes(q)
      )
    : list
  const openedAt = new Map<string, number>()
  for (const r of recents) {
    if (typeof r?.id === 'string' && typeof r?.openedAt === 'number') {
      if (!openedAt.has(r.id)) openedAt.set(r.id, r.openedAt)
    }
  }
  return [...filtered].sort((a, b) => {
    const ra = openedAt.get(a.id) ?? 0
    const rb = openedAt.get(b.id) ?? 0
    if (ra !== rb) return rb - ra
    return b.updatedAt - a.updatedAt
  })
}
