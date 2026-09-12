// 织卷无头冒烟 · Agent 面板宽度记忆（模块设计 §十二）
// 用法：node scripts/agent-panel-width-ui-smoke.mjs
// 前置：out/renderer 已 build；python3 ~/Desktop/织卷/scripts/spa_server.py 8123 --directory out/renderer（SPA fallback）；
//      本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 默认 320 且分隔条 aria 齐全；② CDP 真实鼠标拖拽左移 120 → 440 且设置已写；
//         ③ 拖右 300 → 钳到最小 280；④ 键盘 ←/→ 微调、Home/End 最窄/最宽、越界钳制；
//         ⑤ 双击恢复默认 320；⑥ 全程零 JS 异常。
const CDP = 'http://127.0.0.1:9224'
const BASE = 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const ok = (label) => console.log('OK', label)
const bad = (label, why) => {
  failures++
  console.log('FAIL', label, '::', why)
}

async function openTab(url) {
  const r = await fetch(CDP + '/json/new?' + encodeURIComponent(url), { method: 'PUT' })
  return r.json()
}

function attach(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let seq = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const cmd = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq
      pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
      ws.send(JSON.stringify({ id, method, params }))
    })
  return new Promise((res) => {
    ws.onopen = () =>
      res({
        cmd,
        eval: async (expression) => {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
          return r.result?.value
        },
        close: () => ws.close()
      })
  })
}

async function evalUntil(page, expr, pred, timeoutMs = 15000, label = expr) {
  const t0 = Date.now()
  for (;;) {
    try {
      const v = await page.eval(expr)
      if (pred(v)) return v
    } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(250)
  }
}

// 真实鼠标拖拽（CDP Input → Chromium 合成 pointer 事件，触发 React onPointerDown/move/up）
async function drag(page, fromX, fromY, toX, toY, steps = 8) {
  await page.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fromX, y: fromY })
  await page.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: fromX, y: fromY, button: 'left', buttons: 1, clickCount: 1 })
  await sleep(60)
  for (let i = 1; i <= steps; i++) {
    const x = fromX + ((toX - fromX) * i) / steps
    const y = fromY + ((toY - fromY) * i) / steps
    await page.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 })
    await sleep(30)
  }
  await page.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: toX, y: toY, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(200)
}

async function handleRect(page) {
  return page.eval(`(() => {
    const el = document.querySelector('[role="separator"]')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: Math.max(60, r.top + Math.min(80, r.height / 2)) }
  })()`)
}

async function width(page) {
  return page.eval(`document.querySelector('#zj-agent-panel')?.getBoundingClientRect().width ?? -1`)
}

async function settingsWd(page) {
  return page.eval(`window.zhijuan.getSettings().then(s => s.agentPanelWidth)`)
}

const near = (a, b, tol = 2) => Math.abs(a - b) <= tol

// ===================== 主流程 =====================
const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)

try {
  // 错误监听（交互期异常收集）
  await page.eval(`(() => {
    window.__zjErr = []
    window.addEventListener('error', (e) => window.__zjErr.push(String(e.message || e)))
    window.addEventListener('unhandledrejection', (e) => window.__zjErr.push('REJ:' + String(e.reason)))
  })()`)

  await evalUntil(page, `!!document.querySelector('#zj-agent-panel') && document.body.innerText.includes('Agent')`, (v) => v === true, 20000, '正文页就绪')
  ok('正文页就绪')

  // ① 默认 320 + aria 齐全
  let w = await width(page)
  if (!near(w, 320)) bad('① 默认宽度 320', 'got ' + w)
  else ok('① 默认宽度 320')
  const aria = await page.eval(`(() => {
    const el = document.querySelector('[role="separator"]')
    if (!el) return null
    return { role: el.getAttribute('role'), name: el.getAttribute('aria-label'), ctl: el.getAttribute('aria-controls'), now: el.getAttribute('aria-valuenow'), min: el.getAttribute('aria-valuemin'), max: el.getAttribute('aria-valuemax'), tab: el.tabIndex }
  })()`)
  if (!aria || aria.role !== 'separator' || !aria.ctl || aria.tab !== 0) bad('① 分隔条 aria 基础', JSON.stringify(aria))
  else if (aria.name !== 'Agent 面板宽度' || aria.min !== '280' || aria.max !== '560') bad('① 分隔条 aria 值', JSON.stringify(aria))
  else ok('① 分隔条 role/aria-label/aria-controls/tabindex/valmin/valmax 齐全')

  // ② CDP 真实拖拽：左移 120 → 440，且设置已持久化
  const r1 = await handleRect(page)
  await drag(page, r1.x, r1.y, r1.x - 120, r1.y)
  await sleep(150)
  w = await width(page)
  const s1 = await settingsWd(page)
  if (!near(w, 440)) bad('② 拖拽后宽度 440', 'got ' + w)
  else ok('② 拖拽左移 120 → 宽度 440')
  if (!near(s1, 440)) bad('② 设置已写 agentPanelWidth=440', 'got ' + s1)
  else ok('② setSettings 已写 agentPanelWidth=440')

  // ③ 拖拽右移 300 → 440-300=140 → 钳到最小 280
  const r2 = await handleRect(page)
  await drag(page, r2.x, r2.y, r2.x + 300, r2.y)
  await sleep(150)
  w = await width(page)
  if (!near(w, 280)) bad('③ 右拖钳最小 280', 'got ' + w)
  else ok('③ 右拖 300 钳到最小 280')

  // ④ 键盘：ArrowRight×20 → 280+320=600 → 钳最大 560；ArrowLeft → 544
  await page.eval(`document.querySelector('[role="separator"]').focus()`)
  const key = async (k, code, vk) => {
    await page.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
    await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
    await sleep(80)
  }
  for (let i = 0; i <20; i++) await key('ArrowRight', 'ArrowRight', 39)
  w = await width(page)
  if (!near(w, 560)) bad('④ ArrowRight×20 钳最大 560', 'got ' + w)
  else ok('④ ArrowRight×20 → 钳最大 560')
  await key('ArrowLeft', 'ArrowLeft', 37)
  w = await width(page)
  if (!near(w, 544)) bad('④ ArrowLeft 一步 -16 → 544', 'got ' + w)
  else ok('④ ArrowLeft 一步 → 544')
  await key('Home', 'Home', 36)
  w = await width(page)
  if (!near(w, 280)) bad('④ Home 最窄 280', 'got ' + w)
  else ok('④ Home → 最窄 280')
  await key('End', 'End', 35)
  w = await width(page)
  if (!near(w, 560)) bad('④ End 最宽 560', 'got ' + w)
  else ok('④ End → 最宽 560')

  // ⑤ 双击恢复默认 320（分隔条在 aside 左缘，先取当前 rect）
  const r3 = await handleRect(page)
  await page.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: r3.x, y: r3.y, button: 'left', buttons: 1, clickCount: 2 })
  await page.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r3.x, y: r3.y, button: 'left', buttons: 0, clickCount: 2 })
  await sleep(300)
  w = await width(page)
  const s5 = await settingsWd(page)
  if (!near(w, 320)) bad('⑤ 双击恢复默认 320', 'got ' + w)
  else ok('⑤ 双击恢复默认 320')
  if (!near(s5, 320)) bad('⑤ 设置回写 320', 'got ' + s5)
  else ok('⑤ 设置回写 320')

  // ⑥ 零 JS 异常
  const errs = await page.eval(`window.__zjErr || []`)
  if (errs.length > 0) bad('⑥ 零 JS 异常', JSON.stringify(errs))
  else ok('⑥ 零 JS 异常')
} catch (e) {
  failures++
  console.log('FAIL 主流程异常 ::', e.message)
}

await fetch(CDP + '/json/close/' + tab.id).catch(() => {})
page.close()

console.log(failures === 0 ? `\nSMOKE PASS (${5 + failures} checks)` : `\nSMOKE FAIL (${failures} failures)`)
process.exit(failures === 0 ? 0 : 1)
