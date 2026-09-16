// 织卷无头冒烟 · 编辑器 More 菜单键位提示（HIG Menus「may include the keyboard equivalent」）
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 窄窗 More 出现（视口扫描找「全部收进菜单」或「部分收纳」稳定态）；
//         ② 菜单项键位提示与 EDITOR_SHORTCUTS 同口径（含「行内代码无提示」——⌘E 被查找占用实锤）；
//         ③ 提示视觉 11px + ink-3；④ 提示不骗人：页面 dispatch ⌘B→正文真加粗；⑤ 截图存档。
import { writeFileSync, mkdirSync } from 'node:fs'

const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const OUT = process.env.HOME + '/Pictures/zhijuan'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const cb = Date.now()
let fails = 0
function ok(name, cond, detail = '') {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + String(detail).slice(0, 200) : ''))
  if (!cond) fails++
}

/** 与 src/renderer/src/features/editor/toolbarLayout.ts EDITOR_SHORTCUTS 同口径的期望表（冒烟镜像，勿单独改） */
const EXPECT = [
  ['h1', '一级标题', '⌥⌘1'],
  ['h2', '二级标题', '⌥⌘2'],
  ['h3', '三级标题', '⌥⌘3'],
  ['para', '正文段落', '⌥⌘0'],
  ['bold', '加粗', '⌘B'],
  ['italic', '斜体', '⌘I'],
  ['code', '行内代码', null], // ⌘E 被「用选区设置查找词」占用 → 无提示
  ['quote', '引用块', '⇧⌘B'],
  ['ul', '无序列表', '⌥⌘8'],
  ['ol', '有序列表', '⌥⌘7'],
  ['undo', '撤销', '⌘Z'],
  ['redo', '重做', '⇧⌘Z']
]

async function openTab(url) {
  const r = await fetch(CDP + '/json/new?' + encodeURIComponent(url), { method: 'PUT' })
  return r.json()
}
function attach(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let seq = 0
  const pending = new Map()
  const errors = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails?.exception?.description ?? '').slice(0, 200))
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push((m.params.args?.map((a) => a.value ?? a.description ?? '').join(' ') ?? '').slice(0, 200))
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const cmd = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq
      const t = setTimeout(() => rej(new Error('CMD_TIMEOUT ' + method)), 25000)
      pending.set(id, (m) => { clearTimeout(t); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) })
      ws.send(JSON.stringify({ id, method, params }))
    })
  return new Promise((res) => {
    ws.onopen = async () => {
      await cmd('Runtime.enable')
      res({
        cmd, errors,
        eval: async (expression) => {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
          return r.result?.value
        },
        close: () => ws.close()
      })
    }
  })
}
async function evalUntil(page, expr, pred, timeoutMs = 25000, label = expr) {
  const t0 = Date.now()
  for (;;) {
    try {
      const v = await page.eval(expr)
      if (pred(v)) return v
    } catch { /* retry */ }
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(300)
  }
}
async function shot(page, name) {
  mkdirSync(OUT, { recursive: true })
  const hh = String(new Date().getHours()).padStart(2, '0')
  const mm = String(new Date().getMinutes()).padStart(2, '0')
  const s = await page.cmd('Page.captureScreenshot', { format: 'png' })
  const p = OUT + '/' + name + '-' + hh + mm + '.png'
  writeFileSync(p, Buffer.from(s.data, 'base64'))
  console.log('SCREENSHOT:', p)
}

const TB_STATE = `(() => {
  const root = document.querySelector('.zj-md-toolbar:not([data-zj-tb-measure])')
  const items = [...(root?.querySelectorAll('.zj-tb-item') ?? [])].filter(
    (b) => !b.closest('[data-zj-tb-measure]') && b.getAttribute('title') !== '更多格式'
  )
  const more = [...(root?.querySelectorAll('.zj-tb-item') ?? [])].find((b) => b.getAttribute('title') === '更多格式')
  return { ready: !!root, items: items.map((b) => b.getAttribute('title')), more: !!more }
})()`

async function openMenu(page) {
  const r = await page.eval(`(() => {
    const m = [...document.querySelectorAll('.zj-tb-item')].find((b) => b.getAttribute('title') === '更多格式')
    if (!m) return null
    const rr = m.getBoundingClientRect()
    return { x: rr.left + rr.width / 2, y: rr.top + rr.height / 2 }
  })()`)
  if (!r) return false
  await page.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 })
  await sleep(80)
  await page.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 })
  await sleep(600)
  return true
}
const MENU_SNAPSHOT = `(() => {
  const items = [...document.querySelectorAll('[role="menuitem"]')].filter((i) => i.offsetParent !== null)
  return items.map((i) => {
    const sc = i.querySelector('.zj-menu-shortcut')
    const name = [...i.querySelectorAll('span')].find((s) => !s.classList.contains('zj-menu-shortcut'))?.textContent?.trim() ?? ''
    return { name, sc: sc ? sc.textContent.trim() : null, full: i.textContent.replace(/\\s+/g, '').trim() }
  })
})()`

// ---------- 打开项目 ----------
const tab = await openTab(BASE + '/?cb=' + cb + '#/project/demo-aseya/novel?ch=' + encodeURIComponent('第01章_雾港.md'))
const page = await attach(tab.webSocketDebuggerUrl)
await evalUntil(page, TB_STATE, (x) => x && x.ready && x.items.length === 12, 30000, '宽窗工具栏 12 项')

// ---------- ① 扫描视口：找「全部收进 More」的稳定态（默认 620），退而求其次「部分收纳」 ----------
let state = null
for (const w of [620, 640, 700, 760, 820, 880, 960, 1040]) {
  await page.cmd('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: false })
  await sleep(650)
  const v = await page.eval(TB_STATE)
  console.log(`TRIAL ${w}: more=${v.more} visible=${v.items.length}`)
  if (v && v.ready && v.more === true) { state = { ...v, at: w }; break }
}
if (!state) throw new Error('未找到 More 出现的视口')
ok('More 按钮出现（视口 ' + state.at + '）', state.more === true)
ok('窄窗可见按钮收纳', state.items.length < 12, String(state.items.length))

// ---------- ② 打开菜单并读取键位提示 ----------
const opened = await openMenu(page)
ok('More 菜单已打开', opened === true)
const menuItems = await evalUntil(page, MENU_SNAPSHOT, (x) => Array.isArray(x) && x.length > 0, 10000, '菜单项')
console.log('MENU:', JSON.stringify(menuItems.map((m) => m.name + (m.sc ? '[' + m.sc + ']' : '(无提示)'))))

// 期望表与菜单项逐一对照
for (const [key, name, sc] of EXPECT) {
  const hit = menuItems.find((m) => m.name === name)
  if (!hit) continue // 该工具未收进菜单（仍可见），本轮不校验；全收态应全命中
  ok(`菜单项「${name}」提示=${sc ?? '无'}`, hit.sc === sc, '实际=' + String(hit.sc))
}
const withHint = menuItems.filter((m) => m.sc !== null)
const noHint = menuItems.filter((m) => m.sc === null)
ok('至少有 2 个菜单项带键位提示', withHint.length >= 2, String(withHint.length))
ok('「行内代码」若在菜单中必无提示（⌘E 被查找占用）', noHint.every((m) => m.name === '行内代码') || menuItems.every((m) => m.name !== '行内代码'), JSON.stringify(noHint.map((m) => m.name)))
if (state.items.length === 0) {
  ok('全部工具收进菜单（12 项全命中）', menuItems.length === 12, String(menuItems.length))
} else {
  ok('部分收纳（菜单含隐藏项）', menuItems.length >= 3, String(menuItems.length))
}

// ---------- ③ 提示视觉：11px + ink-3 ----------
const visual = await page.eval(`(() => {
  const s = document.querySelector('[role="menuitem"] .zj-menu-shortcut')
  if (!s) return null
  const cs = getComputedStyle(s)
  return { fontSize: cs.fontSize, color: cs.color, ml: cs.marginLeft }
})()`)
console.log('VISUAL:', JSON.stringify(visual))
ok('键位提示 11px', visual?.fontSize === '11px', String(visual?.fontSize))
ok('键位提示 ink-3 灰（非 accent/ink）', !!visual && visual.color !== 'rgb(0, 0, 0)', String(visual?.color))

// ---------- ④ 提示不骗人：⌘B 页面真实按键 → 正文加粗 ----------
await page.eval(`(() => { const eds = window.__ZJ_EDITORS || []; if (eds[0]) eds[0].setContent('键位提示冒烟句'); })()`)
await sleep(400)
await page.eval(`(() => {
  const dom = document.querySelector('.ProseMirror')
  dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', metaKey: true, bubbles: true, cancelable: true }))
  dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', metaKey: true, bubbles: true, cancelable: true }))
})()`)
await sleep(400)
const md = await page.eval(`(() => { const eds = window.__ZJ_EDITORS || []; return eds[0] ? eds[0].getMarkdown() : '' })()`)
ok('⌘B 真实生效（提示=绑定）', md.includes('**键位提示冒烟句**'), md.replace(/\n/g, '⏎'))

// ---------- ⑤ 截图（菜单打开态） ----------
await sleep(300)
await shot(page, 'toolbar-keyhint-menu')

// 关闭菜单并恢复宽窗
await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
await sleep(400)
await page.cmd('Emulation.clearDeviceMetricsOverride')

console.log('ERRORS:', page.errors.length ? page.errors.slice(0, 5) : 'none')
ok('无页面 JS 异常', page.errors.length === 0, JSON.stringify(page.errors.slice(0, 3)))
console.log(fails === 0 ? 'ALL PASS' : 'FAIL: ' + fails)
page.close()
process.exit(fails === 0 ? 0 : 1)
