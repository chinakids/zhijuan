// 织卷无头冒烟 · 中断草稿恢复（体验层 2026-09-29 候选 1·任务线-02 候选 6「响应开始前中断→恢复原 prompt 草稿重发」）
// 用法：node scripts/abort-draft-ui-smoke.mjs
// 前置：out/renderer 已 build；SPA server 8123（/tmp/spa_server.py）；本机专用无头 Chrome CDP 127.0.0.1:9224
// 覆盖：A) 响应未产出前点「停止生成」→ 原输入恢复到输入框可编辑重发（Claude Code Ctrl+C 同范式）；
//       B) 响应已开始后停止 → 输入框保持空（不恢复）；随后 ↑ 回取最近草稿 → 原 prompt 回到输入框。
// 背景：织卷原行为=停止生成后输入框已清空，长 prompt 误停需重打；本轮按任务线-02 候选 6 落地恢复+回取。
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
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
async function evalUntil(page, expr, pred, timeoutMs = 25000, label = expr) {
  const t0 = Date.now()
  for (;;) {
    try {
      const v = await page.eval(expr)
      if (pred(v)) return v
    } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(60)
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
const taValue = `(() => { const ta = document.querySelector('textarea'); return ta ? ta.value : 'NO_TA' })()`
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

// ---------- 场景 A：响应未产出前停止 → 恢复草稿 ----------
const tabA = await openTab(BASE + '/?zj-agent-delay=800&cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB A:', tabA.id)
const pageA = await attach(tabA.webSocketDebuggerUrl)
try {
  await evalUntil(
    pageA,
    `document.body.innerText.includes('Agent') && !!document.querySelector('textarea')`,
    (v) => v === true,
    25000,
    'A 正文页就绪'
  )
  const promptA = '长草稿不会丢甲：帮我回看雾港那段的灯语铺垫'
  await typeText(pageA, promptA)
  await pressEnter(pageA)
  // 等待停止按钮出现（streaming=true）后立刻点停止——此时首个 delta 还没到（demoDelay=800ms）
  await evalUntil(
    pageA,
    `!!document.querySelector('button[aria-label="停止生成"]')`,
    (v) => v === true,
    15000,
    'A 停止按钮出现'
  )
  console.log('OK A 流已开始（未产出正文），点停止')
  await pageA.eval(`(() => { document.querySelector('button[aria-label="停止生成"]').click(); return true })()`)
  // 等流结束（停止按钮消失=finally 已跑，恢复应已完成）
  await evalUntil(
    pageA,
    `!document.querySelector('button[aria-label="停止生成"]')`,
    (v) => v === true,
    30000,
    'A 流结束'
  )
  await sleep(300)
  const vA = await pageA.eval(taValue)
  ok('A 响应未产出前停止 → 原输入恢复', vA === promptA, JSON.stringify(vA))
  const asstA = await pageA.eval(asstText)
  ok('A 停止标记可见（（已停止））', asstA.includes('（已停止）'), asstA.slice(0, 60))
  ok('A 未出现 final 全文（演示尾句不在）', !asstA.includes('把这一段写出来'))
} catch (err) {
  console.error('FAIL A:', err.message)
  fail++
} finally {
  pageA.close()
}

// ---------- 场景 B：响应已开始后停止 → 不恢复；随后 ↑ 回取最近草稿 ----------
const tabB = await openTab(BASE + '/?zj-agent-delay=200&cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB B:', tabB.id)
const pageB = await attach(tabB.webSocketDebuggerUrl)
try {
  await evalUntil(
    pageB,
    `document.body.innerText.includes('Agent') && !!document.querySelector('textarea')`,
    (v) => v === true,
    25000,
    'B 正文页就绪'
  )
  const promptB = '已经开始的草稿乙'
  await typeText(pageB, promptB)
  await pressEnter(pageB)
  // 等首个 delta 落进 assistant 气泡（流已产出正文），再点停止
  await evalUntil(pageB, asstText, (v) => v.length > 0 && v.includes('（dev'), 20000, 'B 首段 delta 到达')
  await pageB.eval(`(() => { document.querySelector('button[aria-label="停止生成"]').click(); return true })()`)
  await evalUntil(
    pageB,
    `!document.querySelector('button[aria-label="停止生成"]')`,
    (v) => v === true,
    30000,
    'B 流结束'
  )
  await sleep(300)
  const vB = await pageB.eval(taValue)
  ok('B 响应已开始后停止 → 输入框保持空（不恢复）', vB === '', JSON.stringify(vB))
  // 输入框为空时按 ↑ → 应回取最近发送草稿
  await pageB.eval(`(() => {
    const ta = document.querySelector('textarea')
    ta.focus()
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
    return true
  })()`)
  await sleep(400)
  const vB2 = await pageB.eval(taValue)
  ok('B 停止后 ↑ 回取最近草稿', vB2 === promptB, JSON.stringify(vB2))
} catch (err) {
  console.error('FAIL B:', err.message)
  fail++
} finally {
  pageB.close()
}

console.log('ALL OK ✅ (' + pass + '/' + (pass + fail) + ')')
if (fail > 0) process.exitCode = 1
