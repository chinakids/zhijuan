// 织卷无头走查 · Workspace 项目落点页 HIG 走查（体验层 2026-09-21 02:15 轮）
// 主线：SectionNav/Workspace 壳——「发起采集」双高亮+双 aria-current 修复、「回到项目首页」title 勘误、项目名 Link 去 aria-current
// 用法：node scripts/workspace-nav-ui-smoke.mjs
// 前置：npm run build；out/renderer 由 http.server 8723 服务；本机无头 Chrome CDP 127.0.0.1:9224
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8723'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const OUT = process.env.HOME + '/Pictures/zhijuan'

async function openTab() {
  const r = await fetch(CDP + '/json/new?about:blank', { method: 'PUT' })
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
  await sleep(400)
}
async function shot(page, name) {
  const s = await page.cmd('Page.captureScreenshot', { format: 'png' })
  if (s?.data) {
    const fs = await import('node:fs')
    fs.mkdirSync(OUT, { recursive: true })
    const hh = String(new Date().getHours()).padStart(2, '0')
    const mm = String(new Date().getMinutes()).padStart(2, '0')
    const p = `${OUT}/${name}-${hh}${mm}.png`
    fs.writeFileSync(p, Buffer.from(s.data, 'base64'))
    console.log('SCREENSHOT:', p)
  }
}

let fail = 0
function ok(name, cond, detail = '') {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''))
  if (!cond) fail++
}

// SectionNav 快照：条目文本/激活态/aria-current/标题/底部入口 + 溢出探测
const navSnapExpr = `(() => {
  const sec = [...document.querySelectorAll('aside')].find((x) => x.querySelector('nav')) || null
  if (!sec) return null
  const nav = sec.querySelector('nav')
  const items = [...nav.querySelectorAll('a')].map((a) => ({
    text: a.innerText.replace(/\\n/g, '|'),
    active: a.className.includes('bg-accent-soft'),
    ariaCurrent: a.getAttribute('aria-current'),
    title: a.title || ''
  }))
  const bottom = [...sec.querySelectorAll(':scope > div:last-child a, :scope > div:last-child button')].map((x) => ({
    tag: x.tagName, text: x.innerText.replace(/\\n/g, '|'),
    active: x.className && x.className.includes ? x.className.includes('bg-accent-soft') : false,
    ariaCurrent: x.tagName === 'A' ? x.getAttribute('aria-current') : null,
    title: x.title || ''
  }))
  const projName = sec.querySelector('div:first-child a')
  return {
    items,
    activeItems: items.filter((i) => i.active).map((i) => i.text),
    ariaCurrents: items.filter((i) => i.ariaCurrent === 'page').map((i) => i.text),
    bottom,
    projTitle: projName ? projName.getAttribute('title') : null,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    asideW: Math.round(sec.getBoundingClientRect().width)
  }
})()`

const URL_NOVEL = () => BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel'
const URL_LIB = () => BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/library?collect=1'

// —— 场景 A：正文页（宽窗）——
let tab = await openTab()
let page = await attach(tab.webSocketDebuggerUrl)
await setSize(page, 1280, 800)
await page.cmd('Page.enable')
await page.cmd('Page.navigate', { url: URL_NOVEL() })
await evalUntil(page, `document.body.innerText.includes('余烬的灯')`, (v) => v === true, 25000, 'workspace ready')
await sleep(600)
let snap = await page.eval(navSnapExpr)
ok('A1 六板块条目齐备且计数正确', JSON.stringify(snap?.items.map((i) => i.text)) === JSON.stringify(['正文创作|5', '人物设定|3', '世界观设定|2', '大纲区|2', '时间线', '素材库|6']), JSON.stringify(snap?.items.map((i) => i.text)))
ok('A2 唯一激活=正文创作（发起采集/Action 不参与）', JSON.stringify(snap?.activeItems) === JSON.stringify(['正文创作|5']), JSON.stringify(snap?.activeItems))
ok('A3 唯一 aria-current=page=正文创作（项目名 Link 不再误标）', JSON.stringify(snap?.ariaCurrents) === JSON.stringify(['正文创作|5']), JSON.stringify(snap?.ariaCurrents))
ok('A4 项目名 title 勘误=回到正文创作', snap?.projTitle === '回到正文创作', String(snap?.projTitle))
ok('A5 底部三入口齐备', JSON.stringify(snap?.bottom.map((b) => b.text)) === JSON.stringify(['发起采集', '设置', '返回项目列表']), JSON.stringify(snap?.bottom.map((b) => b.text)))
await shot(page, 'workspace-nav-novel')

// —— 场景 B：素材库?collect=1（曾经的「发起采集」双高亮场景）——
await page.eval(`location.hash = '#/project/demo-aseya/library?collect=1'`)
await evalUntil(page, `document.body.innerText.includes('素材库') && document.body.innerText.includes('发起采集')`, (v) => v === true, 20000, 'library ready')
await sleep(800)
snap = await page.eval(navSnapExpr)
ok('B1 collect=1: 唯一激活=素材库（双高亮已修复）', JSON.stringify(snap?.activeItems) === JSON.stringify(['素材库|6']), JSON.stringify(snap?.activeItems))
ok('B2 collect=1: 唯一 aria-current=素材库', JSON.stringify(snap?.ariaCurrents) === JSON.stringify(['素材库|6']), JSON.stringify(snap?.ariaCurrents))
ok('B3 collect=1: 发起采集无 aria-current 且非激活', snap?.bottom.find((b) => b.text === '发起采集')?.ariaCurrent ? false : snap?.bottom.find((b) => b.text === '发起采集')?.active === false, JSON.stringify(snap?.bottom.find((b) => b.text === '发起采集')))
await shot(page, 'workspace-nav-library')

// —— 场景 C：普通素材库页（同样不得双高亮）——
await page.eval(`location.hash = '#/project/demo-aseya/library'`)
await sleep(900)
snap = await page.eval(navSnapExpr)
ok('C 普通 library: 唯一激活=素材库', JSON.stringify(snap?.activeItems) === JSON.stringify(['素材库|6']), JSON.stringify(snap?.activeItems))

// —— 场景 D：窄窗 1000×700（先 resize 后交互；折叠机制既有，只验无溢出）——
let tab2 = await openTab()
let page2 = await attach(tab2.webSocketDebuggerUrl)
await setSize(page2, 1000, 700)
await page2.cmd('Page.enable')
await page2.cmd('Page.navigate', { url: URL_NOVEL() })
await evalUntil(page2, `document.body.innerText.includes('余烬的灯')`, (v) => v === true, 25000, 'workspace ready (narrow)')
await sleep(500)
const narrow = await page2.eval(navSnapExpr)
ok('D1 窄窗 1000: 侧栏 240 固定无横向溢出', narrow?.overflowX === false && narrow?.asideW === 240, JSON.stringify({ overflowX: narrow?.overflowX, asideW: narrow?.asideW }))

// —— 场景 E：dark 主题语义色（SectionNav bg-surface 非白）——
await page2.eval(`document.documentElement.classList.add('dark')`)
await sleep(500)
const dark = await page2.eval(`(() => {
  const sec = [...document.querySelectorAll('aside')].find((x) => x.querySelector('nav'))
  return { on: document.documentElement.classList.contains('dark'), bg: sec ? getComputedStyle(sec).backgroundColor : null }
})()`)
ok('E dark: 主题类生效且侧栏背景用 dark 语义色（非纯白）', dark.on === true && dark.bg !== 'rgb(255, 255, 255)', JSON.stringify(dark))
await page2.eval(`document.documentElement.classList.remove('dark')`)

// —— 零 JS 异常 ——
if (page.errors.length) { ok('A-F 零 JS 异常', false, page.errors.join(' | ')) }
else { ok('A-F 零 JS 异常', true, '') }
if (page2.errors.length) { ok('D/E 零 JS 异常', false, page2.errors.join(' | ')) }
else { ok('D/E 零 JS 异常', true, '') }

page.close(); page2.close()
console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
