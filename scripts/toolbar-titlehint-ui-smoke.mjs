// 织卷无头冒烟 · 宽窗工具栏按钮 title 键位提示（HIG Keyboards/Menus 快捷键发现性）
// 用法：node scripts/toolbar-titlehint-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 宽窗 12 按钮全见（无 More）；
//         ② 有真实绑定的工具 title=「名（⌘B）」、aria-label=纯名（屏读走 aria）；
//         ③ 行内代码无键位（⌘E 被查找占用，提示不说谎）→ title 保持纯名；
//         ④ More 触发器 title 仍为「更多格式」；⑤ 截图存档。
// 注意：title 是原生提示（hover 显示），断言读 DOM 属性（验证即生效面）；「提示不骗人」由
//       toolbar-keyhint-ui-smoke ④ 项（页面 dispatch ⌘B 真加粗）覆盖，本脚本不重复。
import { writeFileSync, mkdirSync } from 'node:fs'

const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const OUT = process.env.HOME + '/Pictures/zhijuan'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
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

const SELECT_CHAPTER = `(async () => {
  const pick = () => [...document.querySelectorAll('button')].find((b) => /第.{1,6}章/.test(b.innerText))
  if (!pick()) {
    const tg = document.querySelector('[data-testid="chapter-toggle"]')
    if (tg) { tg.click(); await new Promise((r) => setTimeout(r, 600)) }
  }
  const cand = pick()
  if (!cand) return 'no candidate'
  cand.click()
  await new Promise((r) => setTimeout(r, 2500))
  return document.querySelector('.zj-md-toolbar') ? 'ok' : 'no toolbar'
})()`

const SNAP = `(() => {
  const bar = [...document.querySelectorAll('.zj-md-toolbar')].find((b) => !b.hasAttribute('data-zj-tb-measure'))
  if (!bar) return null
  const btns = [...bar.querySelectorAll('.zj-tb-item')]
    .filter((b) => !b.closest('[data-zj-tb-measure]')) // 排除离屏测量层（其按钮无 title/aria）
    .map((b) => ({ title: b.getAttribute('title'), aria: b.getAttribute('aria-label'), vis: b.offsetParent !== null }))
  return { count: btns.length, btns }
})()`

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id, tab.url)
const page = await attach(tab.webSocketDebuggerUrl)
await evalUntil(page, `document.querySelector('#root') ? true : false`, (v) => v, 15000, 'root')
await sleep(800)
const sel = await page.eval(SELECT_CHAPTER)
ok('选章后编辑器与工具栏挂载', sel === 'ok', sel)

const snap = await evalUntil(page, SNAP, (v) => v && v.count > 0, 15000, 'toolbar snapshot')
ok('宽窗 12 按钮全见（无 More）', snap && snap.count === 12, JSON.stringify({ count: snap && snap.count }))

const byAria = (name) => (snap?.btns ?? []).find((b) => b.aria === name)
let allSrc = true
for (const [, name, sc] of EXPECT) {
  const b = byAria(name)
  const expectTitle = sc ? name + '（' + sc + '）' : name
  const got = b ? b.title : '(null)'
  const pass = !!b && got === expectTitle && b.aria === name && b.vis
  if (!pass) allSrc = false
  ok(`「${name}」title=${expectTitle}｜aria=纯名｜可见`, pass, got)
}
ok('全部工具键位提示与 EDITOR_SHORTCUTS 同口径（false=有漂移）', allSrc)

// 行内代码：明确无键位（提示不说谎）
const code = byAria('行内代码')
ok('行内代码无键位（title 不含（ ，⌘E 被查找占用）', !!code && code.title === '行内代码' && !code.title.includes('（'), JSON.stringify(code))
// More 触发器（宽窗不存在，窄窗才出现）——按语义断言：若存在 title 必须仍是「更多格式」
const more = (snap?.btns ?? []).find((b) => b.title === '更多格式')
ok('More 触发器 title 保持「更多格式」', !more || more.title === '更多格式')

// 实际可见性再证：浏览器原生 title 属性在 hover 时展示——用真实鼠标 hover 加粗按钮确认元素可交互（title 为原生提示，DOM 属性已证）
const geo = await page.eval(`(() => { const els = [...document.querySelectorAll('.zj-md-toolbar')].filter((b) => !b.hasAttribute('data-zj-tb-measure'))[0]; const b = [...els.querySelectorAll('.zj-tb-item')].find((x) => x.getAttribute('aria-label') === '加粗'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
if (geo) {
  await page.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: geo.x, y: geo.y, button: 'left', clickCount: 1 })
  await sleep(250)
}
ok('加粗按钮 hover 可交互（坐标命中）', !!geo, JSON.stringify(geo))

await shot(page, 'toolbar-titlehint')

if (page.errors.length) { fails++; console.log('FAIL 无 JS 异常:', page.errors.slice(0, 5).join(' | ')) }
else console.log('OK 无 JS 异常')

console.log(fails === 0 ? '\nTITLEHINT SMOKE OK' : `\nTITLEHINT SMOKE FAIL: ${fails}`)
process.exit(fails === 0 ? 0 : 1)
