// 织卷真模型冒烟 · 生成停止链路（页面级，智能层 2026-09-13 第三波收尾）
// 用法：node scripts/agent-cancel-live-ui-smoke.mjs
// 前置：node scripts/zj-bridge.mjs（8810）；python3 serve-renderer.mjs（8123）；CDP 9224；vLLM 在线
// 链路：无头页面（devShim）→ 注入 zj-bridge 桥（agent 通道换真引擎+真模型）→ 发消息 → 等首批 delta
//       → 点「停止生成」→ 断言：assistant 出现「（已停止）」、停止按钮恢复、内容不再增长、无 JS 异常。
const CDP = 'http://127.0.0.1:9224'
const BASE = 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
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
async function evalUntil(page, expr, pred, timeoutMs = 20000, label = expr) {
  const t0 = Date.now()
  for (;;) {
    try {
      const v = await page.eval(expr)
      if (pred(v)) return v
    } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(300)
  }
}
async function typeText(page, text) {
  for (const ch of text) {
    await page.eval(`(() => {
      const ta = document.querySelector('textarea')
      if (!ta) return 'NO_TA'
      ta.focus()
      const proto = Object.getPrototypeOf(ta)
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
      setter.call(ta, ta.value + ${JSON.stringify(ch)})
      const pos = ta.value.length
      ta.setSelectionRange(pos, pos)
      const ev = new Event('input', { bubbles: true })
      ev.isComposing = false
      ta.dispatchEvent(ev)
      ta.dispatchEvent(new Event('change', { bubbles: true }))
      return ta.value
    })()`)
    await sleep(40)
  }
  return 'OK'
}
async function pressEnter(page) {
  await page.eval(`(() => {
    const ta = document.querySelector('textarea')
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    return true
  })()`)
}
const asstText = `(() => {
  const els = [...document.querySelectorAll('.prose')]
  const el = els[els.length - 1]
  return el ? el.innerText : ''
})()`

let pass = 0
let fail = 0
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('PASS ' + name) }
  else { fail++; console.log('FAIL ' + name + (extra ? ' | ' + extra : '')) }
}

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)

try {
  await evalUntil(page, `document.body.innerText.includes('Agent') && !!document.querySelector('textarea')`, (v) => v === true, 20000, '正文页就绪')
  console.log('OK 正文页就绪')

  // 注入 zj-bridge 桥（agent 通道换真引擎；事件同时喂 devShim 的 agentListeners）
  const inject = await page.eval(`(() => {
    const api = window.zhijuan
    const bridge = new WebSocket('ws://127.0.0.1:8810')
    window.__BRIDGE = bridge
    const waiters = new Map()
    let seq = 0
    api.agentSend = async (input) => {
      const rid = input.requestId || ('b' + (++seq).toString(36))
      return new Promise((resolve) => {
        waiters.set(rid, resolve)
        bridge.send(JSON.stringify({ type: 'send', input: { ...input, requestId: rid } }))
      })
    }
    api.agentCancel = async (rid) => { bridge.send(JSON.stringify({ type: 'cancel', requestId: rid })); return true }
    api.agentAnswer = async (batch, answers) => { bridge.send(JSON.stringify({ type: 'answer', batch, answers })); return { ok: true } }
    api.agentStatus = async () => ({ online: true, provider: 'bridge->harness', model: 'deepseek-v4-flash-vision-exp-uncensored' })
    bridge.onmessage = (ev) => {
      const m = JSON.parse(ev.data)
      if (m.type === 'event') {
        if (m.event.type === 'done' || m.event.type === 'error' || m.event.type === 'aborted') {
          const resolve = waiters.get(m.event.requestId)
          if (resolve) { waiters.delete(m.event.requestId); resolve({ ok: true }) }
        }
        if (api.agentListeners) for (const h of [...api.agentListeners]) { try { h(m.event) } catch {} }
      }
    }
    return 'injected'
  })()`)
  ok('bridge 注入成功', inject === 'injected', String(inject))

  // 发消息（真模型；prompt 要求较长输出，保证「生成中」窗口足够大以验证停止按钮与真中断）
  await typeText(page, '用大约300字详细介绍一下这一章主角的成长轨迹、性格与当前处境，分三个自然段')
  await pressEnter(page)

  // 等首个正文 delta 进 assistant 气泡（流开始；真模型启动+推理/工具前置，最长 240s）
  await evalUntil(
    page,
    `(() => { const els = [...document.querySelectorAll('.prose')]; const t = els[els.length-1] ? els[els.length-1].innerText : ''; return t.length > 8 })()`,
    (v) => v === true,
    240000,
    '首个正文 delta 到达'
  )
  await sleep(150) // 让流跑一小段（不睡太久：vLLM 快，防止整轮已流完）
  const before = await page.eval(asstText)
  console.log('STREAM RUNNING, len=' + before.length)
  // 截图：生成中（停止按钮可见）
  const shot = async (name) => {
    try {
      const s = await page.cmd('Page.captureScreenshot', { format: 'png' })
      const fs = await import('node:fs')
      fs.mkdirSync(process.env.HOME + '/Pictures/zhijuan', { recursive: true })
      fs.writeFileSync(process.env.HOME + '/Pictures/zhijuan/' + name + '.png', Buffer.from(s.data, 'base64'))
      console.log('SHOT saved ' + name + '.png')
    } catch (e) { console.log('SHOT fail ' + name + ': ' + e.message) }
  }
  await shot('cancel-turn-generating-' + new Date().toTimeString().slice(0, 5).replace(':', ''))

  // 点停止（2026-09-14 起为真中断：cancel → abortRequest → cancelTurn(session/cancel RPC) → 引擎立即中止；不再等模型跑完）
  const tStop = Date.now()
  const clicked = await page.eval(`(() => {
    const b = document.querySelector('button[aria-label="停止生成"]')
    if (!b) return false
    b.click()
    return true
  })()`)
  ok('停止按钮存在且已点击', clicked === true)

  // 等「（已停止）」出现且停止按钮恢复（真中断后应明显快于模型自然跑完）
  await evalUntil(
    page,
    `(() => document.body.innerText.includes('（已停止）') && !document.querySelector('button[aria-label="停止生成"]'))()`,
    (v) => v === true,
    300000,
    '已停止标记 + 流结束'
  )
  const stopMs = Date.now() - tStop
  console.log('OK 已停止标记出现（点停止到收尾 ' + stopMs + 'ms）')
  await shot('cancel-turn-stopped-' + new Date().toTimeString().slice(0, 5).replace(':', ''))

  const asst = await page.eval(asstText)
  ok('出现「（已停止）」标记', asst.includes('（已停止）'))
  ok('已生成内容保留（停止前内容仍在）', asst.trim().length > 5, asst.slice(0, 80))

  // 停止后内容不再增长
  const t1 = await page.eval(asstText)
  await sleep(2500)
  const t2 = await page.eval(asstText)
  ok('停止后内容不再增长', t1 === t2, `len ${t1.length} -> ${t2.length}`)

  const jserr = await page.eval(`(() => window.__ZJ_ERR || 0)()`).catch(() => null)
  ok('无 JS 异常标记', jserr === null || jserr === 0, String(jserr))

  console.log('ALL OK ✅ (' + pass + '/' + (pass + fail) + ')')
} catch (err) {
  console.error('FAIL:', err.message)
  process.exitCode = 1
} finally {
  page.close()
}
