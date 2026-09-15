// 织卷无头冒烟 · 搜索框走查落地（体验层 2026-09-15 14:15 轮，HIG Search fields）
// 验收：① 首页搜索=即时过滤（不依赖 type=search 原生语义）；
//       ② 首页 clear 按钮：非空显示/点击清空+回焦输入框/空时隐藏；
//       ③ 首页 Esc：清空查询+恢复全量+焦点保持（macOS 搜索框惯例）；
//       ④ 素材库同口径：Esc 清空+回浏览态，「清除」按钮点击清空+回焦；
//       ⑤ clear 是原生 button（键盘可达）且带 aria-label；截图两档。
import { writeFileSync, mkdirSync } from 'node:fs'

const CDP = 'http://127.0.0.1:9224'
const SPA = process.env.ZJ_SMOKE_BASE || 'http://127.0.0.1:8123'

const r = await fetch(`${CDP}/json/new?${encodeURIComponent(`${SPA}/#/?cb=${Date.now()}`)}`, { method: 'PUT' })
const target = await r.json()
const ws = new WebSocket(target.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
}
function cmd(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++seq
    pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
}
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
await new Promise((res) => (ws.onopen = res))
await cmd('Page.enable')
async function evalJs(expr) {
  const rr = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true })
  if (rr.exceptionDetails) throw new Error('eval ex: ' + JSON.stringify(rr.exceptionDetails))
  return rr.result?.value
}
async function evalUntil(expr, pred, timeout = 25000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const v = await evalJs(expr)
    if (pred ? pred(v) : v) return v
    await sleep(600)
  }
  throw new Error('timeout: ' + expr)
}
async function setInput(selector, value) {
  const rr = await evalJs(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return 'NO_INPUT'
    el.focus()
    const proto = Object.getPrototypeOf(el)
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    setter.call(el, ${JSON.stringify(value)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return 'OK'
  })()`)
  if (rr !== 'OK') throw new Error('setInput failed ' + selector + ' -> ' + rr)
}
async function pressEsc() {
  // 坑（2026-09-15 实测）：CDP Input.dispatchKeyEvent 发真实 Escape 后会毒害后续合成 input 事件
  // （React 受控 onChange 不再响应页面内 dispatchEvent），故 Esc 一律用页面内 dispatch KeyboardEvent：
  // React onKeyDown 正常受理（defaultPrevented 可见），且无浏览器默认行为副作用。
  return evalJs(`(() => {
    const ev = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })
    ;(document.activeElement || document.body).dispatchEvent(ev)
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true }))
    return ev.defaultPrevented
  })()`)
}
async function shot(name, w, h) {
  await cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false })
  await sleep(400)
  const s = await cmd('Page.captureScreenshot', { format: 'png' })
  const dir = process.env.HOME + '/Pictures/zhijuan'
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${dir}/${name}.png`, Buffer.from(s.data, 'base64'))
  console.log('SHOT', `${dir}/${name}.png`)
}

let fails = 0
const ok = (m) => console.log('ok  -', m)
const bad = (m, extra) => {
  fails++
  console.log('BAD -', m, extra ?? '')
}

await evalUntil(`document.body.innerText.includes('项目库')`, Boolean)
await sleep(800)

const homeState = () =>
  evalJs(`(() => ({
    val: document.querySelector('[data-testid="home-search"]')?.value ?? null,
    hasClear: !!document.querySelector('[data-testid="home-search-clear"]'),
    clearAria: document.querySelector('[data-testid="home-search-clear"]')?.getAttribute('aria-label') ?? null,
    cards: [...document.querySelectorAll('[role="button"][aria-label^="打开项目"]')].length,
    emptySearch: !!document.querySelector('[data-testid="empty-search"]'),
    focused: document.activeElement === document.querySelector('[data-testid="home-search"]')
  }))()`)

// ① 初始：无清空按钮 + 全量
let s = await homeState()
if (s.val === '' && !s.hasClear && s.cards >= 1) ok('① 初始：空查询无 clear 按钮，全量 ' + s.cards + ' 卡')
else bad('① 初始态异常', JSON.stringify(s))

// ② 即时过滤：输入「余烬」→ 命中 + clear 出现
await setInput('[data-testid="home-search"]', '余烬')
await sleep(500)
s = await homeState()
if (s.val === '余烬' && s.cards === 1 && s.hasClear) ok('② 即时过滤：输入即命中 1 卡，clear 出现')
else bad('② 即时过滤', JSON.stringify(s))

// ③ 点击 clear → 清空 + 恢复全量 + 焦点回输入框
await evalJs(`document.querySelector('[data-testid="home-search-clear"]').click()`)
await sleep(400)
s = await homeState()
if (s.val === '' && !s.hasClear && s.cards === 3 && s.focused) ok('③ clear 点击：清空/恢复/回焦均达成')
else bad('③ clear 点击', JSON.stringify(s))

// ④ Esc：无命中词 → 空态；Esc → 清空 + 恢复 + 焦点保持
await setInput('[data-testid="home-search"]', 'zzz不存在的项目xyz')
await evalUntil(`!!document.querySelector('[data-testid="empty-search"]')`, Boolean, 10000)
const dp4 = await pressEsc()
await sleep(500)
s = await homeState()
if (s.val === '' && !s.hasClear && s.cards === 3 && !s.emptySearch && s.focused)
  ok('④ Esc：清空查询/恢复全量/焦点保持/空态消失（defaultPrevented=' + dp4 + '）')
else bad('④ Esc 行为', JSON.stringify(s))

// ⑤ Esc 无值时不动（不产生副作用，焦点仍在）
await pressEsc()
await sleep(300)
s = await homeState()
if (s.val === '' && s.cards === 3) ok('⑤ 无值 Esc：无副作用')
else bad('⑤ 无值 Esc', JSON.stringify(s))

await shot('search-fields-home-1415', 1200, 800)

// ⑦ clear 是原生 button（键盘可达）且带 aria-label
await setInput('[data-testid="home-search"]', '余烬')
await sleep(300)
const tag = await evalJs(`(() => {
  const el = document.querySelector('[data-testid="home-search-clear"]')
  if (!el) return null
  return { tag: el.tagName, aria: el.getAttribute('aria-label'), tabIndex: el.tabIndex }
})()`)
if (tag && tag.tag === 'BUTTON' && tag.aria === '清空搜索') ok('⑦ 首页 clear=原生 button+aria-label（tabIndex ' + tag.tabIndex + '）')
else bad('⑦ clear 按钮属性', JSON.stringify(tag))

// ⑥ 素材库：进项目 → 素材库
await evalJs(`document.querySelector('[aria-label="打开项目 余烬的灯"]').click()`)
await evalUntil(`[...document.querySelectorAll('a')].some((a) => (a.innerText || '').includes('素材库'))`, Boolean, 20000)
await evalJs(`[...document.querySelectorAll('a')].find((a) => (a.innerText || '').includes('素材库')).click()`)
await evalUntil(`!!document.querySelector('[data-testid="lib-search"]')`, Boolean, 20000)
await sleep(500)
const libState = () =>
  evalJs(`(() => ({
    val: document.querySelector('[data-testid="lib-search"]')?.value ?? null,
    hasClear: !!document.querySelector('[data-testid="lib-search-clear"]'),
    resultText: document.body.innerText.includes('搜索结果（'),
    focused: document.activeElement === document.querySelector('[data-testid="lib-search"]')
  }))()`)

// ⑥a 输入「图书馆」→ 出结果 + 清除按钮
await setInput('[data-testid="lib-search"]', '图书馆')
await evalUntil(`document.body.innerText.includes('搜索结果（') && !!document.querySelector('[data-testid="lib-search-clear"]')`, Boolean, 12000)
ok('⑥a 素材库搜索：「图书馆」出结果 + 清除按钮出现')
// ⑥a+ 素材库搜索态截图（含结果 + 清除按钮）
await shot('search-fields-lib-1415', 1200, 800)

// ⑥b Esc → 清空 + 回浏览态（结果消失）+ 焦点保持
await pressEsc()
await sleep(500)
s = await libState()
if (s.val === '' && !s.hasClear && !s.resultText && s.focused) ok('⑥b 素材库 Esc：清空/回浏览态/焦点保持')
else bad('⑥b 素材库 Esc', JSON.stringify(s))

// ⑥c 输入再点「清除」→ 清空 + 回焦
await setInput('[data-testid="lib-search"]', '图书馆')
await evalUntil(`!!document.querySelector('[data-testid="lib-search-clear"]')`, Boolean, 12000)
await evalJs(`document.querySelector('[data-testid="lib-search-clear"]').click()`)
await sleep(500)
s = await libState()
if (s.val === '' && !s.hasClear && !s.resultText && s.focused) ok('⑥c 素材库「清除」点击：清空/回浏览态/回焦')
else bad('⑥c 素材库清除点击', JSON.stringify(s))

console.log(fails === 0 ? 'ALL PASS' : `FAILS=${fails}`)
ws.close()
process.exit(fails === 0 ? 0 : 1)
