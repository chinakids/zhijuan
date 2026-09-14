// 织卷无头冒烟 · 窄窗正文保护（HIG Sidebars「让侧栏随窗口缩放自动隐藏/显示」）
// 用法：node scripts/narrow-body-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；本机无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 宽窗（1280）章节侧栏常驻 ② 窄窗（1000）侧栏自动折叠→入口条出现→正文 ≥360px
//         ③ 浮层选章即关 ④ Esc/点外关闭 ⑤ Agent 用 End 拖到 560 后 1300 也折叠（阈值动态）
//         ⑥ 恢复宽窗侧栏自动回归 ⑦ 全程无 JS 异常 ⑧ 截图（折叠态/浮层态）
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const OUT = process.env.HOME + '/Pictures/zhijuan'

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
async function clickXY(page, x, y) {
  await page.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await sleep(60)
  await page.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await sleep(60)
  await page.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}
async function setSize(page, w, h) {
  await page.cmd('Emulation.clearDeviceMetricsOverride')
  await page.cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
  await sleep(500)
}
async function pressKey(page, key, vk, code) {
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key, code: code ?? key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key, code: code ?? key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
}

// 布局快照：侧栏/入口条/浮层/正文宽/Agent 宽
const snapExpr = `(() => {
  const side = document.querySelector('[data-testid="chapter-sidebar"]')
  const toggle = document.querySelector('[data-testid="chapter-toggle"]')
  const drawer = document.querySelector('[data-testid="chapter-drawer"]')
  const paper = document.querySelector('.zj-md .ProseMirror') ?? document.querySelector('.ProseMirror')
  const ag = document.getElementById('zj-agent-panel')
  return {
    winW: window.innerWidth,
    sideW: side ? side.getBoundingClientRect().width : null,
    toggle: !!toggle,
    drawer: !!drawer,
    drawerW: drawer ? drawer.getBoundingClientRect().width : null,
    paperW: paper ? Math.round(paper.getBoundingClientRect().width) : null,
    agentW: ag ? Math.round(ag.getBoundingClientRect().width) : null
  }
})()`

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel?ch=' + encodeURIComponent('第01章_雾港.md'))
console.log('TAB:', tab.id, tab.url)
const page = await attach(tab.webSocketDebuggerUrl)

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

// ① 宽窗 1280：侧栏常驻、无入口条；正文 ≥ 360（1280-240-240-320=480）
await setSize(page, 1280, 800)
let s = await evalUntil(page, snapExpr, (x) => x && x.sideW !== null && x.sideW > 0, 25000, '宽窗布局就绪')
console.log('WIDE:', JSON.stringify(s))
ok('宽窗 1280：章节侧栏存在且宽 240', s.sideW === 240, String(s.sideW))
ok('宽窗 1280：无折叠入口条', s.toggle === false)
ok('宽窗 1280：无章节浮层', s.drawer === false)
ok('宽窗 1280：正文宽 ≥ 360（480）', s.paperW >= 360, String(s.paperW))

// ② 窄窗 1000：侧栏自动折叠 + 入口条出现 + 正文回弹 ≥360（1000-240-320=440）
await setSize(page, 1000, 700)
s = await evalUntil(page, snapExpr, (x) => x && x.toggle === true && x.sideW === null, 15000, '窄窗折叠')
console.log('NARROW:', JSON.stringify(s))
ok('窄窗 1000：侧栏已折叠（不存在）', s.sideW === null)
ok('窄窗 1000：入口条出现', s.toggle === true)
ok('窄窗 1000：正文回弹宽 ≥ 360（440）', s.paperW >= 360, String(s.paperW))
ok('窄窗 1000：Agent 面板保持 320', s.agentW === 320, String(s.agentW))

// 截图①：折叠态（有选中章节的正文）
let shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
if (shot?.data) {
  const fs = await import('node:fs')
  fs.mkdirSync(OUT, { recursive: true })
  const hh = String(new Date().getHours()).padStart(2, '0')
  const mm = String(new Date().getMinutes()).padStart(2, '0')
  const p1 = `${OUT}/narrow-body-${hh}${mm}.png`
  fs.writeFileSync(p1, Buffer.from(shot.data, 'base64'))
  console.log('SCREENSHOT:', p1)
}

// ③ 打开浮层：入口条（chapter-toggle）真实点击
const toggleRect = await page.eval(`(() => {
  const el = document.querySelector('[data-testid="chapter-toggle"]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})()`)
ok('入口条可定位', !!toggleRect)
await clickXY(page, toggleRect.x, toggleRect.y)
s = await evalUntil(page, snapExpr, (x) => x && x.drawer === true, 10000, '浮层打开')
console.log('DRAWER:', JSON.stringify(s))
ok('点入口条：章节浮层出现且宽 240', s.drawerW === 240, String(s.drawerW))
ok('浮层打开时侧栏仍隐（折叠态）', s.sideW === null)

// 截图②：浮层态
shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
if (shot?.data) {
  const fs = await import('node:fs')
  const hh = String(new Date().getHours()).padStart(2, '0')
  const mm = String(new Date().getMinutes()).padStart(2, '0')
  const p2 = `${OUT}/narrow-drawer-${hh}${mm}.png`
  fs.writeFileSync(p2, Buffer.from(shot.data, 'base64'))
  console.log('SCREENSHOT:', p2)
}

// ④ 浮层内点第02章 → 选章即关 + 编辑器切到第二章
const chap2Rect = await page.eval(`(() => {
  const drawer = document.querySelector('[data-testid="chapter-drawer"]')
  if (!drawer) return null
  const btns = [...drawer.querySelectorAll('button')]
  const el = btns.find((b) => b.textContent.includes('第2章') || b.textContent.includes('灯塔'))
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})()`)
ok('浮层内可定位第二章项', !!chap2Rect, JSON.stringify(chap2Rect?.text ?? ''))
await clickXY(page, chap2Rect.x, chap2Rect.y)
s = await evalUntil(page, snapExpr, (x) => x && x.drawer === false, 10000, '选章后浮层关闭')
ok('浮层内选章：浮层自动关闭', s.drawer === false)
await sleep(800)
const mark = await page.eval(`(() => window.__ZJ_EDITORS && window.__ZJ_EDITORS.length ? window.__ZJ_EDITORS[0].getMarkdown().slice(0, 60) : null)()`)
ok('编辑器内容已切到第二章（含「灯塔」）', typeof mark === 'string' && mark.includes('灯塔'), String(mark).slice(0, 40))

// ⑤ 重开浮层 → Esc 关闭
await clickXY(page, toggleRect.x, toggleRect.y)
await evalUntil(page, snapExpr, (x) => x && x.drawer === true, 10000, '浮层再开')
await pressKey(page, 'Escape', 27, 'Escape')
s = await evalUntil(page, snapExpr, (x) => x && x.drawer === false, 10000, 'Esc 关闭')
ok('Esc 关闭浮层', s.drawer === false)

// ⑥ 重开浮层 → 点浮层外正文关闭（HIG Popovers）
await clickXY(page, toggleRect.x, toggleRect.y)
await evalUntil(page, snapExpr, (x) => x && x.drawer === true, 10000, '浮层再开2')
const paperRect = await page.eval(`(() => {
  const el = document.querySelector('.ProseMirror')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left + 20, y: r.top + 20 }
})()`)
ok('正文区可定位（点外关闭验点）', !!paperRect)
await clickXY(page, paperRect.x, paperRect.y)
s = await evalUntil(page, snapExpr, (x) => x && x.drawer === false, 10000, '点外关闭')
ok('点浮层外正文：浮层关闭且正文仍可点（未误挡）', s.drawer === false)

// ⑦ Agent 拖宽（End=560）后 1300 也折叠（阈值动态抬升）→ Home(280) 恢复
await setSize(page, 1300, 800)
s = await evalUntil(page, snapExpr, (x) => x && x.sideW !== null && x.sideW > 0, 15000, '1300 宽窗侧栏在')
ok('1300 + Agent 320：侧栏常驻（正文 500px）', s.sideW === 240 && s.agentW === 320, `${s.sideW}/${s.agentW}/${s.paperW}`)
// 聚焦分隔条并按 End（最宽 560）
await page.eval(`(() => { const el = document.querySelector('[role="separator"][aria-label="Agent 面板宽度"]'); if (el) el.focus(); return !!el })()`)
await pressKey(page, 'End', 35, 'End')
s = await evalUntil(page, snapExpr, (x) => x && x.agentW === 560, 10000, 'Agent 拖到 560')
console.log('AGENT560:', JSON.stringify(s))
s = await evalUntil(page, snapExpr, (x) => x && x.toggle === true && x.sideW === null, 15000, '1300+560 折叠')
ok('1300 + Agent 560：自动折叠（正文仍受保护）', s.sideW === null && s.toggle === true)
ok('1300 + Agent 560：正文宽 ≥ 360（500）', s.paperW >= 360, String(s.paperW))
// 按 Home（最窄 280）
await pressKey(page, 'Home', 36, 'Home')
s = await evalUntil(page, snapExpr, (x) => x && x.agentW === 280, 10000, 'Agent 回 280')
s = await evalUntil(page, snapExpr, (x) => x && x.sideW !== null && x.sideW === 240, 15000, 'Home 后侧栏恢复')
ok('Agent 拖窄（Home 280）后侧栏自动恢复', s.sideW === 240 && s.toggle === false)

// ⑧ 回宽窗 1280：侧栏常驻、入口条消失（自动恢复）
await setSize(page, 1280, 800)
s = await evalUntil(page, snapExpr, (x) => x && x.sideW === 240 && x.toggle === false, 15000, '1280 恢复')
ok('回 1280：侧栏回归且入口条消失', s.sideW === 240 && s.toggle === false)

// ⑨ 深色主题下折叠态正常（tokens 跟随，无 JS 异常）
await page.eval(`document.documentElement.classList.add('dark')`)
await setSize(page, 1000, 700)
s = await evalUntil(page, snapExpr, (x) => x && x.toggle === true && x.paperW >= 360, 15000, 'dark 窄窗')
ok('dark 主题：窄窗折叠态正常', s.sideW === null && s.toggle === true, JSON.stringify(s))

console.log('ERRORS:', page.errors.length ? page.errors.slice(0, 5) : 'none')
ok('全程无 JS 异常', page.errors.length === 0, String(page.errors.slice(0, 2)))
console.log(fails === 0 ? 'ALL PASS' : `FAIL: ${fails}`)
page.close()
process.exit(fails === 0 ? 0 : 1)
