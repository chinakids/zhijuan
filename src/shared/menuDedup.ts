// ===== 系统菜单·双触发去重纯逻辑（docs/系统菜单-设计口径.md §五-1；平台层候选 1）=====
// 菜单 accelerator 与渲染层 keydown 是否同达未达 Electron 官方明文（keyboard-shortcuts 教程只说明
// accelerator 由菜单体系处理、未说明 renderer 事件去向）——以「最近一次菜单动作」时间窗兜底：
// keydown 处理器发现「同 id 且 <窗口」即认为已由菜单体系处理，跳过自身动作；
// 菜单原生拦截时窗口永不命中（零副作用）；未拦截（历史平台差异）时兜底去重。
// 纯函数（无状态、无 fs）：状态由调用方（menuBus 模块级变量）维护，便于单测边界与复用。
import type { MenuActionId } from './types'

/** 去重窗口：菜单动作后窗口内的同 id keydown 视为菜单已处理。 */
export const MENU_DEDUP_WINDOW_MS = 750

/** 最近一次菜单动作的时间戳（调用方维护；at=Date.now() 毫秒） */
export interface MenuActionStamp {
  id: MenuActionId
  at: number
}

/** keydown 是否应跳过：存在最近菜单动作、同 id 且落在去重窗口内（严格小于窗口）。 */
export function shouldSkipKeydown(last: MenuActionStamp | null, id: MenuActionId, now: number): boolean {
  if (!last) return false
  if (last.id !== id) return false
  return now - last.at < MENU_DEDUP_WINDOW_MS
}
