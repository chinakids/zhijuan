/**
 * 浮动层（划词浮层 / 批注气泡）贴边布局纯逻辑（体验层 2026-09-15）。
 *
 * 服务的问题：两处 fixed 浮层此前只有「顶部太近翻下方」的单向启发式（阈值 120/140 硬编码），
 * 而①批注气泡高度随 note 行数变化（可 >130px），锚点 top 落在「上方放不下但旧启发式判定放上方」
 * 的区间时，气泡会从视口顶溢出；②水平方向没有任何钳制（锚点中心贴视口右/左缘时会整个漂出）。
 * HIG Popovers：「Position popovers appropriately」——内容放不下时反向/错位是 macOS 浮层惯例。
 *
 * 口径（与 HIG 一致、与现有渲染约定兼容）：
 * - 输入锚点视口矩形（cx/top/bottom）与浮层实测尺寸，输出最终视口坐标（x=浮层中心、top=浮层顶）与方位。
 * - 垂直优先让浮层位于锚点上方（底缘距锚点顶 FLOAT_GAP）；上方放不下 → 翻到下方；双侧都不足 → 取空间大的一侧并钳制。
 * - 水平中心锚定、越界钳回视口（左右各留 FLOAT_EDGE）；浮层比视口可用宽还大时居中。
 * - 无 DOM / window 依赖，纯函数可单测。
 */

export interface FloatAnchor {
  /** 锚点矩形中心 x（视口坐标） */
  cx: number
  /** 锚点矩形顶（视口坐标） */
  top: number
  /** 锚点矩形底（视口坐标） */
  bottom: number
}

export interface FloatSize {
  w: number
  h: number
}

export interface FloatPos {
  /** 浮层中心 x（调用方套 translate(-50%)） */
  x: number
  /** 浮层顶 y（调用方直接作为 top，transform 用 translate(-50%, 0)） */
  top: number
  /** 浮层位于锚点下方（false = 上方） */
  below: boolean
}

/** 浮层与视口边缘的安全边距（HIG：内容不贴边） */
export const FLOAT_EDGE = 8
/** 浮层与锚点矩形的间距（与既有 above 口径 10px 对齐） */
export const FLOAT_GAP = 10

/** 首帧估计尺寸（浮层挂载前不可测量；useLayoutEffect 会用实测值立即修正，paint 前完成、无闪烁） */
export const FLOAT_EST_BUBBLE: FloatSize = { w: 210, h: 44 }
export const FLOAT_EST_ANNO_POP: FloatSize = { w: 300, h: 150 }

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)

export function computeFloatingPos(anchor: FloatAnchor, size: FloatSize, vw: number, vh: number): FloatPos {
  // 水平：中心锚定，越界钳回视口（浮层比视口可用宽还大（如极窄窗口）时居中）。
  const half = size.w / 2
  const x = size.w + FLOAT_EDGE * 2 <= vw ? clamp(anchor.cx, FLOAT_EDGE + half, vw - FLOAT_EDGE - half) : vw / 2
  // 垂直：上方空间=锚点顶以上（减间距与边距）；足够 → 上方。不够 → 下方；双侧都不足 → 选空间大的一侧并钳制。
  const spaceAbove = anchor.top - FLOAT_GAP - FLOAT_EDGE
  const spaceBelow = vh - anchor.bottom - FLOAT_GAP - FLOAT_EDGE
  const below = spaceAbove >= size.h ? false : spaceBelow >= size.h ? true : spaceBelow >= spaceAbove
  // 目标 top：above=锚点顶以上（浮层底距锚点顶 GAP）；below=锚点底以下（顶距锚点底 GAP）
  const rawTop = below ? anchor.bottom + FLOAT_GAP : anchor.top - FLOAT_GAP - size.h
  // 塞回视口：优先保 FLOAT_EDGE 边距；视口放不下「浮层+双边距」时边距让位（对半居中），浮层仍完全可见
  const low = Math.max(0, Math.min(FLOAT_EDGE, (vh - size.h) / 2))
  const high = Math.max(low, vh - size.h - low)
  const top = Math.min(Math.max(rawTop, low), high)
  return { x, top, below }
}
