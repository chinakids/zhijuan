// ===== 系统菜单·渲染层单点分发（docs/系统菜单-设计口径.md §7 动作分发；平台层第二刀）=====
// App.tsx 挂载 MenuBridge()：订阅 preload onMenuAction，一处 switch 按 id 调各域入口——
// 页面类动作（新建项目/新建章节/保存/查找）经 CustomEvent 派发（页面各自接线监听，页面不在场即无人消费；
// 菜单禁用态保证动作只会在对应页面被点出）；门户类动作（设置…/快捷键速查）本层直接处理。
import { useEffect } from 'react'
import type { MenuActionId } from '../../../../shared/types'
import { shouldSkipKeydown, type MenuActionStamp } from '../../../../shared/menuDedup'
import { useUiStore } from '../../store/ui'
import { router } from '../../router'
import ShortcutHelp from '../command/ShortcutHelp'
import { reportMenuState } from './menuState'

/** 页面类菜单动作事件名（各页面 useEffect 订阅；detail=MenuActionId，find 组带 id 区分动作） */
export const MENU_EV_NEW_PROJECT = 'zj:menu-newProject'
export const MENU_EV_NEW_CHAPTER = 'zj:menu-newChapter'
export const MENU_EV_SAVE = 'zj:menu-save'
export const MENU_EV_FIND = 'zj:menu-find'

/**
 * 双触发防护（口径 §五-1：菜单 accelerator 与 renderer keydown 是否同达未达官方明文）：
 * 记录最近一次菜单动作；渲染层 keydown 处理器发现「同 id 且 <750ms」说明已由菜单体系处理，跳过。
 * 窗口断判为纯函数 shared/menuDedup.ts（shouldSkipKeydown，含单测）；本模块只维护状态。
 * 菜单原生拦截时此窗口永不命中（零副作用）；未拦截（历史平台差异）时兜底去重。
 */
let lastMenuAction: MenuActionStamp | null = null
export function isMenuJustHandled(id: MenuActionId): boolean {
  return shouldSkipKeydown(lastMenuAction, id, Date.now())
}

function emitMenuEvent(name: string, id: MenuActionId): void {
  window.dispatchEvent(new CustomEvent(name, { detail: id }))
}

/** 单点分发（导出供单测/无头驱动直接调；MenuBridge 订阅 onMenuAction 后转调） */
export function handleMenuAction(id: MenuActionId): void {
  lastMenuAction = { id, at: Date.now() }
  switch (id) {
    case 'settings':
      // 走 data router 导航（routeGuard 拦截面全覆盖；直接改 location.hash=外部导航，createHashRouter
      // 下 blocker 对它会「fail silently in production」——本地 v7.18.3 源码警告原文）
      void router.navigate('/settings')
      break
    case 'shortcutHelp':
      useUiStore.getState().setShortcutHelpOpen(true)
      break
    case 'newProject':
      emitMenuEvent(MENU_EV_NEW_PROJECT, id)
      break
    case 'newChapter':
      emitMenuEvent(MENU_EV_NEW_CHAPTER, id)
      break
    case 'save':
      emitMenuEvent(MENU_EV_SAVE, id)
      break
    case 'findOpen':
    case 'findReplace':
    case 'findUseSel':
    case 'findNext':
    case 'findPrev':
      emitMenuEvent(MENU_EV_FIND, id)
      break
    default:
      break
  }
}

/**
 * App 级菜单桥：订阅菜单动作 + 路由变化时上报启用态 + 渲染全局快捷键速查（菜单入口）。
 * 无 react-router 依赖（hash 跳转/监听），可挂 Router 外（EngineBadge 旧坑）。
 */
export default function MenuBridge() {
  const shortcutOpen = useUiStore((s) => s.shortcutHelpOpen)
  useEffect(() => {
    const un = window.zhijuan.onMenuAction((evt) => handleMenuAction(evt.id))
    const onHash = () => reportMenuState()
    window.addEventListener('hashchange', onHash)
    reportMenuState() // 初始态（App 挂载即上报，主进程菜单刚建好）
    return () => {
      un()
      window.removeEventListener('hashchange', onHash)
    }
  }, [])
  return <ShortcutHelp open={shortcutOpen} onOpenChange={useUiStore.getState().setShortcutHelpOpen} />
}
