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
