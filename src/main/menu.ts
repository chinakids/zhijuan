// ===== 织卷 V2 · 系统菜单（macOS 菜单栏）=====
// 设计口径：docs/系统菜单-设计口径.md（2026-09-12 体验层轮定稿；落地归属=平台层 B 外壳）。
// 本轮＝第一刀（主进程侧）：模板 + 动作分发 + preload 事件桥；渲染层单点分发与禁用态上报＝下一刀。
// 约定（口径 §5）：不新增任何快捷键，只承载 docs/快捷键.md 已有组合 + macOS 系统标准。
import { shell, Menu, app, BrowserWindow } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { join } from 'path'
import type { MenuActionId } from '../shared/types'
import { workspaceDir } from './settings'

export interface MenuHandlers {
  /** 自定义动作：send 到渲染层（preload onMenuAction 消费；App.tsx 单点分发＝下一刀） */
  onMenuAction: (id: MenuActionId) => void
  /** 关于织卷…：主进程侧动作（setAboutPanelOptions + showAboutPanel） */
  onAbout: () => void
  /** 打开说明文档目录：主进程侧动作（shell 显示 Finder，口径 §四动作地图） */
  onOpenWorkspaceDocs: () => void
}

/**
 * 构建菜单模板（纯函数，可被 esbuild 冒烟逐项断言）。
 * 结构＝织卷/文件/编辑/显示/窗口/帮助（首期不含格式：口径 §二「格式菜单：首期明确不做」）。
 * role 项显式写 label + accelerator（macOS 上 role 项仅这两者生效，口径 §三-2）。
 */
export function buildMenuTemplate(h: MenuHandlers): MenuItemConstructorOptions[] {
  return [
    {
      label: '织卷',
      submenu: [
        { label: '关于织卷…', click: h.onAbout },
        { label: '设置…', accelerator: 'CmdOrCtrl+,', click: () => h.onMenuAction('settings') },
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
        { label: '新建项目…', click: () => h.onMenuAction('newProject') },
        { label: '新建章节…', click: () => h.onMenuAction('newChapter') },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => h.onMenuAction('save') },
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
            { label: '查找…', accelerator: 'CmdOrCtrl+F', click: () => h.onMenuAction('findOpen') },
            { label: '用选区设置查找词', accelerator: 'CmdOrCtrl+E', click: () => h.onMenuAction('findUseSel') },
            { label: '查找下一处', accelerator: 'CmdOrCtrl+G', click: () => h.onMenuAction('findNext') },
            { label: '查找上一处', accelerator: 'Shift+Cmd+G', click: () => h.onMenuAction('findPrev') }
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
        { label: '键盘快捷键速查', click: () => h.onMenuAction('shortcutHelp') },
        { label: '打开说明文档目录', click: h.onOpenWorkspaceDocs }
      ]
    }
  ]
}

/**
 * 注册应用菜单（app ready 后调用一次）。
 * 自定义动作分发：menu:action 发到当前聚焦窗口（无聚焦取第一个）；about / 打开说明文档目录主进程侧处理。
 * 禁用态（新建项目仅 Home / 保存仅编辑器等）＝渲染层上报 IPC，下一刀落地。
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
}
