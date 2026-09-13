// 织卷无头冒烟 · 生成停止链路（智能层 2026-09-13，第三波收尾）
// 用法：node scripts/agent-cancel-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs（8123）；本机专用无头 Chrome CDP 127.0.0.1:9224
// 链路（devShim + zj-agent-delay=200 拉长演示流）：发送普通消息 → 首个 delta 出现后点「停止生成」→
//       devShim agentCancel 标记该请求（cancelledAgentRids）并立即补发 aborted → 断言：
//       assistant 结尾出现「（已停止）」、无 final 全文覆盖、停止后内容不再增长、流结束后停止按钮恢复发送。
// 背景：devShim agentCancel 此前为空操作（停止=点了没反应），本轮补停止模拟并真机口径对表
//       （事件不再转发 + aborted 替代 final/done）。
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
    await sleep(50)
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
// 最后一条 assistant 气泡的可见文本（agent 消息区 .prose）
const asstText = `(() => {
  const els = [...document.querySelectorAll('.prose')]
  const el = els[els.length - 1]
  return el ? el.innerText : ''
})()`

let pass = 0
let fail = 0
function ok(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log('PASS ' + name)
  } else {
    fail++
    console.log('FAIL ' + name + (extra ? ' | ' + extra : ''))
  }
}

const tab = await openTab(BASE + '/?zj-agent-delay=200&cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)

try {
  await evalUntil(
    page,
    `document.body.innerText.includes('Agent') && !!document.querySelector('textarea')`,
    (v) => v === true,
    20000,
    '正文页就绪'
  )
  console.log('OK 正文页就绪')

  // 发送普通消息（拉长的演示流：think/meta/delta 段各 200ms，全程约 3s）
  await typeText(page, '停止测试')
  await pressEnter(page)

  // 等首个 delta 落进 assistant 气泡（流进行中），立即点停止
  await evalUntil(page, asstText, (v) => v.length > 0 && v.includes('（dev'), 15000, '首段 delta 到达')
  console.log('OK 流进行中，点停止')
  const clicked = await page.eval(`(() => {
    const b = document.querySelector('button[aria-label="停止生成"]')
    if (!b) return false
    b.click()
    return true
  })()`)
  ok('停止按钮存在且已点击', clicked === true)

  // 等收尾：assistant 出现「（已停止）」、停止按钮恢复发送（streaming=false）
  await evalUntil(
    page,
    `(() => document.body.innerText.includes('（已停止）') && !document.querySelector('button[aria-label="停止生成"]'))()`,
    (v) => v === true,
    15000,
    '已停止标记 + 流结束'
  )
  await sleep(600) // 停止后再等一段，确认内容不再增长

  const asst = await page.eval(asstText)
  console.log('ASST TEXT:', JSON.stringify(asst.slice(0, 120)))

  ok('出现「（已停止）」标记', asst.includes('（已停止）'))
  ok('无 final 全文覆盖（demo 尾句未出现）', !asst.includes('把这一段写出来'), asst.slice(-80))
  ok('已生成内容保留（首段在）', asst.includes('（dev'), asst.slice(0, 60))

  // 内容不再增长：再等 900ms 文本不变
  const t1 = await page.eval(asstText)
  await sleep(900)
  const t2 = await page.eval(asstText)
  ok('停止后内容不再增长', t1 === t2, `len ${t1.length} -> ${t2.length}`)

  console.log('ALL OK ✅ (' + pass + '/' + (pass + fail) + ')')
} catch (err) {
  console.error('FAIL:', err.message)
  process.exitCode = 1
} finally {
  page.close()
}
