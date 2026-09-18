// 织卷无头冒烟 · 设置页 pane 记忆 / 主题即时写盘 / 按钮组 aria / 保存错误态
// （体验层 2026-09-18 23:15 轮，HIG Settings：Restore the most recently viewed pane + 即时生效）
// 覆盖：① 默认 pane=工作区与项目；② 点侧栏分区即时写盘 settingsPane；③ 离开设置页重进恢复上次 pane
//       （页内设置对象保留=模拟真机重启读盘同路径）；④ 主题按钮即时写盘 + 视觉即时应用；
//       ⑤ 主题/服务商按钮组 aria-pressed；⑥ 保存失败 → role=alert 就地错误（?zj-fail-x=setSettings）；
//       ⑦ 零 JS 异常（双通道）。
// 用法：node scripts/settings-pane-ui-smoke.mjs [base]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CDP = 'http://127.0.0.1:9224'
const BASE = process.argv[2] || 'http://127.0.0.1:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const watchdog = setTimeout(() => { console.log('!! WATCHDOG 240s'); process.exit(2) }, 240000)

async function newTab(url) {
  const r = await fetch(CDP + '/json/new?url=' + encodeURIComponent(url), { method: 'PUT' })
  if (!r.ok) throw new Error('newTab ' + r.status)
  return r.json()
}
function connect(wsUrl) {
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
  return new Promise((res, rej) => { ws.onerror = rej; ws.onopen = async () => { await cmd('Runtime.enable'); res({ ws, cmd, errors }) } })
}

let pass = 0
let fail = 0
const fatal = { e: null }
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓', name, extra) }
  else { fail++; console.log('  ✗', name, extra) }
}

async function setup(query, hash) {
  const tab = await newTab('about:blank')
  const { ws, cmd, errors } = await connect(tab.webSocketDebuggerUrl)
  await cmd('Page.enable')
  await cmd('Page.bringToFront')
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false })
  await cmd('Page.navigate', { url: `${BASE}/?cb=setpane${Date.now()}${query ? `&${query}` : ''}${hash ?? ''}` })
  return { ws, cmd, errors }
}
async function ev(cmd, expression) {
  const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)))
  return r.result?.value
}
async function evUntil(cmd, expression, pred, timeout = 30000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const v = await ev(cmd, expression)
    if (pred ? pred(v) : v) return v
    await sleep(500)
  }
  throw new Error('timeout: ' + expression)
}
async function clickText(cmd, text) {
  const p = await ev(cmd, `(() => {
    const els = [...document.querySelectorAll('button')].filter((x) => x.textContent.trim().includes(${JSON.stringify(text)}))
    const el = els[0]
    if (!el) return null
    const rr = el.getBoundingClientRect()
    return { x: rr.x + rr.width / 2, y: rr.y + rr.height / 2 }
  })()`)
  if (!p) throw new Error('clickText not found: ' + text)
  await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })
  await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y })
  await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 })
  await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 })
}
const h2 = (cmd) => ev(cmd, `document.querySelector('h2')?.textContent ?? ''`)
const paneOf = (cmd) => ev(cmd, `window.zhijuan.getSettings().then(s => s.settingsPane)`)
const shot = async (cmd, name) => {
  try {
    const { data } = await cmd('Page.captureScreenshot', { format: 'png' })
    const d = new Date()
    const hhmm = String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0')
    const f = path.join(os.homedir(), 'Pictures', 'zhijuan', `${name}-${hhmm}.png`)
    fs.writeFileSync(f, Buffer.from(data, 'base64'))
    console.log('  截图 →', f)
  } catch (e) { console.log('  截图失败', e.message) }
}

try {
  // ---------- Tab A：pane 记忆 + 主题即时 + aria ----------
  console.log('== Tab A：pane 持久化 / 主题即时写盘 / aria ==')
  const A = await setup('', '#/settings')
  const { cmd: ca, errors: ea } = A
  await evUntil(ca, `document.body.innerText.includes('保存设置')`, Boolean, 40000)
  await sleep(800)

  // ① 默认 pane
  check('默认 pane=工作区与项目', (await h2(ca)) === '工作区与项目')
  check('settingsPane 默认 workspace', (await paneOf(ca)) === 'workspace')

  // ② 点「写作引擎」→ 即时写盘
  await clickText(ca, '写作引擎')
  await evUntil(ca, `window.zhijuan.getSettings().then(s => s.settingsPane === 'engine')`, Boolean)
  await evUntil(ca, `document.querySelector('h2')?.textContent === '写作引擎'`, Boolean)
  check('切 pane 即时写盘 settingsPane=engine', (await paneOf(ca)) === 'engine')
  check('pane 标题=写作引擎', (await h2(ca)) === '写作引擎')

  // ③ 离开设置页 → 重进：恢复上次 pane
  await ev(ca, `(() => { window.location.hash = '#/'; return true })()`)
  await evUntil(ca, `document.body.innerText.includes('项目库')`, Boolean)
  await sleep(400)
  await ev(ca, `(() => { window.location.hash = '#/settings'; return true })()`)
  await evUntil(ca, `document.body.innerText.includes('保存设置')`, Boolean)
  await sleep(800)
  check('重进恢复上次 pane=写作引擎', (await h2(ca)) === '写作引擎')

  // ④ 主题即时写盘 + 视觉即时
  await clickText(ca, '外观与数据')
  await evUntil(ca, `document.body.innerText.includes('主题')`, Boolean)
  await sleep(500)
  await clickText(ca, '深色')
  await evUntil(ca, `document.documentElement.classList.contains('dark')`, Boolean)
  await evUntil(ca, `window.zhijuan.getSettings().then(s => s.theme === 'dark')`, Boolean)
  check('切深色即时写盘 theme=dark', (await ev(ca, `window.zhijuan.getSettings().then(s => s.theme)`)) === 'dark')
  check('切深色视觉即时（html.dark）', (await ev(ca, `document.documentElement.classList.contains('dark')`)) === true)
  const pressed = await ev(ca, `(() => ({
    dark: [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '深色')?.getAttribute('aria-pressed'),
    paper: [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '暖纸')?.getAttribute('aria-pressed'),
    group: document.querySelector('[aria-label="主题"]')?.getAttribute('role'),
  }))()`)
  check('主题按钮组 role=group+aria 语义', pressed.group === 'group' && pressed.dark === 'true' && pressed.paper === 'false', JSON.stringify(pressed))
  await shot(ca, 'settings-pane-dark')

  // ⑤ 服务商按钮组 aria-pressed（切回写作引擎）
  await clickText(ca, '暖纸')
  await evUntil(ca, `window.zhijuan.getSettings().then(s => s.theme === 'paper')`, Boolean)
  await clickText(ca, '写作引擎')
  await evUntil(ca, `document.body.innerText.includes('服务商')`, Boolean)
  await sleep(400)
  const provPressed = await ev(ca, `(() => {
    const g = document.querySelector('[aria-label="服务商"]')
    if (!g) return null
    const btns = [...g.querySelectorAll('button')]
    const first = btns[0]?.getAttribute('aria-pressed')
    const others = btns.slice(1).map(b => b.getAttribute('aria-pressed'))
    return { exists: !!g, role: g.getAttribute('role'), first, others }
  })()`)
  check('服务商按钮组 group+aria-pressed 恰一选中', !!provPressed && provPressed.role === 'group' && provPressed.first === 'true' && provPressed.others.every((x) => x === 'false'), JSON.stringify(provPressed))
  await shot(ca, 'settings-pane-restore')
  check('Tab A 零 JS 异常', ea.length === 0, ea.slice(0, 3).join(' | '))
  A.ws.close()

  // ---------- Tab B：保存失败错误态 ----------
  console.log('== Tab B：保存失败错误态（?zj-fail-x=setSettings） ==')
  const B = await setup('zj-fail-x=setSettings', '#/settings')
  const { cmd: cb, errors: eb } = B
  await evUntil(cb, `document.body.innerText.includes('保存设置')`, Boolean, 40000)
  await sleep(800)
  await clickText(cb, '保存设置')
  await evUntil(cb, `document.querySelector('[role="alert"]')?.textContent.includes('设置保存失败')`, Boolean)
  check('保存失败 role=alert 就地提示', (await ev(cb, `document.querySelector('[role="alert"]')?.textContent ?? ''`)).includes('设置保存失败'))
  await shot(cb, 'settings-save-fail')
  check('Tab B 零 JS 异常', eb.length === 0, eb.slice(0, 3).join(' | '))
  B.ws.close()
} catch (e) {
  fatal.e = e
  console.log('FATAL', e.message)
}
clearTimeout(watchdog)
console.log(`\nRESULT pass=${pass} fail=${fail}`)
if (fatal.e || fail > 0) process.exit(1)
process.exit(0)
