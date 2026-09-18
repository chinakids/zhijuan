// 织卷无头冒烟 · 宽窗章节列手动折叠（HIG Sidebars「let people hide and show the sidebar」）
// 用法：node scripts/novel-sidebar-manual-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；本机无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 宽窗（1400）章列常驻+折叠按钮存在 ② 点折叠→章列隐藏、入口条出现
//         ③ 点入口条→章列恢复、入口条消失 ④ 折叠态下空态引导文案与按钮可恢复
//         ⑤ 窄窗（1000）自动折叠时折叠按钮不出现（宽窗专用，不干扰窄窗）⑥ 全程无 JS 异常 ⑦ 截图
const CDP = 'http://127.0.0.1:9224'
import fs from 'node:fs'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const OUT = process.env.HOME + '/Pictures/zhijuan'
const watchdog = setTimeout(() => { console.log('!! WATCHDOG 150s'); process.exit(2) }, 150000)

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
    } catch { /* 重试 */ }
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(300)
  }
}
async function setSize(page, w, h) {
  await page.cmd('Emulation.clearDeviceMetricsOverride')
  await page.cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
  await sleep(500)
}
async function shot(page, name) {
  try {
    const { data } = await page.cmd('Page.captureScreenshot', { format: 'png' })
    fs.mkdirSync(OUT, { recursive: true })
    const p = `${OUT}/${name}.png`
    fs.writeFileSync(p, Buffer.from(data, 'base64'))
    console.log('截图 →', p)
  } catch (e) { console.log('截图失败', e.message || e) }
}

let pass = 0
let fail = 0
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓', name, extra) }
  else { fail++; console.log('  ✗', name, extra) }
}

const snap = `(() => {
  const side = document.querySelector('[data-testid="chapter-sidebar"]')
  const toggle = document.querySelector('[data-testid="chapter-toggle"]')
  const hideBtn = document.querySelector('[aria-label="隐藏章节列表"]')
  const paper = document.querySelector('.zj-md .ProseMirror') ?? document.querySelector('.ProseMirror')
  return {
    winW: window.innerWidth,
    side: !!side,
    toggle: !!toggle,
    hideBtn: !!hideBtn,
    paperW: paper ? Math.round(paper.getBoundingClientRect().width) : null,
    hint: (document.querySelector('[data-testid="narrow-pick-chapter"]')) ? true : false
  }
})()`

const tab = await openTab('about:blank')
const page = await attach(tab.webSocketDebuggerUrl)
await page.cmd('Page.enable')
await page.cmd('Page.bringToFront')
await setSize(page, 1400, 800)
await page.cmd('Page.navigate', { url: `${BASE}/?cb=nvsm${Date.now()}#/project/demo-aseya/novel` })
await evalUntil(page, `!!window.__ZJ_TEST`, (v) => v, 30000, '__ZJ_TEST')
await evalUntil(page, `!!document.querySelector('[data-testid="chapter-sidebar"]')`, (v) => v, 30000, '宽窗章列')

// ① 宽窗常驻 + 折叠按钮存在
let s = await page.eval(snap)
check('宽窗 1400：章列常驻', s.side === true, `winW=${s.winW}`)
check('宽窗 1400：折叠按钮存在', s.hideBtn === true)
check('宽窗 1400：无入口条', s.toggle === false)
// 截图：宽窗常态（章列头含折叠按钮）
await shot(page, 'novel-sidebar-manual-open-1450')

// ② 点折叠按钮 → 章列隐藏、入口条出现
await page.eval(`document.querySelector('[aria-label="隐藏章节列表"]').click()`)
await sleep(400)
s = await page.eval(snap)
check('点折叠：章列隐藏', s.side === false)
check('点折叠：入口条出现', s.toggle === true)
check('折叠态正文可用宽（≥360）', s.paperW === null || s.paperW >= 360, `paperW=${s.paperW}`)

// ③ 折叠态空态引导（未选章时）
check('折叠态空态引导可见', s.hint === true)
const hintText = await page.eval(`(document.querySelector('[data-testid="narrow-pick-chapter"]')||{}).textContent || ''`)
check('折叠态空态提示恢复侧栏', hintText.includes('显示章节列表'), hintText.slice(0, 40))

// 截图：宽窗折叠态
await shot(page, 'novel-sidebar-manual-collapsed-1450')

// ④ 点空态 action 恢复章列 → 章列回来、入口条消失
await page.eval(`document.querySelector('[data-testid="pick-chapter"]').click()`)
await sleep(400)
s = await page.eval(snap)
check('点空态按钮：章列恢复', s.side === true)
check('点空态按钮：入口条消失', s.toggle === false)

// ⑤ 折叠→入口条→恢复 闭环（入口条路径）
await page.eval(`document.querySelector('[aria-label="隐藏章节列表"]').click()`)
await sleep(400)
await page.eval(`document.querySelector('[data-testid="chapter-toggle"]').click()`)
await sleep(400)
s = await page.eval(snap)
check('入口条路径：章列恢复', s.side === true)
check('入口条路径：入口条消失', s.toggle === false)

// ⑥ 折叠态下（未破坏编辑器）；直接从 DOM 找章节按钮（章列隐藏，需先恢复再选章）
await page.eval(`document.querySelector('[aria-label="隐藏章节列表"]').click()`)
await sleep(400)
s = await page.eval(snap)
check('折叠态再次成立', s.side === false && s.toggle === true)
// 恢复后选章
await page.eval(`document.querySelector('[data-testid="chapter-toggle"]').click()`)
await sleep(400)
await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('第1章')); if (b) b.click(); return !!b })()`)
await evalUntil(page, `!!(window.__ZJ_EDITORS && Object.keys(window.__ZJ_EDITORS).length)`, (v) => v, 30000, '编辑器挂载')
s = await page.eval(snap)
check('选章后编辑器挂载+章列在', s.side === true, `paperW=${s.paperW}`)

// ⑦ 窄窗回归：折叠按钮不出现（宽窗专用）
await setSize(page, 1000, 700)
await sleep(600)
s = await page.eval(snap)
check('窄窗 1000：章列自动隐藏', s.side === false)
check('窄窗 1000：无折叠按钮', s.hideBtn === false)
check('窄窗 1000：入口条在', s.toggle === true)

// 零 JS 异常
const errs = page.errors.filter((e) => !e.includes('target closed'))
check('零 JS 异常', errs.length === 0, errs.slice(0, 2).join(' | '))

console.log(`\nnovel-sidebar-manual-ui-smoke: ${pass} pass / ${fail} fail`)
clearTimeout(watchdog)
if (fail) process.exit(1)
process.exit(0)
