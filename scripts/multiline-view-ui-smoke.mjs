// 织卷无头冒烟 · 多时间线视图（周交付增量#5 体验层）：时间线页按线分组+筛选、章节列表线徽标、单线项目零打扰
// 用法：node scripts/multiline-view-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；无头 Chrome CDP 127.0.0.1:9224
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
      pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
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
async function evalUntil(page, expr, pred, timeoutMs = 20000, label = expr) {
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

// ---------- ① demo-multiline 时间线页：分组+筛选 ----------
const tab1 = await openTab(BASE + '/#/project/demo-multiline/timeline?cb=' + cb)
const p1 = await attach(tab1.webSocketDebuggerUrl)
await evalUntil(p1, "document.body.innerText.includes('按线分组')", (v) => v === true, 20000, '多线时间线加载')

const tabInfo = await p1.eval(`(() => {
  const tabs = [...document.querySelectorAll('[role=tab]')].map((t) => t.textContent.trim())
  const secs = [...document.querySelectorAll('section')].map((s) => ({
    label: s.getAttribute('aria-label'),
    text: s.innerText.replace(/\\s+/g, ' ').slice(0, 200)
  }))
  return { tabs, secs }
})()`)
ok('线筛选 chips：全部 + 主线 + 过去线（含章数）', JSON.stringify(tabInfo.tabs) === JSON.stringify(['全部', '主线 · 3', '过去线 · 2']), JSON.stringify(tabInfo.tabs))
ok('分组：主线/过去线两个 section', tabInfo.secs.length === 2 && tabInfo.secs[0].label === '时间线：主线' && tabInfo.secs[1].label === '时间线：过去线', JSON.stringify(tabInfo.secs.map((s) => s.label)))
const mainTxt = tabInfo.secs[0].text
const pastTxt = tabInfo.secs[1].text
const idxOf = (t, s) => t.indexOf(s)
ok('主线组线内序：第1章→第3章→第5章', idxOf(mainTxt, '第1章') >= 0 && idxOf(mainTxt, '第1章') < idxOf(mainTxt, '第3章') && idxOf(mainTxt, '第3章') < idxOf(mainTxt, '第5章'), mainTxt.slice(0, 80))
ok('过去线组线内序：第2章→第4章', idxOf(pastTxt, '第2章') >= 0 && idxOf(pastTxt, '第2章') < idxOf(pastTxt, '第4章'), pastTxt.slice(0, 80))
ok('组头不串线：主线组无第2章、过去线组无第1章', mainTxt.indexOf('第2章') < 0 && pastTxt.indexOf('第1章') < 0)

// 点「过去线」chip → 只显示过去线
await p1.eval(`(() => { const el = [...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.includes('过去线')); if (el) el.click(); return !!el })()`)
let s = await evalUntil(p1, `(() => { const secs = [...document.querySelectorAll('section')]; return secs.map((x) => x.getAttribute('aria-label')) })()`, (v) => Array.isArray(v) && v.length === 1 && v[0] === '时间线：过去线', 10000, '过去线筛选')
ok('筛选「过去线」：只剩过去线组', s.length === 1 && s[0] === '时间线：过去线', JSON.stringify(s))

// 点「主线」chip
await p1.eval(`(() => { const el = [...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.includes('主线')); if (el) el.click(); return !!el })()`)
s = await evalUntil(p1, `(() => { const secs = [...document.querySelectorAll('section')]; return secs.map((x) => x.getAttribute('aria-label')) })()`, (v) => Array.isArray(v) && v.length === 1 && v[0] === '时间线：主线', 10000, '主线筛选')
ok('筛选「主线」：只剩主线组', s.length === 1 && s[0] === '时间线：主线', JSON.stringify(s))

// 回「全部」
await p1.eval(`(() => { const el = [...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.trim() === '全部'); if (el) el.click(); return !!el })()`)
s = await evalUntil(p1, `document.querySelectorAll('section').length`, (v) => v === 2, 10000, '全部视图恢复')
ok('回「全部」：两分组恢复', s === 2, String(s))
await sleep(400)
await shot(p1, 'timeline-multiline')

// ---------- ② demo-multiline 章节列表线徽标 ----------
const tab2 = await openTab(BASE + '/#/project/demo-multiline/novel?cb=' + (cb + 1))
const p2 = await attach(tab2.webSocketDebuggerUrl)
await evalUntil(p2, "document.body.innerText.includes('夜航')", (v) => v === true, 20000, '章节列表加载')
const badges = await p2.eval(`(() => {
  const btns = [...document.querySelectorAll('button')].filter((b) => b.textContent.includes('第1章') || b.textContent.includes('第2章'))
  return btns.map((b) => {
    const spans = [...b.querySelectorAll('span')].map((x) => x.textContent.trim()).filter((x) => x === '主线' || x === '过去线')
    return { head: b.textContent.replace(/\\s+/g, ' ').slice(0, 30), mark: spans }
  })
})()`)
ok('章项线徽标：第1章=主线、第2章=过去线', badges.length >= 2 && badges[0].mark.includes('主线') && badges[1] && badges[1].mark.includes('过去线'), JSON.stringify(badges))
await sleep(300)
await shot(p2, 'novel-line-badges')

// ---------- ③ 单线项目零打扰（demo-aseya） ----------
const tab3 = await openTab(BASE + '/#/project/demo-aseya/timeline?cb=' + (cb + 2))
const p3 = await attach(tab3.webSocketDebuggerUrl)
await evalUntil(p3, "document.body.innerText.includes('项目时间线')", (v) => v === true, 20000, '单线时间线加载')
const single = await p3.eval(`(() => ({
  tabs: document.querySelectorAll('[role=tab]').length,
  desc: document.body.innerText.includes('按章号排序'),
  lineHead: document.querySelectorAll('[data-testid=timeline-line-head]').length
}))()`)
ok('单线项目：无线筛选 chips', single.tabs === 0, String(single.tabs))
ok('单线项目：保持原一维描述、无分组头', single.desc === true && single.lineHead === 0, JSON.stringify(single))

const tab4 = await openTab(BASE + '/#/project/demo-aseya/novel?cb=' + (cb + 3))
const p4 = await attach(tab4.webSocketDebuggerUrl)
await evalUntil(p4, "document.body.innerText.includes('第1章')", (v) => v === true, 20000, '单线章节列表加载')
const noBadge = await p4.eval(`(() => {
  const btns = [...document.querySelectorAll('button')].filter((b) => b.textContent.includes('第1章') || b.textContent.includes('第2章'))
  let marks = 0
  for (const b of btns) for (const sp of b.querySelectorAll('span')) if (sp.textContent.trim() === '主线' || sp.textContent.trim() === '过去线') marks++
  return marks
})()`)
ok('单线项目：章项无线徽标', noBadge === 0, String(noBadge))

ok('全程无 JS 异常', p1.errors.length === 0 && p2.errors.length === 0 && p3.errors.length === 0 && p4.errors.length === 0,
  String([...p1.errors, ...p2.errors, ...p3.errors, ...p4.errors].slice(0, 2)))
console.log(fails === 0 ? 'ALL PASS' : 'FAIL: ' + fails)
p1.close(); p2.close(); p3.close(); p4.close()
process.exit(fails === 0 ? 0 : 1)
