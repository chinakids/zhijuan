// ===== 织卷 V2 · 系统菜单（macOS 菜单栏）=====
// 设计口径：docs/系统菜单-设计口径.md（2026-09-12 体验层轮定稿；落地归属=平台层 B 外壳）。
// 进度：第一刀（主进程侧，0fdad90）＝模板 + 动作分发 + preload 事件桥；
//       第二刀（f08c96b）＝渲染层 MenuBridge 单点分发（features/menu/menuBus.tsx）+ 启用态禁用（本文件 applyMenuState）。
// 约定（口径 §5）：不新增任何快捷键，只承载 docs/快捷键.md 已有组合 + macOS 系统标准。
import { shell, Menu, app, BrowserWindow, ipcMain } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { join } from 'path'
import type { MenuActionId, MenuStateReport } from '../shared/types'
import { workspaceDir } from './settings'

export interface MenuHandlers {
  /** 自定义动作：send 到渲染层（preload onMenuAction 消费；App.tsx 单点分发） */
  onMenuAction: (id: MenuActionId) => void
  /** 关于织卷…：主进程侧动作（setAboutPanelOptions + showAboutPanel） */
  onAbout: () => void
  /** 打开说明文档目录：主进程侧动作（shell 显示 Finder，口径 §四动作地图） */
  onOpenWorkspaceDocs: () => void
}

/** 自定义菜单项的原生 id（口径 §7 禁用态：主进程 getMenuItemById 定点更新 enabled；仅自定义通道需要） */
export const MENU_ITEM_ID: Record<MenuActionId, string> = {
  settings: 'zj-menu-settings',
  newProject: 'zj-menu-newProject',
  newChapter: 'zj-menu-newChapter',
  save: 'zj-menu-save',
  findOpen: 'zj-menu-findOpen',
  findUseSel: 'zj-menu-findUseSel',
  findNext: 'zj-menu-findNext',
  findPrev: 'zj-menu-findPrev',
  shortcutHelp: 'zj-menu-shortcutHelp',
  openWorkspaceDocs: 'zj-menu-openWorkspaceDocs'
}

/**
 * 菜单项启用逻辑（纯函数，冒烟逐项断言）= 口径 §二「启用条件」列。
 * newProject 仅项目库首页；newChapter 仅项目内；保存/查找组仅文档编辑器挂载；其余常可用。
 */
export function menuEnabledFor(state: MenuStateReport, id: MenuActionId): boolean {
  switch (id) {
    case 'newProject':
      return state.route === 'home'
    case 'newChapter':
      return state.route === 'project'
    case 'save':
    case 'findOpen':
    case 'findUseSel':
    case 'findNext':
    case 'findPrev':
      return state.editor
    default:
      return true
  }
}

/**
 * 构建菜单模板（纯函数，可被 esbuild 冒烟逐项断言）。
 * 结构＝织卷/文件/编辑/显示/窗口/帮助（首期不含格式：口径 §二「格式菜单：首期明确不做」）。
 * role 项显式写 label + accelerator（macOS 上 role 项仅这两者生效，口径 §三-2）。
 * platform 参数（默认 process.platform）：win/linux 走 winTemplate——role 项不写 accelerator、
 * 交给 Electron 平台默认（menu-item-roles.ts：close=CommandOrControl+W、redo win=Control+Y、
 * togglefullscreen win=F11、quit win 无）；自定义项 accelerator 一律 CmdOrCtrl 化
 * （accelerator.md：win 上 Command 键无效果）。口径见 docs/系统菜单-设计口径.md §win。
 */
export function buildMenuTemplate(
  h: MenuHandlers,
  platform: NodeJS.Platform = process.platform
): MenuItemConstructorOptions[] {
  if (platform !== 'darwin') return winTemplate(h)
  return macTemplate(h)
}

/** macOS 应用菜单（保持第一刀落地面逐字不动；win 走 winTemplate） */
function macTemplate(h: MenuHandlers): MenuItemConstructorOptions[] {
  return [
    {
      label: '织卷',
      submenu: [
        { label: '关于织卷…', click: h.onAbout },
        { label: '设置…', id: MENU_ITEM_ID.settings, accelerator: 'CmdOrCtrl+,', click: () => h.onMenuAction('settings') },
        { type: 'separator' },
        { role: 'services', label: '服务' },
        { role: 'hide', label: '隐藏织卷', accelerator: 'Cmd+H' },
        { role: 'hideOthers', label: '隐藏其他', accelerator: 'Alt+Cmd+H' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: '退出织卷', accelerator: 'Cmd+Q' }
      ]
    },
    {
      label: '文件',
      submenu: [
        { label: '新建项目…', id: MENU_ITEM_ID.newProject, click: () => h.onMenuAction('newProject') },
        { label: '新建章节…', id: MENU_ITEM_ID.newChapter, click: () => h.onMenuAction('newChapter') },
        { type: 'separator' },
        { label: '保存', id: MENU_ITEM_ID.save, accelerator: 'CmdOrCtrl+S', click: () => h.onMenuAction('save') },
        { role: 'close', label: '关闭窗口', accelerator: 'Cmd+W' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销', accelerator: 'CmdOrCtrl+Z' },
        { role: 'redo', label: '重做', accelerator: 'Shift+Cmd+Z' },
        { type: 'separator' },
        { role: 'cut', label: '剪切', accelerator: 'CmdOrCtrl+X' },
        { role: 'copy', label: '复制', accelerator: 'CmdOrCtrl+C' },
        { role: 'paste', label: '粘贴', accelerator: 'CmdOrCtrl+V' },
        { role: 'selectAll', label: '全选', accelerator: 'CmdOrCtrl+A' },
        { type: 'separator' },
        {
          label: '查找',
          submenu: [
            { label: '查找…', id: MENU_ITEM_ID.findOpen, accelerator: 'CmdOrCtrl+F', click: () => h.onMenuAction('findOpen') },
            { label: '用选区设置查找词', id: MENU_ITEM_ID.findUseSel, accelerator: 'CmdOrCtrl+E', click: () => h.onMenuAction('findUseSel') },
            { label: '查找下一处', id: MENU_ITEM_ID.findNext, accelerator: 'CmdOrCtrl+G', click: () => h.onMenuAction('findNext') },
            { label: '查找上一处', id: MENU_ITEM_ID.findPrev, accelerator: 'Shift+Cmd+G', click: () => h.onMenuAction('findPrev') }
          ]
        }
      ]
    },
    {
      label: '显示',
      submenu: [
        { role: 'resetZoom', label: '实际大小', accelerator: 'CmdOrCtrl+0' },
        { role: 'zoomIn', label: '放大', accelerator: 'CmdOrCtrl+Plus' },
        { role: 'zoomOut', label: '缩小', accelerator: 'CmdOrCtrl+-' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏', accelerator: 'Ctrl+Cmd+F' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化', accelerator: 'Cmd+M' },
        { role: 'zoom', label: '缩放' },
        { role: 'front', label: '前置全部窗口' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '键盘快捷键速查', id: MENU_ITEM_ID.shortcutHelp, click: () => h.onMenuAction('shortcutHelp') },
        { label: '打开说明文档目录', id: MENU_ITEM_ID.openWorkspaceDocs, click: h.onOpenWorkspaceDocs }
      ]
    }
  ]
}

/**
 * Windows/Linux 菜单模板（最小可用口径，docs/系统菜单-设计口径.md §win）：
 * 无 mac 应用菜单（「织卷」顶级不存在）；设置→文件菜单、关于→帮助菜单（平台惯例）；
 * role 项一律不写 accelerator——Electron 按平台给默认值（menu-item-roles.ts），
 * 显式写会覆盖默认（如 quit 显式 'Cmd+Q' 在 win 上 Command 键无效果=无快捷键）；
 * mac-only role（services/hide/hideOthers/unhide/front/zoom）不出现。
 */
function winTemplate(h: MenuHandlers): MenuItemConstructorOptions[] {
  return [
    {
      label: '文件',
      submenu: [
        { label: '新建项目…', id: MENU_ITEM_ID.newProject, click: () => h.onMenuAction('newProject') },
        { label: '新建章节…', id: MENU_ITEM_ID.newChapter, click: () => h.onMenuAction('newChapter') },
        { type: 'separator' },
        { label: '保存', id: MENU_ITEM_ID.save, accelerator: 'CmdOrCtrl+S', click: () => h.onMenuAction('save') },
        { type: 'separator' },
        { label: '设置…', id: MENU_ITEM_ID.settings, accelerator: 'CmdOrCtrl+,', click: () => h.onMenuAction('settings') },
        { type: 'separator' },
        // 不写 accelerator：官方 win 默认=无快捷键（quit 的默认加速键仅 mac 存在），win 走 Alt+F4/菜单点击
        { role: 'quit', label: '退出织卷' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' }, // 平台默认 CommandOrControl+Z
        { role: 'redo', label: '重做' }, // 平台默认 win32=Control+Y
        { type: 'separator' },
        { role: 'cut', label: '剪切' }, // 默认 CommandOrControl+X
        { role: 'copy', label: '复制' }, // 默认 CommandOrControl+C
        { role: 'paste', label: '粘贴' }, // 默认 CommandOrControl+V
        { role: 'selectAll', label: '全选' }, // 默认 CommandOrControl+A
        { type: 'separator' },
        {
          label: '查找',
          submenu: [
            { label: '查找…', id: MENU_ITEM_ID.findOpen, accelerator: 'CmdOrCtrl+F', click: () => h.onMenuAction('findOpen') },
            { label: '用选区设置查找词', id: MENU_ITEM_ID.findUseSel, accelerator: 'CmdOrCtrl+E', click: () => h.onMenuAction('findUseSel') },
            { label: '查找下一处', id: MENU_ITEM_ID.findNext, accelerator: 'CmdOrCtrl+G', click: () => h.onMenuAction('findNext') },
            { label: '查找上一处', id: MENU_ITEM_ID.findPrev, accelerator: 'Shift+CmdOrCtrl+G', click: () => h.onMenuAction('findPrev') }
          ]
        }
      ]
    },
    {
      label: '显示',
      submenu: [
        { role: 'resetZoom', label: '实际大小' }, // 默认 CommandOrControl+0
        { role: 'zoomIn', label: '放大' }, // 默认 CommandOrControl+Plus
        { role: 'zoomOut', label: '缩小' }, // 默认 CommandOrControl+-
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' } // 平台默认 win32=F11
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' }, // 默认 CommandOrControl+M
        { type: 'separator' },
        { role: 'close', label: '关闭窗口' } // 默认 CommandOrControl+W
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '键盘快捷键速查', id: MENU_ITEM_ID.shortcutHelp, click: () => h.onMenuAction('shortcutHelp') },
        { label: '打开说明文档目录', id: MENU_ITEM_ID.openWorkspaceDocs, click: h.onOpenWorkspaceDocs },
        { type: 'separator' },
        { label: '关于织卷…', click: h.onAbout } // win 惯例 Help>About（Electron role about 在 win 是 message box）
      ]
    }
  ]
}

/**
 * 渲染层上报菜单启用态（preload reportMenuState → ipcMain 'menu:state'）：
 * 按口径 §二「启用条件」更新对应自定义项 enabled（灰显不隐藏；role 项不动）。
 * Menu.getMenuItemById 未实现（stub）或菜单未建时静默跳过。
 */
export function applyMenuState(state: MenuStateReport): void {
  const menu = Menu.getApplicationMenu()
  if (!menu || typeof menu.getMenuItemById !== 'function') return
  for (const id of Object.keys(MENU_ITEM_ID) as MenuActionId[]) {
    const item = menu.getMenuItemById(MENU_ITEM_ID[id])
    if (item) item.enabled = menuEnabledFor(state, id)
  }
}

/**
 * 注册应用菜单（app ready 后调用一次）。
 * 自定义动作分发：menu:action 发到当前聚焦窗口（无聚焦取第一个）；about / 打开说明文档目录主进程侧处理。
 * 同时挂 ipcMain 'menu:state'（渲染层上报启用态 → applyMenuState）。
 */
export function registerMenuActions(): void {
  const handlers: MenuHandlers = {
    onMenuAction: (id) => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      win?.webContents.send('menu:action', { id })
    },
    onAbout: () => {
      app.setAboutPanelOptions({ applicationName: '织卷', applicationVersion: app.getVersion() })
      app.showAboutPanel()
    },
    onOpenWorkspaceDocs: () => {
      shell.showItemInFolder(join(workspaceDir(), '文档'))
    }
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate(handlers)))
  ipcMain.on('menu:state', (_e, state: MenuStateReport) => applyMenuState(state))
}
