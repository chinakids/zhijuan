// ===== 系统菜单·启用态上报（docs/系统菜单-设计口径.md §7 禁用态；平台层第二刀）=====
// 渲染层是「当前页 / 编辑器挂载」的唯一权威：主进程无法可靠判断 editor 是否挂载，
// 因此由本模块合并 route + editor 后 fire-and-forget 上报（preload reportMenuState → ipcMain 'menu:state'）。
import type { MenuRouteKind, MenuStateReport } from '../../../../shared/types'

/** 路由分类（渲染层权威）：#/=项目库首页；#/project/*=项目内；其余（设置等）=other */
export function routeKindOfHash(hash: string): MenuRouteKind {
  if (hash.startsWith('#/project/')) return 'project'
  if (hash === '' || hash === '#' || hash === '#/') return 'home'
  return 'other'
}

// 文档编辑器挂载计数（DocEditor mount/unmount）。正文与分幕草稿共用 DocEditor：
// 只要有一个挂着，保存/查找组就可用——菜单动作目标就是「当前打开的文档」。
let editorCount = 0
export function registerDocEditor(): void {
  editorCount++
  reportMenuState()
}
export function unregisterDocEditor(): void {
  editorCount = Math.max(0, editorCount - 1)
  reportMenuState()
}

/** 上报当前启用态（幂等；devShim 下 mock 记录到 window.__ZJ_MENU_STATE 供无头断言） */
export function reportMenuState(): void {
  const state: MenuStateReport = {
    route: routeKindOfHash(window.location.hash),
    editor: editorCount > 0
  }
  window.zhijuan.reportMenuState(state)
}
