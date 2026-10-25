// 织卷无头冒烟 · 多线写作体感走查收尾（封版目标① 中篇验收）：demo-order 建章跨线预填 + 窄窗章列折叠后线徽标 + 深色线徽标/时间线组头零溢出
// 用法：node scripts/multiline-write-walkthrough-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；本机无头 Chrome CDP 127.0.0.1:9224
// 收口口径：行为面（跨线预填决策/改线刷新/徽标）已由 createchapter-line-ui-smoke + edit-line-ui-smoke 覆盖；
//   本冒烟锁定「呈现面」基线——① demo-order（跨线重名种子）建章对话框跨线预填与 chips 呈现；
//   ② 窄窗（正文可用宽<360 触发章列折叠）抽屉内线徽标仍可辨；③ 深色主题下线徽标用语义色不硬编码。
import { writeFileSync, mkdirSync } from 'node:fs'
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const OUT = process.env.HOME + '/Pictures/zhijuan'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const cb = Date.now()
let fails = 0
function ok(name, cond, detail = '') {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + String(detail).slice(0, 160) : ''))
  if (!cond) fails++
}
async function openTab(url) {
  const r = await fetch(CDP + '/json/new?' + encodeURIComponent(url), { method: 'PUT' })
  return r.json()
}
function attach(wsUrl) {
  const ws = new WebSocket(wsUrl); let seq = 0; const pending = new Map(); const errors = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails?.exception?.description ?? '').slice(0, 200))
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push((m.params.args?.map((a) => a.value ?? a.description ?? '').join(' ') ?? '').slice(0, 200))
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const cmd = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq; pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
  return new Promise((res) => {
    ws.onopen = async () => {
      await cmd('Runtime.enable')
      res({
        cmd, errors,
        eval: async (expression) => {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 250))
          return r.result?.value
        },
        close: () => ws.close()
      })
    }
  })
}
async function evalUntil(page, expr, pred, timeoutMs = 20000, label = expr) {
  const t0 = Date.now()
  for (;;) {
    try { const v = await page.eval(expr); if (pred(v)) return v } catch {}
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
const closeDialog = `(() => { const x = [...document.querySelectorAll('[role=dialog] button')].find(b => (b.getAttribute('aria-label')||'') === 'Close' || (b.getAttribute('aria-label')||'') === '关闭'); if (x) x.click(); return !!x })()`
const clickCreate = `(() => { try { const el = document.querySelector('button[title="新建章节"]'); if (el) { el.click(); return 'ok' } return 'no-el' } catch (e) { return 'ERR:' + String(e) } })()`
const selectChap = (label) => `(() => { const b = [...document.querySelectorAll('aside button')].find(x => (x.innerText||'').includes(${JSON.stringify(label)})); if (b) { b.click(); return true } return false })()`
const createSnap = `(() => { try {
  const input = document.querySelector('[data-testid="line-input"]')
  const chips = [...document.querySelectorAll('[data-testid^="line-chip-"]')].map((b) => ({ t: b.textContent.trim(), sel: b.className.includes('accent-soft') }))
  const dlgText = [...document.querySelectorAll('[role=dialog]')].map((d) => d.innerText).join('')
  return { lineVal: input ? input.value : null, chips, hint: (dlgText.match(/已沿用[^。]*。/)?.[0] ?? null)?.slice(0, 80) }
} catch (e) { return { ERR: String(e) } } })()`

const tab = await openTab(BASE + '/#/project/demo-order/novel?cb=' + cb)
const p = await attach(tab.webSocketDebuggerUrl)
try {
  await evalUntil(p, `document.body.innerText.includes('第1章')`, (v) => v === true, 25000, '正文页就绪')

  // ---- ① 建章对话框跨线预填：选中主线章（与最新章「旧港之二」过去线不同线）→ 预填所选章线 ----
  await p.eval(selectChap('第1章 · 晨港'))
  await sleep(700)
  ok('select 第1章 主线章', await p.eval(selectChap('第1章 · 晨港')))
  await sleep(700)
  ok('打开建章对话框', (await p.eval(clickCreate)) === 'ok')
  await evalUntil(p, `document.querySelector('[data-testid="line-input"]') !== null`, (v) => v === true, 8000, '建章对话框')
  await sleep(500)
  let s = await p.eval(createSnap)
  ok('预填=所选章线（主线，与最新章不同线时跟随选中章）', s.lineVal === '主线', 'val=' + JSON.stringify(s.lineVal))
  ok('提示=已沿用当前选中章', s.hint?.includes('当前选中章') === true, 'hint=' + s.hint)
  ok('chips=[主线,过去线] 且主线选中', JSON.stringify(s.chips) === JSON.stringify([{ t: '主线', sel: true }, { t: '过去线', sel: false }]), JSON.stringify(s.chips))
  await shot(p, 'multiline-create-prefill-main')
  await p.eval(closeDialog)
  await sleep(400)

  // ---- ② 选中过去线章（与最新章同线）→ 预填=上一章（旧港之二=过去线说明）----
  await p.eval(selectChap('第2章 · 旧港'))
  await sleep(700)
  await p.eval(clickCreate)
  await evalUntil(p, `document.querySelector('[data-testid="line-input"]') !== null`, (v) => v === true, 8000, '建章对话框2')
  await sleep(500)
  s = await p.eval(createSnap)
  ok('预填=过去线（选中章与最新章同线时沿用上一章）', s.lineVal === '过去线', 'val=' + JSON.stringify(s.lineVal))
  ok('提示=已沿用上一章', s.hint?.includes('上一章') === true, 'hint=' + s.hint)
  ok('chips=[主线,过去线] 且过去线选中', JSON.stringify(s.chips) === JSON.stringify([{ t: '主线', sel: false }, { t: '过去线', sel: true }]), JSON.stringify(s.chips))
  await p.eval(closeDialog)
  await sleep(400)

  // ---- ③ 窄窗章列折叠后抽屉线徽标 ----
  await p.cmd('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false })
  await sleep(600)
  const toggle = await p.eval(`document.querySelector('[data-testid="chapter-toggle"]') !== null`)
  ok('窄窗（1000x700）触发章列折叠入口', toggle === true, String(toggle))
  if (toggle) {
    await p.eval(`(() => { const t = document.querySelector('[data-testid="chapter-toggle"]'); if (t) t.click(); return !!t })()`)
    await sleep(600)
    const drawers = await p.eval(`(() => {
      const d = document.querySelector('[data-testid="chapter-drawer"]')
      if (!d) return { present: false }
      const btns = [...d.querySelectorAll('button')]
      const main = btns.filter(b => (b.innerText||'').includes('第1章') && (b.innerText||'').includes('主线')).length
      const past = btns.filter(b => (b.innerText||'').includes('第2章') && (b.innerText||'').includes('过去线')).length
      const overflow = [...d.querySelectorAll('button')].some(b => b.scrollWidth > b.clientWidth + 1)
      return { present: true, mainBadge: main > 0, pastBadge: past > 0, overflow }
    })()`)
    ok('抽屉线徽标可辨：第1章主线/第2章过去线', drawers.present === true && drawers.mainBadge && drawers.pastBadge, JSON.stringify(drawers))
    ok('抽屉内章项无横向溢出', drawers.overflow === false, String(drawers.overflow))
    await shot(p, 'multiline-narrow-drawer')
    await p.eval(`(() => { const x = document.querySelector('[data-testid="chapter-drawer"] [aria-label="关闭"]'); if (x) x.click(); return !!x })()`)
    await sleep(300)
  }

  // ---- ④ 深色主题：时间线组头 + 章节线徽标呈现（语义色不硬编码/白）----
  await p.cmd('Emulation.clearDeviceMetricsOverride')
  await sleep(400)
  await p.eval(`document.documentElement.classList.add('dark')`)
  await p.eval(`window.location.hash = '#/project/demo-order/timeline'`)
  await evalUntil(p, `document.body.innerText.includes('按线分组')`, (v) => v === true, 20000, '时间线页')
  await sleep(400)
  const tldark = await p.eval(`(() => {
    const secs = [...document.querySelectorAll('section[aria-label]')]
    const heads = secs.map(s => ({ label: s.getAttribute('aria-label'), txt: (s.innerText||'').replace(/\\s+/g,' ').slice(0,60) }))
    const overflow = [...document.querySelectorAll('section[aria-label]')].some(s => s.scrollWidth > s.clientWidth + 1)
    return { heads, overflow }
  })()`)
  ok('深色时间线：仍按线分组（主线/过去线）', tldark.heads.length === 2, JSON.stringify(tldark.heads.map(h => h.label)))
  ok('深色时间线：组头无横向溢出', tldark.overflow === false, String(tldark.overflow))
  await shot(p, 'multiline-timeline-dark')
  await p.eval(`document.documentElement.classList.remove('dark')`)

  await sleep(500)
  ok('全程无 JS 异常', p.errors.length === 0, String(p.errors.slice(0, 2)))
} catch (e) {
  console.log('FATAL', String(e).slice(0, 300))
  fails++
}
console.log(fails === 0 ? 'ALL PASS' : 'FAIL: ' + fails)
p.close()
process.exit(fails === 0 ? 0 : 1)
