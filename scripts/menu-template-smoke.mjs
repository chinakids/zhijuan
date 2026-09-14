// 系统菜单·主进程侧冒烟（docs/系统菜单-设计口径.md 第一刀；验收口径 (a)(e)）
// 验证：buildMenuTemplate 模板结构与设计表逐项一致（label/role/accelerator/子菜单/custom click）、
//       registerMenuActions 全链路（setApplicationMenu、menu:action send、about/打开文档目录主进程动作）。
// 用法：cd ~/Desktop/织卷 && node scripts/menu-template-smoke.mjs
// 坑（本轮实踩）：esbuild alias 会把 electron-stub 代码 inline 进 bundle——外部单独 import 的 stub 与
//   bundle 内是同名不同实例。因此本脚本在 stdin 里额外 `export * from 'electron'`，让 bundle 同时导出
//   内联 stub，观察/改写 BrowserWindow 等必须从 bundle 对象上做（registerMenuActions 用的就是它）。
import { build as esbuild } from 'esbuild'
import { resolve, join } from 'node:path'
import { rmSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_USERDATA = '/tmp/zj-smoke-menu'
rmSync(process.env.ZJ_USERDATA, { recursive: true, force: true })
const out = '/tmp/zj-menu-bundle.mjs'

await esbuild({
  stdin: {
    contents: [
      `export * from ${JSON.stringify(resolve(root, 'src/main/menu.ts'))};`,
      // 同一份内联 stub 再导出（见文件头坑注）；shell/dialog 也在其中
      `export * from 'electron';`
    ].join('\n'),
    resolveDir: root,
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  external: ['node:*']
})

const menu = await import('file://' + out)

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name, extra) }
  else { fail++; console.log('FAIL', name, extra) }
}
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ---------- 1) 模板结构（label 顺序 / role / accelerator 逐字=设计口径表） ----------
const h = {
  onMenuAction: () => {},
  onAbout: () => {},
  onOpenWorkspaceDocs: () => {}
}
const tpl = menu.buildMenuTemplate(h)

// 期望表：按 docs/系统菜单-设计口径.md §二「首期范围」逐项（sub=有子菜单；click 只看是否函数）
const EXPECT = [
  { label: '织卷', sub: [
    { label: '关于织卷…', click: 'fn' },
    { label: '设置…', acc: 'CmdOrCtrl+,', click: 'fn' },
    { sep: true },
    { role: 'services', label: '服务' },
    { role: 'hide', label: '隐藏织卷', acc: 'Cmd+H' },
    { role: 'hideOthers', label: '隐藏其他', acc: 'Alt+Cmd+H' },
    { role: 'unhide', label: '全部显示' },
    { sep: true },
    { role: 'quit', label: '退出织卷', acc: 'Cmd+Q' }
  ] },
  { label: '文件', sub: [
    { label: '新建项目…', click: 'fn' },
    { label: '新建章节…', click: 'fn' },
    { sep: true },
    { label: '保存', acc: 'CmdOrCtrl+S', click: 'fn' },
    { role: 'close', label: '关闭窗口', acc: 'Cmd+W' }
  ] },
  { label: '编辑', sub: [
    { role: 'undo', label: '撤销', acc: 'CmdOrCtrl+Z' },
    { role: 'redo', label: '重做', acc: 'Shift+Cmd+Z' },
    { sep: true },
    { role: 'cut', label: '剪切', acc: 'CmdOrCtrl+X' },
    { role: 'copy', label: '复制', acc: 'CmdOrCtrl+C' },
    { role: 'paste', label: '粘贴', acc: 'CmdOrCtrl+V' },
    { role: 'selectAll', label: '全选', acc: 'CmdOrCtrl+A' },
    { sep: true },
    { label: '查找', sub: [
      { label: '查找…', acc: 'CmdOrCtrl+F', click: 'fn' },
      { label: '用选区设置查找词', acc: 'CmdOrCtrl+E', click: 'fn' },
      { label: '查找下一处', acc: 'CmdOrCtrl+G', click: 'fn' },
      { label: '查找上一处', acc: 'Shift+Cmd+G', click: 'fn' }
    ] }
  ] },
  { label: '显示', sub: [
    { role: 'resetZoom', label: '实际大小', acc: 'CmdOrCtrl+0' },
    { role: 'zoomIn', label: '放大', acc: 'CmdOrCtrl+Plus' },
    { role: 'zoomOut', label: '缩小', acc: 'CmdOrCtrl+-' },
    { sep: true },
    { role: 'togglefullscreen', label: '切换全屏', acc: 'Ctrl+Cmd+F' }
  ] },
  { label: '窗口', sub: [
    { role: 'minimize', label: '最小化', acc: 'Cmd+M' },
    { role: 'zoom', label: '缩放' },
    { role: 'front', label: '前置全部窗口' }
  ] },
  { label: '帮助', sub: [
    { label: '键盘快捷键速查', click: 'fn' },
    { label: '打开说明文档目录', click: 'fn' }
  ] }
]

const norm = (x) => {
  if (x.sep) return { sep: true }
  const o = { label: x.label }
  if (x.acc) o.acc = x.acc
  if (x.role) o.role = x.role
  if (x.click) o.click = 'fn'
  if (x.sub) o.sub = x.sub.map(norm)
  return o
}
const proj = (m) => {
  if (m.type === 'separator') return { sep: true }
  const o = { label: m.label }
  if (m.accelerator) o.acc = m.accelerator
  if (m.role) o.role = m.role
  if (typeof m.click === 'function') o.click = 'fn'
  if (Array.isArray(m.submenu)) o.sub = m.submenu.map(proj)
  return o
}

ok('顶级菜单顺序=织卷/文件/编辑/显示/窗口/帮助', deepEq(tpl.map((m) => m.label), EXPECT.map((e) => e.label)), JSON.stringify(tpl.map((m) => m.label)))
EXPECT.forEach((em, i) => {
  const got = JSON.stringify(proj(tpl[i]).sub)
  const want = JSON.stringify(em.sub.map(norm))
  ok(`「${em.label}」菜单结构与设计表一致`, got === want, got === want ? '' : `\n  got:  ${got}\n  want: ${want}`)
})

// ---------- 2) 自定义项 click 分发（buildMenuTemplate handlers 收到正确 id） ----------
const gotIds = []
const h2 = {
  onMenuAction: (id) => gotIds.push(id),
  onAbout: () => gotIds.push('__about__'),
  onOpenWorkspaceDocs: () => gotIds.push('__docs__')
}
const walk = (items) => {
  for (const m of items) {
    if (typeof m.click === 'function') m.click()
    if (Array.isArray(m.submenu)) walk(m.submenu)
  }
}
walk(menu.buildMenuTemplate(h2))
const expectIds = ['__about__', 'settings', 'newProject', 'newChapter', 'save', 'findOpen', 'findUseSel', 'findNext', 'findPrev', 'shortcutHelp', '__docs__']
ok('自定义项 click 触发且 id 集合=设计表 10 通道+2 主进程动作', deepEq(gotIds, expectIds), JSON.stringify(gotIds))

// ---------- 3) registerMenuActions 全链路（用 bundle 内联 stub——见文件头坑注） ----------
const sends = []
menu.BrowserWindow.getAllWindows = () => [{ webContents: { send: (ch, payload) => sends.push([ch, payload]) } }]
menu.registerMenuActions()
const appMenu = menu.Menu.getApplicationMenu()
ok('Menu.setApplicationMenu 已被调用', !!appMenu && Array.isArray(appMenu.template))
const findClick = (items, label) => {
  for (const m of items) {
    if (m.label === label && typeof m.click === 'function') return m.click
    if (Array.isArray(m.submenu)) { const r = findClick(m.submenu, label); if (r) return r }
  }
  return null
}
const tpl3 = appMenu?.template ?? []
findClick(tpl3, '保存')()
ok('「保存」click -> menu:action{id:save}（mock webContents 捕获）', deepEq(sends, [['menu:action', { id: 'save' }]]), JSON.stringify(sends))
findClick(tpl3, '设置…')()
ok('「设置…」click -> menu:action{id:settings}', deepEq(sends[1], ['menu:action', { id: 'settings' }]), JSON.stringify(sends[1]))
findClick(tpl3, '关于织卷…')()
ok('「关于织卷…」click -> app.showAboutPanel + setAboutPanelOptions(applicationName=织卷)', menu.app._about === 1 && menu.app._aboutPanel && menu.app._aboutPanel.applicationName === '织卷', JSON.stringify(menu.app._aboutPanel))
findClick(tpl3, '打开说明文档目录')()
ok('「打开说明文档目录」click -> shell.showItemInFolder(工作区/文档)', typeof menu.shell._shown === 'string' && menu.shell._shown.endsWith(join('文档')), menu.shell._shown)
findClick(tpl3, '键盘快捷键速查')()
ok('「键盘快捷键速查」click -> menu:action{id:shortcutHelp}', deepEq(sends[2], ['menu:action', { id: 'shortcutHelp' }]), JSON.stringify(sends[2]))

// ---------- 4) 第二刀：自定义项 id + 启用逻辑 + applyMenuState + IPC 接线 ----------
// 4.1 每个自定义动作在模板中有唯一 id（主进程 getMenuItemById 定点更新的前提）
const templateIds = new Set()
const collectIds = (items) => {
  for (const m of items) {
    if (typeof m.id === 'string') templateIds.add(m.id)
    if (Array.isArray(m.submenu)) collectIds(m.submenu)
  }
}
collectIds(menu.buildMenuTemplate(h))
ok('自定义项 id 齐全且唯一（MENU_ITEM_ID 全量）', JSON.stringify([...templateIds].sort()) === JSON.stringify(Object.values(menu.MENU_ITEM_ID).sort()), JSON.stringify([...templateIds]))

// 4.2 menuEnabledFor 启用逻辑 vs 口径 §二「启用条件」
const ENABLE_MATRIX = [
  [{ route: 'home', editor: false }, { newProject: true, newChapter: false, save: false, findOpen: false, settings: true }],
  [{ route: 'project', editor: false }, { newProject: false, newChapter: true, save: false, findOpen: false, settings: true }],
  [{ route: 'project', editor: true }, { newProject: false, newChapter: true, save: true, findOpen: true, findUseSel: true, findNext: true, findPrev: true, settings: true }],
  [{ route: 'other', editor: true }, { newProject: false, newChapter: false, save: true, shortcutHelp: true }]
]
let matrixOk = true
const matrixErr = []
for (const [state, exp] of ENABLE_MATRIX) {
  for (const [id, want] of Object.entries(exp)) {
    const got = menu.menuEnabledFor(state, id)
    if (got !== want) { matrixOk = false; matrixErr.push(`${JSON.stringify(state)} ${id}=${got} want=${want}`) }
  }
}
ok('menuEnabledFor 启用矩阵=口径表（4 场景全项）', matrixOk, matrixErr.join('; '))

// 4.3 applyMenuState：按上报态更新模板项 enabled（stub getMenuItemById 从构建模板取；appMenu 已是 155 行注册的）
menu.applyMenuState({ route: 'home', editor: false })
const itNewProj = appMenu.getMenuItemById(menu.MENU_ITEM_ID.newProject)
const itSave = appMenu.getMenuItemById(menu.MENU_ITEM_ID.save)
ok('applyMenuState(home,no-editor)：新建项目 enabled=true、保存 enabled=false', itNewProj.enabled === true && itSave.enabled === false, `newProject=${itNewProj.enabled} save=${itSave.enabled}`)
menu.applyMenuState({ route: 'project', editor: true })
ok('applyMenuState(project,editor)：新建项目 enabled=false、保存 enabled=true', appMenu.getMenuItemById(menu.MENU_ITEM_ID.newProject).enabled === false && appMenu.getMenuItemById(menu.MENU_ITEM_ID.save).enabled === true)

// 4.4 registerMenuActions 已挂 ipcMain 'menu:state' → applyMenuState（stub 记录监听并支持 emit）
ok('ipcMain 已注册 menu:state 监听（恰一次）', Array.isArray(menu.ipcMain._listeners?.['menu:state']) && menu.ipcMain._listeners['menu:state'].length === 1)
menu.ipcMain.emit('menu:state', { route: 'home', editor: false })
ok('ipcMain emit menu:state -> applyMenuState 生效（保存灰显）', appMenu.getMenuItemById(menu.MENU_ITEM_ID.save).enabled === false)

// ---------- 5) Windows/Linux 模板（minimal 口径：docs/系统菜单-设计口径.md §win，2026-09-14 平台层轮） ----------
// 依据（Electron v31.7.7 源码 menu-item-roles.ts）：role 默认 accelerator 按平台取值（close=CmdOrCtrl+W、
// redo win=Control+Y、togglefullscreen win=F11、quit win 无）；显式写会覆盖默认，故 win 分支 role 项不写；
// mac-only role（services/hide/hideOthers/unhide/front/zoom）在 win 无效不出现。
const winTpl = menu.buildMenuTemplate(h, 'win32')
const MAC_ONLY_ROLES = ['services', 'hide', 'hideOthers', 'unhide', 'front', 'zoom']
const rolesIn = (items, out = []) => {
  for (const m of items) {
    if (m.role) out.push(m.role)
    if (Array.isArray(m.submenu)) rolesIn(m.submenu, out)
  }
  return out
}
const allWinRoles = rolesIn(winTpl)
ok('win 顶级菜单=文件/编辑/显示/窗口/帮助（无 mac「织卷」应用菜单）', deepEq(winTpl.map((m) => m.label), ['文件', '编辑', '显示', '窗口', '帮助']), JSON.stringify(winTpl.map((m) => m.label)))
ok('win 模板无 mac-only role', MAC_ONLY_ROLES.every((r) => !allWinRoles.includes(r)), JSON.stringify(allWinRoles))
// role 项不写显式 accelerator（平台默认保留——本次调研的核心：role 默认是按平台的，显式 Cmd 会破坏 win）
const roleItemsNoAcc = (items) => {
  const bad = []
  const walk2 = (items) => {
    for (const m of items) {
      if (m.role && m.accelerator) bad.push(`${m.label}:${m.accelerator}`)
      if (Array.isArray(m.submenu)) walk2(m.submenu)
    }
  }
  walk2(items)
  return bad
}
ok('win 模板 role 项零显式 accelerator（交给平台默认）', roleItemsNoAcc(winTpl).length === 0, JSON.stringify(roleItemsNoAcc(winTpl)))
// 自定义项：id 全量保留 + accelerator CmdOrCtrl 化（accelerator.md：win 上 Command 键无效果）
const winIds = []
const winAcc = {}
const walkIds = (items) => {
  for (const m of items) {
    if (typeof m.id === 'string') { winIds.push(m.id); if (m.accelerator) winAcc[m.id] = m.accelerator }
    if (Array.isArray(m.submenu)) walkIds(m.submenu)
  }
}
walkIds(winTpl)
ok('win 自定义项 id 全量=MENU_ITEM_ID（禁用态可继续工作）', JSON.stringify([...winIds].sort()) === JSON.stringify(Object.values(menu.MENU_ITEM_ID).sort()), JSON.stringify(winIds))
const EXP_WIN_ACC = {
  [menu.MENU_ITEM_ID.settings]: 'CmdOrCtrl+,',
  [menu.MENU_ITEM_ID.save]: 'CmdOrCtrl+S',
  [menu.MENU_ITEM_ID.findOpen]: 'CmdOrCtrl+F',
  [menu.MENU_ITEM_ID.findUseSel]: 'CmdOrCtrl+E',
  [menu.MENU_ITEM_ID.findNext]: 'CmdOrCtrl+G',
  [menu.MENU_ITEM_ID.findPrev]: 'Shift+CmdOrCtrl+G'
}
ok('win 自定义 accelerator 全部 CmdOrCtrl 化=最小口径表', JSON.stringify(Object.keys(winAcc).sort()) === JSON.stringify(Object.keys(EXP_WIN_ACC).sort()) && Object.keys(EXP_WIN_ACC).every((k) => winAcc[k] === EXP_WIN_ACC[k]), JSON.stringify(winAcc))
const findWinItem = (items, label) => {
  for (const m of items) {
    if (m.label === label) return m
    if (Array.isArray(m.submenu)) { const r = findWinItem(m.submenu, label); if (r) return r }
  }
  return null
}
const fileMenu = winTpl.find((m) => m.label === '文件')
const helpMenu = winTpl.find((m) => m.label === '帮助')
ok('win 「设置…/退出织卷」在文件菜单、「关于织卷…」在帮助菜单（平台惯例）', !!findWinItem(fileMenu.submenu, '设置…') && !!findWinItem(fileMenu.submenu, '退出织卷') && !!findWinItem(helpMenu.submenu, '关于织卷…'))
// win 模板自定义 click 分发仍走 handlers（与 mac 同通道）
const gotIdsWin = []
const hw = { onMenuAction: (id) => gotIdsWin.push(id), onAbout: () => gotIdsWin.push('__about__'), onOpenWorkspaceDocs: () => gotIdsWin.push('__docs__') }
walk(menu.buildMenuTemplate(hw, 'win32'))
ok('win 模板自定义 click 分发 id 集合一致（集合相等；模板顺序与 mac 不同故排序比较）', deepEq([...gotIdsWin].sort(), [...expectIds].sort()), JSON.stringify(gotIdsWin))

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
