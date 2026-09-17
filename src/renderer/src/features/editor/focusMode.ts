import type { EditorState } from 'prosemirror-state'

/**
 * 焦点模式：返回当前「顶层块」范围（当前段/当前列表等），供渲染层对其它顶层块加淡化类。
 * 口径（体验层 2026-09-17，iA Writer / Typora Focus Mode 同范式）：
 * - 光标/选区落在同一顶层块内 → 返回该块 [from, to)；
 * - 选区跨顶层块（如跨两段）→ 返回 null＝不淡化（整体选中时不做焦点）；
 * - 空文档 / 选区不在块内 → null。
 * 纯函数，渲染层插件与单测同源。
 */
export function focusBlockRange(state: EditorState): { from: number; to: number } | null {
  const { $from, $to } = state.selection
  if ($from.depth < 1 || $to.depth < 1) return null
  // 同一顶层块 ⇔ before(1) 位置相同（跨块选择时不同，直接关闭焦点淡化）
  if ($from.before(1) !== $to.before(1)) return null
  return { from: $from.before(1), to: $from.after(1) }
}

/** 焦点模式：当前顶层块上启用的 DOM 类（淡化其余块时用） */
export const FOCUS_ON_CLASS = 'zj-focus-on'
export const FOCUS_DIM_CLASS = 'zj-focus-dim'
