import type { Plugin } from 'prosemirror-state'
import { Plugin as PMPlugin } from 'prosemirror-state'

/**
 * 打字机滚动（体验层 2026-09-17；Typora Typewriter Mode 同范式，质感主线候选）
 *
 * 服务创作/产品问题：作者连续输入时，正文随行数增长把光标越推越低，长文里光标走出视口、
 * 需要频繁手动滚回——心流被打断。打字机滚动让「光标行」在输入时自动回到滚动容器垂直中线
 * （视线同高），作者不用管滚动，只管写。对照范式（真抓取，来源记档见模块档案）：
 * - Typora 官方「Focus and Typewriter Mode」：typewriter mode「scrolls the article to keep
 *   current caret fixed when typing」；默认「Always keep caret in middle of screen」连鼠标
 *   点击选区也居中，偏好面板可关掉该项＝**仅输入时固定**（本轮采纳后者：点击/跳转定位不
 *   强制居中，与切章滚动记忆/cursorMemory 互不打架）。
 * - Apple HIG Scroll views「In some cases, scroll automatically to help people find their
 *   place」+ Motion 克制（直接设 scrollTop，不做滚动动画，零新依赖）。
 *
 * 判据（先验约束，档案候选已定）：仅「内容变化（docChanged）＋编辑器持有焦点＋非程序化
 * 注入（setContent/applyMarkdown 由 Prose 打 programmatic 标记）＋光标态（无选区）」时接管；
 * 鼠标点击/方向键移动选区（doc 不变）不触发；程序化 setContent（切章/静默重载）不抢占
 * 滚动记忆与光标恢复。默认关（设置页开关，与焦点模式同设置区）。
 */

export interface TypewriterCtx {
  isEnabled: () => boolean
  getHost: () => HTMLElement | null
  /** 程序化注入标记（setContent/applyMarkdown 期间为 true：跳过，保住滚动记忆/光标恢复） */
  isProgrammatic: () => boolean
}

/**
 * 纯函数：打字机滚动的目标 scrollTop。
 * @param cursorTop 光标行上缘相对滚动容器内容顶的 y（= coordsAtPos.top − 容器视口 rect.top + 当前 scrollTop）
 * @param cursorH   光标行高（coords.bottom − top）
 * @param viewportH 滚动容器可见高（clientHeight）
 * @param maxScroll 最大可滚距离（scrollHeight − clientHeight）
 * @returns 目标 scrollTop（clamp 到 [0, maxScroll]）；参数非法返回 NaN（调用方不滚）
 */
export function computeTypewriterScroll(
  cursorTop: number,
  cursorH: number,
  viewportH: number,
  maxScroll: number
): number {
  if (!Number.isFinite(cursorTop) || !Number.isFinite(cursorH) || !Number.isFinite(viewportH) || viewportH <= 0) {
    return NaN
  }
  if (!Number.isFinite(maxScroll)) return NaN
  if (maxScroll <= 0) return 0
  const target = cursorTop + cursorH / 2 - viewportH / 2
  return Math.min(maxScroll, Math.max(0, target))
}

/** 工厂：返回一个无状态 PM 插件（plugin view 在每次 dispatch 后回调，读最新 ref 开关） */
export function makeTypewriterPlugin(ctx: TypewriterCtx): Plugin {
  return new PMPlugin({
    view: () => ({
      update: (view: any, prevState: any) => {
        // 仅用户内容变更（doc 引用变化）才接管；选区移动（doc 不变）不触发
        if (view.state.doc === prevState.doc) return
        if (!ctx.isEnabled()) return
        if (ctx.isProgrammatic()) return
        if (!view.hasFocus()) return
        const sel = view.state.selection
        if (!sel.empty) return
        const host = ctx.getHost()
        if (!host) return
        let coords: { top: number; bottom: number } | null = null
        try {
          coords = view.coordsAtPos(sel.from)
        } catch {
          /* 位置瞬时无效（替换/删除后）跳过本帧 */
        }
        if (!coords || !Number.isFinite(coords.top)) return
        const rect = host.getBoundingClientRect()
        const target = computeTypewriterScroll(
          coords.top - rect.top + host.scrollTop,
          coords.bottom - coords.top,
          host.clientHeight,
          host.scrollHeight - host.clientHeight
        )
        if (Number.isNaN(target)) return
        requestAnimationFrame(() => {
          // 帧后布局稳定再滚；容器已被卸载/重建则不动作
          if (host.isConnected) host.scrollTop = target
        })
      },
      destroy: () => {}
    })
  })
}
