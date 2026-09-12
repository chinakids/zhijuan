// ===== 项目列表排序/过滤纯逻辑（Home 首页用；无 fs，可单测） =====
// 语义：搜索按名称/简介过滤；排序「最近打开优先」——打开过的按最近打开时间降序，没打开过的按最近编辑降序。
// 「最近打开」是应用内部状态（main/recent.ts 维护，userData/zhijuan-recents.json），不落项目库、不进 AppSettings。
import type { ProjectSummary } from './types'
import { sanitizeFile } from './paths'

export interface RecentEntry {
  id: string
  openedAt: number
}

/**
 * 新项目 id 生成（真机 store.createProject 与 devShim 共用，防口径漂移）：
 * sanitizeFile 清洗后，若 isUsed 报告已占用则追加时间戳后缀（真机=库内同目录存在；devShim=内存 projects 列表命中）。
 */
export function nextProjectId(name: string, isUsed: (id: string) => boolean): string {
  const base = sanitizeFile(name)
  if (!isUsed(base)) return base
  return `${base}_${Date.now().toString(36).slice(-4)}`
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
