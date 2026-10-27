/**
 * 章导航纯函数（2026-10-07 创作层：正文「上一章/下一章」——多章连写闭环：写完一章→下一章无需回侧栏找）。
 *
 * 语义：上一/下一章 = 当前章在 chapters 数组（章节列表显示序=文件名章号序，shared/chapters 排序口径）
 * 中的相邻条目，与左侧列表一致（作者在列表中看到的上下关系即导航序）。
 * 多时间线：导航按章号线性（与列表/时间线页并列视图一致）；作者知道自己在写哪条线，
 * 交错叙事（A1 B1 A2 B2）线性顺序正是交错的写作顺序。线内导航需求走时间线页（体验层按线分组）。
 *
 * 2026-10-27 体验层：章列可带「时间线镜头」（LineFilterChips 筛选）后，导航域需跟随可见集——
 * 见下方 chapterNeighborsIn；chapterNeighbors 保持「全量阅读序」语义（镜头=全部时即它）。
 */
import type { ChapterEntry } from './types'

export interface ChapterNeighbors {
  /** 当前章的前一章（章号序相邻；无 sel / 未找到 / 已是第一章 → null） */
  prev: ChapterEntry | null
  /** 当前章的后一章（已是最后一章 → null） */
  next: ChapterEntry | null
}

export function chapterNeighbors(list: ChapterEntry[], sel: string | null): ChapterNeighbors {
  if (!sel) return { prev: null, next: null }
  const i = list.findIndex((c) => c.file === sel)
  if (i < 0) return { prev: null, next: null }
  return {
    prev: i > 0 ? list[i - 1] : null,
    next: i < list.length - 1 ? list[i + 1] : null
  }
}

/**
 * 镜头内的章导航（2026-10-27 体验层，多时间线双线中篇动线）：domain=章列**可见集**
 * （`lineFilter` 筛选后的子集，保持阅读序；全部时=全量）。
 *
 * 语义=「本镜头里按阅读序的上一/下一章」：
 * - 可见集=全量 → 与 chapterNeighbors 完全一致（零回归）；
 * - 选中章**不在**可见集（例：把镜头切到「过去线」但正开着主线第1章）→ 不判死：
 *   取可见集里阅读序**前后最近**的一条（第1章 → 下一章=第2章），作者按「下一章」仍落在镜头内，
 *   不会跳到列表里看不见的章（HIG Focus and selection：焦点项消失时「就近安置到剩余项」；
 *   HIG Lists and tables：导航型列表要持续高亮当前行，让作者看得见自己在哪）；
 * - 可见集为空 / 无选中 / 选中章不存在 → 双 null（边界安全）。
 */
export function chapterNeighborsIn(
  list: ChapterEntry[],
  visible: ChapterEntry[],
  sel: string | null
): ChapterNeighbors {
  if (!sel) return { prev: null, next: null }
  const i = list.findIndex((c) => c.file === sel)
  if (i < 0 || !visible.length) return { prev: null, next: null }
  let prev: ChapterEntry | null = null
  let next: ChapterEntry | null = null
  for (const c of visible) {
    const j = list.findIndex((x) => x.file === c.file)
    if (j < 0) continue
    if (j < i) prev = c
    else if (j > i && !next) next = c
  }
  return { prev, next }
}

/** 按钮辅助标注（icon-only ③级：title+aria 双写）；labelOf = 条目的人类可读名（第N章 · 题名） */
export function chapterNavLabel(c: ChapterEntry): string {
  return c.fm ? `第${c.fm['章号']}章 · ${c.fm['题名'] ?? ''}` : c.name
}
