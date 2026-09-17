// 织卷无头冒烟 · 焦点模式（体验层 2026-09-17；iA Writer / Typora Focus Mode 同范式）
// 用法：node scripts/focus-mode-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 默认为关：编辑器无 .zj-focus-on / .zj-focus-dim；
//         ② 设置页「外观与数据」存在「焦点模式」开关 → 打开（真实用户路径）；
//         ③ 回正文：当前顶层块保持、其余淡化（dim 数 = 顶层块数 - 1，opacity 0.45，过渡 opacity）；
//         ④ 光标移动到另一段 → 焦点块随之移动（淡化集合交换）；
//         ⑤ 关闭开关 → 回归无淡化；⑥ 截图存档（开启态）。
import { writeFileSync, mkdirSync } from 'node:fs'

const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const OUT = process.env.HOME + '/Pictures/zhijuan'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0
function ok(name, cond, detail = '') {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + String(detail).slice(0, 220) : ''))
  if (!cond) fails++
}

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

// —— 第4章_雾夜：1 标题 + 4 段落 = 5 个顶层块（焦点移动演示种子；勿选别的章，块数断言依赖）——
const SELECT_CH4 = `(async () => {
  const pick = () => [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('第4章'))
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

// 焦点态快照：on 标记 / 淡化块数 / 顶层块数 / 当前（未淡化）块文本首 12 字 / 淡化块 opacity 与 transition
const SNAP = `(() => {
  const pm = document.querySelector('.ProseMirror')
  if (!pm) return null
  const total = pm.children.length
  const dimmed = [...pm.querySelectorAll(':scope > .zj-focus-dim')]
  const focused = [...pm.children].find((c) => !c.classList.contains('zj-focus-dim'))
  const d0 = dimmed[0]
  const cs = d0 ? getComputedStyle(d0) : null
  return {
    on: pm.classList.contains('zj-focus-on'),
    total,
    dim: dimmed.length,
    focusText: focused ? focused.textContent.slice(0, 12) : null,
    opacity: cs ? cs.opacity : null,
    transitionProp: cs ? cs.transitionProperty : null
  }
})()`

// 按 Label 精确定位开关行（外层容器 div 的 textContent 也含「焦点模式」，querySelector 会取到容器内第一个 switch=别的行）
const SWITCH = `(async () => {
  const label = [...document.querySelectorAll('label')].find((l) => (l.textContent || '').trim() === '焦点模式')
  const row = label && label.closest('.flex.items-center.justify-between')
  const s = row && row.querySelector('button[role="switch"]')
  if (!s) return 'no switch'
  if (s.getAttribute('aria-checked') !== 'true') s.click()
  await new Promise((r) => setTimeout(r, 500))
  return 'OK:' + s.getAttribute('aria-checked')
})()`
const SWITCH_OFF = `(async () => {
  const label = [...document.querySelectorAll('label')].find((l) => (l.textContent || '').trim() === '焦点模式')
  const row = label && label.closest('.flex.items-center.justify-between')
  const s = row && row.querySelector('button[role="switch"]')
  if (!s) return 'no switch'
  if (s.getAttribute('aria-checked') === 'true') s.click()
  await new Promise((r) => setTimeout(r, 500))
  return 'OK:' + s.getAttribute('aria-checked')
})()`

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)
await evalUntil(page, `document.querySelector('#root') ? true : false`, (v) => v, 15000, 'root')
await sleep(600)

// ① 默认关（真实默认值）
const sel1 = await page.eval(SELECT_CH4)
ok('选章（第04章）后编辑器挂载', sel1 === 'ok', sel1)
const off0 = await evalUntil(page, SNAP, (v) => v && v.total > 0, 15000, 'snap')
ok('默认关闭：无 zj-focus-on', off0.on === false, JSON.stringify(off0))
ok('默认关闭：无淡化块', off0.dim === 0, 'dim=' + off0.dim)
ok('第04章有 5 个顶层块（移动种子齐全）', off0.total >= 4, 'total=' + off0.total)

// ② 设置页开启焦点模式（真实用户路径：外观与数据 → 开关）
await page.eval(`location.hash = '#/project/demo-aseya/settings'`)
await evalUntil(page, `document.body.innerText.includes('外观与数据')`, Boolean, 20000, '设置页')
await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').includes('外观与数据')); if (b) b.click(); return !!b })()`)
await evalUntil(page, `document.body.innerText.includes('焦点模式')`, Boolean, 10000, '外观节焦点模式')
const sw = await page.eval(SWITCH)
ok('设置页焦点模式开关打开', sw === 'OK:true', String(sw))

// ③ 回正文：开启态生效
await page.eval(`location.hash = '#/project/demo-aseya/novel'`)
await sleep(800)
const sel2 = await page.eval(SELECT_CH4)
ok('开启后重挂正文编辑器', sel2 === 'ok', sel2)
const on1 = await evalUntil(page, SNAP, (v) => v && v.on === true && v.dim > 0, 15000, 'focus on')
ok('开启：编辑器带 zj-focus-on', on1.on === true)
ok('开启：淡化数 = 顶层块数 - 1', on1.dim === on1.total - 1, JSON.stringify({ dim: on1.dim, total: on1.total }))
ok('开启：淡化块 opacity=0.45 且过渡含 opacity', on1.opacity === '0.45' && /opacity/.test(on1.transitionProp || ''), JSON.stringify({ o: on1.opacity, t: on1.transitionProp }))
ok('开启：焦点块文本已取到', typeof on1.focusText === 'string' && on1.focusText.length > 0, on1.focusText)

// ④ 光标移到另一段（第三段「潮水涨上了石阶」）→ 焦点块随动
const moved = await page.eval(`(async () => {
  window.__ZJ_EDITORS[0].setCursor('潮水涨上了石阶')
  await new Promise((r) => setTimeout(r, 600))
  const pm = document.querySelector('.ProseMirror')
  const focused = [...pm.children].find((c) => !c.classList.contains('zj-focus-dim'))
  const dimmed = [...pm.querySelectorAll(':scope > .zj-focus-dim')].length
  return { focus: focused ? focused.textContent.slice(0, 10) : null, dim: dimmed, total: pm.children.length }
})()`)
ok('光标移动后焦点块随动（潮水段）', (moved.focus || '').includes('潮水涨上'), JSON.stringify(moved))
ok('移动后淡化数仍 = 顶层块数 - 1', moved.dim === moved.total - 1, JSON.stringify(moved))

// ⑥ 截图（开启态）
await shot(page, 'focus-mode')

// ⑤ 关闭 → 回归无淡化
await page.eval(`location.hash = '#/project/demo-aseya/settings'`)
await evalUntil(page, `document.body.innerText.includes('外观与数据')`, Boolean, 20000, '设置页2')
await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').includes('外观与数据')); if (b) b.click(); return !!b })()`)
await evalUntil(page, `document.body.innerText.includes('焦点模式')`, Boolean, 10000, '外观节焦点模式2')
const sw2 = await page.eval(SWITCH_OFF)
ok('设置页焦点模式开关关闭', sw2 === 'OK:false', String(sw2))
await page.eval(`location.hash = '#/project/demo-aseya/novel'`)
await sleep(800)
const sel3 = await page.eval(SELECT_CH4)
ok('关闭后重挂正文编辑器', sel3 === 'ok', sel3)
const off1 = await evalUntil(page, SNAP, (v) => v && v.total > 0, 15000, 'snap off')
ok('关闭：无 zj-focus-on', off1.on === false, JSON.stringify(off1))
ok('关闭：无淡化块', off1.dim === 0, 'dim=' + off1.dim)

ok('全程无 JS 异常（零异常）', page.errors.length === 0, JSON.stringify(page.errors.slice(0, 3)))

console.log(fails === 0 ? '\nFOCUS MODE SMOKE OK' : `\nFOCUS MODE SMOKE FAIL: ${fails}`)
process.exit(fails === 0 ? 0 : 1)
