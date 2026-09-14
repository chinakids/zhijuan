// ===== 织卷 V2 · 界面偏好常量与纯函数（模块设计 §十二「面板宽度记忆」） =====
// 纯约定无 fs、无 React：Agent 面板宽度记忆的取值域与钳制逻辑，真机/devShim 共用（工程红线：同一逻辑只写一份）。
// 规范来源：W3C WAI-ARIA APG Window Splitter（role=separator + aria-valuenow/min/max + 方向键）。

/** Agent 面板默认宽度（px）。320=旧固定 w-80，改造后作为默认值，行为零回归 */
export const AGENT_PANEL_DEFAULT_WIDTH = 320
/** 最小宽度（px）：保证 EditCard 行号对比与工具卡参数可读 */
export const AGENT_PANEL_MIN_WIDTH = 280
/** 最大宽度（px）：防止过度挤压正文编辑区 */
export const AGENT_PANEL_MAX_WIDTH = 560
/** 方向键单步宽度（px），WAI-ARIA 分隔条惯例 */
export const AGENT_PANEL_STEP = 16

/** 宽度钳制：非有限值（NaN/Infinity）→ 默认；小数取整；越界钳到 [min, max] */
export function clampAgentWidth(n: number): number {
  if (!Number.isFinite(n)) return AGENT_PANEL_DEFAULT_WIDTH
  return Math.min(AGENT_PANEL_MAX_WIDTH, Math.max(AGENT_PANEL_MIN_WIDTH, Math.round(n)))
}

// ===== 窄窗正文保护（2026-09-14 体验层；HIG Sidebars「自动随窗口缩放隐藏侧栏」） =====
/** 左侧一级导航（SectionNav）固定宽度（px），对应 w-60 */
export const SECTION_NAV_WIDTH = 240
/** 章节列表列宽（px），对应 w-60 */
export const CHAPTER_COL_WIDTH = 240
/** 正文编辑区保护宽度（px）：可用正文宽低于此值时折叠章节列，保证正文可写 */
export const EDITOR_MIN_WIDTH = 360

/**
 * 窄窗判据：窗口宽 - 一级导航 - Agent 面板 - 章节列 < 正文保护宽 → 应折叠章节列。
 * Agent 面板拖宽后阈值自动升高（正文始终受保护）；折叠只改变章列存在与否，
 * 不反过来影响判据量（无反馈环，无需迟滞）。
 * 纯函数无 fs、无 React（工程红线）；winW/agentWd 非有限值一律视为不折叠（保守）。
 */
export function shouldCollapseChapterList(
  winW: number,
  agentWd: number,
  navW: number = SECTION_NAV_WIDTH
): boolean {
  if (!Number.isFinite(winW) || !Number.isFinite(agentWd)) return false
  return winW - navW - agentWd - CHAPTER_COL_WIDTH < EDITOR_MIN_WIDTH
}
