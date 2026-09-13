// 织卷无头冒烟 · 编辑器工具栏撤销/重做可用态（HIG：不可用项置灰示态、不响应交互，但不隐藏）
// 用法：node scripts/toolbar-disabled-ui-smoke.mjs
// 前置：npm run build；python3 -m http.server 8123 --directory out/renderer；本机无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 新文档：撤销/重做均 disabled（zj-tb-off+置灰计算色）；点击不产生任何效果；
//         ② setContent（事务）后：撤销可用/重做不可用（computed 色恢复 ink-2、无 zj-tb-off）；
//         ③ 真点「撤销」→ 内容回退、撤销转置灰、重做变可用；④ 真点「重做」→ 对称；
//         ⑤ 窄窗把撤销/重做收进 More 菜单后，菜单项仍带禁用态（Radix data-disabled）；
//         ⑥ 深色主题同断言 + 无 JS 异常；⑦ 截图（rest/可用）存档 ~/Pictures/zhijuan/。
const CDP = 'http://127.0.0.1:9224'
const BASE = 'http://localhost:8123'
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

// 鼠标移出工具区（避免 :hover/:focus 干扰 computed 色断言）
async function mouseAway(page) {
  await page.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 300 })
  await sleep(350) // 等 120ms 颜色过渡结束
}

// 工具栏状态快照：撤销/重做（排除测量层 data-zj-tb-measure）的 disabled/class/computed 色 + 文档 md
const TB = `(() => {
  const bar = [...document.querySelectorAll('.zj-md-toolbar')].find((b) => !b.hasAttribute('data-zj-tb-measure'))
  const pick = (title) => [...(bar?.querySelectorAll('.zj-tb-item') ?? [])].find((b) => b.getAttribute('title') === title)
  const u = pick('撤销'); const r = pick('重做'); const bold = pick('加粗')
  const st = (b) => b ? {
    disabled: b.disabled === true,
    off: b.classList.contains('zj-tb-off'),
    color: getComputedStyle(b).color,
    opacity: getComputedStyle(b).opacity,
    hover: b.matches(':hover'),
    focus: b.matches(':focus'),
    active: b.matches(':active')
  } : null
  const eds = window.__ZJ_EDITORS || []
  const md = eds.length ? (eds[0].getMarkdown() || '') : ''
  return { ready: !!bar, undo: st(u), redo: st(r), bold: st(bold), mdLen: md.length, mdHead: md.slice(0, 24) }
})()`

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel?ch=' + encodeURIComponent('第01章_雾港.md'))
console.log('TAB:', tab.id, tab.url)
const page = await attach(tab.webSocketDebuggerUrl)

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

// ① 宽窗等编辑器就绪（12 项工具栏）
const v0 = await evalUntil(page, TB, (x) => x && x.ready && x.undo && x.redo, 25000, '工具栏就绪')
console.log('INIT:', JSON.stringify(v0))
ok('初始：撤销置灰（disabled+zj-tb-off）', v0.undo.disabled === true && v0.undo.off === true)
ok('初始：重做置灰（disabled+zj-tb-off）', v0.redo.disabled === true && v0.redo.off === true)
ok('置灰色 = ink-3 且透明度 <1（区别于 enabled）', v0.undo.color !== v0.bold.color && parseFloat(v0.undo.opacity) < 1, `${v0.undo.color} vs ${v0.bold.color} op=${v0.undo.opacity}`)

// ② 禁用按钮点击无效果（真实鼠标点中心）
const uRect0 = await page.eval(`(() => {
  const bar = [...document.querySelectorAll('.zj-md-toolbar')].find((b) => !b.hasAttribute('data-zj-tb-measure'))
  const b = [...bar.querySelectorAll('.zj-tb-item')].find((x) => x.getAttribute('title') === '撤销')
  const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})()`)
await clickXY(page, uRect0.x, uRect0.y)
await sleep(400)
const v0b = await page.eval(TB)
ok('禁用点击不改变文档', v0b.mdLen === v0.mdLen, `len ${v0.mdLen} -> ${v0b.mdLen}`)

// ③ setContent（事务入 history）→ 撤销可用、重做仍置灰
const b64Doc = Buffer.from('工具栏禁用态冒烟：这是一段用于验证撤销/重做的测试正文。\n').toString('base64')
await page.eval(`(() => {
  const eds = window.__ZJ_EDITORS || []; if (!eds.length) return 'NO_ED'
  const text = new TextDecoder().decode(Uint8Array.from(atob('${b64Doc}'), (c) => c.charCodeAt(0)))
  eds[0].setContent(text); return 'OK'
})()`)
const v1 = await evalUntil(page, TB, (x) => x && x.undo && x.undo.disabled === false, 15000, 'setContent 后撤销可用')
await mouseAway(page)
const v1s = await page.eval(TB)
console.log('AFTER SET:', JSON.stringify(v1s))
ok('编辑后：撤销可用（disabled=false、无 zj-tb-off）', v1s.undo.disabled === false && v1s.undo.off === false)
ok('编辑后：重做仍置灰', v1s.redo.disabled === true)
ok('编辑后：撤销色恢复 ink-2（=加粗同色）', v1s.undo.color === v1s.bold.color, `${v1s.undo.color} vs ${v1s.bold.color}`)
ok('编辑后：透明度恢复 1', parseFloat(v1s.undo.opacity) === 1)

// ④ 真点「撤销」→ 内容回退、撤销转置灰、重做可用
const uRect1 = await page.eval(`(() => {
  const bar = [...document.querySelectorAll('.zj-md-toolbar')].find((b) => !b.hasAttribute('data-zj-tb-measure'))
  const b = [...bar.querySelectorAll('.zj-tb-item')].find((x) => x.getAttribute('title') === '撤销')
  const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})()`)
await clickXY(page, uRect1.x, uRect1.y)
const v2 = await evalUntil(page, TB, (x) => x && x.undo && x.undo.disabled === true && x.redo.disabled === false, 15000, '撤销后状态翻转')
await mouseAway(page)
const v2s = await page.eval(TB)
console.log('AFTER UNDO:', JSON.stringify(v2s))
ok('撤销后：撤销置灰、重做可用', v2s.undo.disabled === true && v2s.redo.disabled === false)
ok('撤销后：文档回退（非测试正文）', !v2s.mdHead.includes('工具栏禁用态冒烟'), v2s.mdHead)

// ⑤ 真点「重做」→ 对称翻转
const rRect = await page.eval(`(() => {
  const bar = [...document.querySelectorAll('.zj-md-toolbar')].find((b) => !b.hasAttribute('data-zj-tb-measure'))
  const b = [...bar.querySelectorAll('.zj-tb-item')].find((x) => x.getAttribute('title') === '重做')
  const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})()`)
await clickXY(page, rRect.x, rRect.y)
const v3 = await evalUntil(page, TB, (x) => x && x.undo && x.undo.disabled === false && x.redo.disabled === true, 15000, '重做后状态翻转')
await mouseAway(page)
const v3s = await page.eval(TB)
ok('重做后：撤销可用、重做置灰', v3s.undo.disabled === false && v3s.redo.disabled === true)
ok('重做后：测试正文恢复', v3s.mdHead.includes('工具栏禁用态冒烟'), v3s.mdHead)

// ⑥ 窄窗收进 More：菜单项禁用态透传（10/11 项在 More，撤销可用/重做置灰——主面板此时编辑器列仅几十像素）
await page.cmd('Emulation.setDeviceMetricsOverride', { width: 900, height: 800, deviceScaleFactor: 1, mobile: false })
await evalUntil(page, `(() => {
  const bar = [...document.querySelectorAll('.zj-md-toolbar')].find((b) => !b.hasAttribute('data-zj-tb-measure'))
  const more = [...(bar?.querySelectorAll('.zj-tb-item') ?? [])].find((b) => b.getAttribute('title') === '更多格式')
  return { ready: !!more }
})()`, (x) => x && x.ready, 15000, '窄窗 More 出现')
const moreRect = await page.eval(`(() => {
  const bar = [...document.querySelectorAll('.zj-md-toolbar')].find((b) => !b.hasAttribute('data-zj-tb-measure'))
  const b = [...bar.querySelectorAll('.zj-tb-item')].find((x) => x.getAttribute('title') === '更多格式')
  const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})()`)
await clickXY(page, moreRect.x, moreRect.y)
const menuOpen = await evalUntil(page, `document.querySelectorAll('[role="menuitem"]').length`, (n) => n > 0, 12000, 'More 菜单打开')
console.log('MENU OPEN: items =', menuOpen, 'role-menu =', await page.eval(`document.querySelectorAll('[role="menu"]').length`))
const moreItems = await page.eval(`(() => {
  const items = [...document.querySelectorAll('[role="menuitem"]')].filter((i) => i.offsetParent !== null)
  return items.map((i) => ({ text: i.textContent.trim(), disabled: i.getAttribute('data-disabled') !== null }))
})()`)
console.log('MORE ITEMS:', JSON.stringify(moreItems))
const undoItem = moreItems.find((i) => i.text.includes('撤销'))
const redoItem = moreItems.find((i) => i.text.includes('重做'))
ok('More 菜单含撤销/重做项', !!undoItem && !!redoItem)
ok('More 内：撤销项可用（无 data-disabled）', undoItem && undoItem.disabled === false)
ok('More 内：重做项禁用（data-disabled）', redoItem && redoItem.disabled === true)

// ⑦ 深色主题：置灰样式仍在（computed）+ 截图
await page.cmd('Emulation.clearDeviceMetricsOverride')
await sleep(400)
await page.eval(`document.documentElement.classList.add('dark')`)
await sleep(500)
const vdark = await page.eval(TB)
console.log('DARK:', JSON.stringify({ undo: vdark.undo, redo: vdark.redo }))
ok('深色：重做仍置灰（disabled+z-j-tb-off+与可用项色不同）', vdark.redo.disabled === true && vdark.redo.off === true && vdark.redo.color !== vdark.bold.color, `${vdark.redo.color} vs ${vdark.bold.color}`)

// 截图：可用态（撤销）与置灰态（重做）同框
const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
if (shot?.data) {
  const fs = await import('node:fs')
  const ts = new Date()
  const hh = String(ts.getHours()).padStart(2, '0')
  const mm = String(ts.getMinutes()).padStart(2, '0')
  fs.mkdirSync(OUT, { recursive: true })
  const path = `${OUT}/toolbar-disabled-${hh}${mm}.png`
  fs.writeFileSync(path, Buffer.from(shot.data, 'base64'))
  console.log('SCREENSHOT:', path)
}

console.log('ERRORS:', page.errors.length ? page.errors.slice(0, 5) : 'none')
console.log(fails === 0 ? 'ALL PASS' : `FAIL: ${fails}`)
page.close()
process.exit(fails === 0 ? 0 : 1)
