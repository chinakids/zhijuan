/**
 * 章导航纯函数（2026-10-07 创作层：正文「上一章/下一章」——多章连写闭环：写完一章→下一章无需回侧栏找）。
 *
 * 语义：上一/下一章 = 当前章在 chapters 数组（章节列表显示序=文件名章号序，shared/chapters 排序口径）
 * 中的相邻条目，与左侧列表一致（作者在列表中看到的上下关系即导航序）。
 * 多时间线：导航按章号线性（与列表/时间线页并列视图一致）；作者知道自己在写哪条线，
 * 交错叙事（A1 B1 A2 B2）线性顺序正是交错的写作顺序。线内导航需求走时间线页（体验层按线分组）。
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

/** 按钮辅助标注（icon-only ③级：title+aria 双写）；labelOf = 条目的人类可读名（第N章 · 题名） */
export function chapterNavLabel(c: ChapterEntry): string {
  return c.fm ? `第${c.fm['章号']}章 · ${c.fm['题名'] ?? ''}` : c.name
}
