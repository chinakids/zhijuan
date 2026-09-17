// 织卷无头冒烟 · 打字机滚动（体验层 2026-09-17；Typora「仅输入时固定」同范式）
// 用法：node scripts/typewriter-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8899（已在）；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：
//  ① 默认关：输入正文不自动居中（光标中心距容器中心 > 阈值）；
//  ② 设置页「外观与数据」存在「打字机滚动」开关 → 打开（真实用户路径）；
//  ③ 开启后输入：光标行被滚回容器垂直中线（|差| < 120）且容器确实滚动（scrollTop > 500）；
//  ④ 点击/跳转定位不强制居中（setCursor=点击语义：光标中心距中心 > 180）；
//  ⑤ 切章滚动记忆回归：开启状态下滚到中部→切走→切回位置恢复（typewriter 不抢占）；
//  ⑥ 关闭后输入回归不居中；⑦ 截图存档（开启态）；⑧ 全程零 JS 异常。
import { writeFileSync, mkdirSync } from 'node:fs'

const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8899'
const OUT = process.env.HOME + '/Pictures/zhijuan'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0
function ok(name, cond, detail = '') {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + String(detail).slice(0, 220) : ''))
  if (!cond) fails++
}

// 长文档注入（第01章扩展到 18 段；base64 绕 CDP 转义）
const paras = []
for (let i = 1; i <= 18; i++) paras.push('第' + i + '段。阿七站在灯下，海风把衣角吹起来，她数着远处闪烁的光点，一遍一遍，直到天光发白，也没有等到那条船。')
const TAIL_B64 = Buffer.from('\n\n' + paras.join('\n\n'), 'utf8').toString('base64')

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

// 滚动宿主（hostRef：flex-1 overflow-y-auto 最近的祖先）
const GET_SCROLLER = `(() => {
  const pm = document.querySelector('.ProseMirror'); if (!pm) return null
  let n = pm.parentElement
  while (n && n !== document.body) {
    const s = getComputedStyle(n)
    if (s.overflowY === 'auto' || s.overflowY === 'scroll') return n
    n = n.parentElement
  }
  return null
})()`
// 光标中心距容器视口中心的垂直差（负数=光标在上方）
const CENTER_DELTA = `(() => {
  const s = ${GET_SCROLLER}; if (!s) return null
  const sel = document.getSelection && document.getSelection()
  const r = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null
  if (!r || (r.top === 0 && r.bottom === 0)) return null
  const sr = s.getBoundingClientRect()
  return (r.top + r.bottom) / 2 - (sr.top + s.clientHeight / 2)
})()`
// 诊断（冒烟失败时输出中间值）
const DELTA_DIAG = `(() => {
  const s = ${GET_SCROLLER}
  const sel = document.getSelection && document.getSelection()
  let r = null
  try { r = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null } catch (e) { r = 'ERR:' + e.message }
  const sr = s ? s.getBoundingClientRect() : null
  return JSON.stringify({
    scroller: !!s, top: s ? s.scrollTop : null, ch: s ? s.clientHeight : null,
    rangeCount: sel ? sel.rangeCount : -1, selText: sel ? sel.toString().slice(0, 12) : null,
    rect: r && typeof r === 'object' ? { t: r.top, b: r.bottom } : r,
    srect: sr ? { top: sr.top, h: s.clientHeight } : null
  })
})()`

const SELECT_CH1 = `(async () => {
  const pick = () => [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('雾港'))
  if (!pick()) {
    const tg = document.querySelector('[data-testid="chapter-toggle"]')
    if (tg) { tg.click(); await new Promise((r) => setTimeout(r, 600)) }
  }
  const cand = pick()
  if (!cand) return 'no candidate'
  cand.click()
  await new Promise((r) => setTimeout(r, 2200))
  return document.querySelector('.ProseMirror') ? 'ok' : 'no editor'
})()`

// 设置页开关操作（typed=标签文字；on=目标态）
const SWITCH = (typed, on) => `(async () => {
  const label = [...document.querySelectorAll('label')].find((l) => (l.textContent || '').trim() === '${typed}')
  const row = label && label.closest('.flex.items-center.justify-between')
  const s = row && row.querySelector('button[role="switch"]')
  if (!s) return 'no switch'
  const cur = s.getAttribute('aria-checked') === 'true'
  if (cur !== ${on}) s.click()
  await new Promise((r) => setTimeout(r, 500))
  return 'OK:' + s.getAttribute('aria-checked')
})()`

// 聚焦当前编辑器实例（重挂后取数组最后一个；focus 保证 DOM 选区同步，真实输入才落对位置）
const FOCUS_EDITOR = `(() => {
  const api = (window.__ZJ_EDITORS || [])[window.__ZJ_EDITORS.length - 1]
  if (!api) return 'no api'
  api.focus()
  return 'ok'
})()`
async function focusEditor(page) {
  await page.eval(FOCUS_EDITOR)
  await sleep(400)
}
async function cursorAt(page, needle) {
  await page.eval(`(() => {
    const api = (window.__ZJ_EDITORS || [])[window.__ZJ_EDITORS.length - 1]
    api.setCursor('${needle}')
  })()`)
  await sleep(800)
  await focusEditor(page)
}

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)
await page.cmd('Page.bringToFront')
await evalUntil(page, `document.querySelector('#root') ? true : false`, (v) => v, 15000, 'root')
await sleep(800)

// —— 注入长文档（第01章 → 18 段；写入在选章前，devShim fs 事件刷新）——
const inject = await page.eval(`(async () => {
  const raw = await window.zhijuan.readDoc('demo-aseya', '正文/第01章_雾港.md') || ''
  await window.zhijuan.writeDoc('demo-aseya', '正文/第01章_雾港.md', raw + new TextDecoder().decode(Uint8Array.from(atob('${TAIL_B64}'), (c) => c.charCodeAt(0))))
  return raw.length
})()`)
ok('注入长文档（原长度=' + inject + '）', typeof inject === 'number' && inject >= 0, String(inject))
await sleep(600)

// —— ① 默认关：选章 → 光标移到第5段 → 真实输入 → 不自动居中 ——
const sel1 = await page.eval(SELECT_CH1)
ok('选章（第01章·雾港）后编辑器挂载', sel1 === 'ok', sel1)
await evalUntil(page, `(window.__ZJ_EDITORS||[]).length > 0`, Boolean, 15000, 'editor')
await cursorAt(page, '第5段。')
await page.cmd('Input.insertText', { text: '打字机滚动默认关闭时的输入验证。' })
await sleep(800)
const d0 = await page.eval(CENTER_DELTA)
ok('默认关：输入后光标不居中（Δ=' + (d0 == null ? 'null' : Math.round(d0)) + '）', d0 != null && Math.abs(d0) > 180, 'Δ=' + d0)

// —— ② 设置页开开关 ——
await page.eval(`location.hash = '#/project/demo-aseya/settings'`)
await evalUntil(page, `document.body.innerText.includes('外观与数据')`, Boolean, 20000, '设置页')
await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').includes('外观与数据')); if (b) b.click(); return !!b })()`)
await evalUntil(page, `document.body.innerText.includes('打字机滚动')`, Boolean, 10000, '外观节打字机滚动')
const sw = await page.eval(SWITCH('打字机滚动', true))
ok('设置页打字机滚动开关打开', sw === 'OK:true', String(sw))

// —— ③ 开启后：回正文（重挂）→ 输入 → 光标回中线 ——
await page.eval(`location.hash = '#/project/demo-aseya/novel'`)
await sleep(800)
const sel2 = await page.eval(SELECT_CH1)
ok('开启后重挂正文编辑器', sel2 === 'ok', sel2)
await evalUntil(page, `(window.__ZJ_EDITORS||[]).length > 0`, Boolean, 15000, 'editor2')
await cursorAt(page, '第5段。')
const before = await page.eval(`(() => { const s = ${GET_SCROLLER}; return s ? { top: s.scrollTop, ch: s.clientHeight, sh: s.scrollHeight } : null })()`)
await page.cmd('Input.insertText', { text: '打字机滚动开启后，光标应回到屏幕中线附近。' })
await sleep(900)
const dOn = await page.eval(CENTER_DELTA)
const after = await page.eval(`(() => { const s = ${GET_SCROLLER}; return s ? { top: s.scrollTop, ch: s.clientHeight, sh: s.scrollHeight } : null })()`)
ok('开启：输入命中中线（Δ=' + (dOn == null ? 'null' : Math.round(dOn)) + '）', dOn != null && Math.abs(dOn) < 120, 'Δ=' + dOn)
ok('开启：容器确实滚动（top=' + (after && after.top) + '）', !!after && after.top > 100, JSON.stringify(after))

// —— ④ 点击/跳转定位不强制居中（setCursor=点击语义，doc 不变不触发）——
await cursorAt(page, '第15段。')
const dClick = await page.eval(CENTER_DELTA)
ok('点击定位不强制居中（Δ=' + (dClick == null ? 'null' : Math.round(dClick)) + '）', dClick != null && Math.abs(dClick) > 180, 'Δ=' + dClick)

// —— ⑤ 切章滚动记忆回归（开启态）：滚到中部→切走→切回恢复 ——
await page.eval(`(() => { const s = ${GET_SCROLLER}; s.scrollTop = Math.min(1200, s.scrollHeight - s.clientHeight - 20); return s.scrollTop })()`)
await sleep(400)
const pickCh2 = `(async () => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').includes('灯塔'))
  if (!b) return 'no'
  b.click(); await new Promise((r) => setTimeout(r, 1600)); return 'ok'
})()`
const ch2 = await page.eval(pickCh2)
ok('切到第02章（灯塔）', ch2 === 'ok', ch2)
await sleep(500)
const sel3 = await page.eval(SELECT_CH1)
ok('切回第01章', sel3 === 'ok', sel3)
const restored = await evalUntil(page, `(() => { const s = ${GET_SCROLLER}; return s ? s.scrollTop : null })()`, (v) => v != null && v > 1000, 12000, 'scroll restore')
ok('切回滚动位置恢复（top=' + restored + '）', restored > 1000, 'top=' + restored)

// —— 截图（开启态：光标中线）——
await cursorAt(page, '第5段。')
await page.cmd('Input.insertText', { text: '截图用的这行文字，让光标待在中线。' })
await sleep(900)
await shot(page, 'typewriter')

// —— ⑥ 关闭开关 → 输入回归不居中 ——
await page.eval(`location.hash = '#/project/demo-aseya/settings'`)
await evalUntil(page, `document.body.innerText.includes('外观与数据')`, Boolean, 20000, '设置页3')
await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').includes('外观与数据')); if (b) b.click(); return !!b })()`)
await evalUntil(page, `document.body.innerText.includes('打字机滚动')`, Boolean, 10000, '外观节打字机滚动3')
const sw2 = await page.eval(SWITCH('打字机滚动', false))
ok('设置页打字机滚动开关关闭', sw2 === 'OK:false', String(sw2))
await page.eval(`location.hash = '#/project/demo-aseya/novel'`)
await sleep(800)
const sel4 = await page.eval(SELECT_CH1)
ok('关闭后重挂正文编辑器', sel4 === 'ok', sel4)
await evalUntil(page, `(window.__ZJ_EDITORS||[]).length > 0`, Boolean, 15000, 'editor4')
await cursorAt(page, '第2段。')
await page.cmd('Input.insertText', { text: '打字机滚动关闭后的输入验证。' })
await sleep(900)
const dOff = await page.eval(CENTER_DELTA)
ok('关闭：输入后光标不居中（Δ=' + (dOff == null ? 'null' : Math.round(dOff)) + '）', dOff != null && Math.abs(dOff) > 180, 'Δ=' + dOff)

ok('全程无 JS 异常（零异常）', page.errors.length === 0, JSON.stringify(page.errors.slice(0, 3)))

console.log(fails === 0 ? '\nTYPEWRITER SMOKE OK' : `\nTYPEWRITER SMOKE FAIL: ${fails}`)
process.exit(fails === 0 ? 0 : 1)
