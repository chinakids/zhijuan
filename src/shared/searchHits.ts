// ===== 织卷 V2 · 搜索命中收尾（mtime 排序 + 截断） =====
// 背景：素材库/大纲等目录搜索的「命中排序 + limit 截断」语义必须一致——
// 收集完成后再按 mtime 新→旧排序、再截断，保证「limit 内 = 最近修改的 N 条」，
// 而非「枚举顺序前 N 条」（readdir 枚举序 ≈ 字母序，会把最新写入的命中挤出 limit）。
// 本模块纯函数（无 fs、无状态），真机 main/library.ts 与 devShim 共用同一实现（工程红线）。
// 与 UI 层 LibraryBrowser 的展示排序（mtime desc）同口径——数据层是权威，UI 兜底不变。

import type { SearchHit } from './types'

export const SEARCH_DEFAULT_LIMIT = 50
export const SEARCH_MAX_LIMIT = 200

/** 按 mtime 新→旧稳定排序（同 ms 保枚举序），再截断到 limit（limit<=0 视为不截断）。 */
export function finalizeSearchHits(hits: SearchHit[], limit: number): SearchHit[] {
  const sorted = [...hits].sort((a, b) => b.mtime - a.mtime)
  if (!limit || limit <= 0) return sorted
  return sorted.slice(0, limit)
}
