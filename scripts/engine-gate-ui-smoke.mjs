// 织卷无头冒烟 · 引擎离线前置提示（智能层 2026-09-12；配合 devShim ?zj-fail(-x)=agentStatus 模拟离线）
// 用法：node scripts/engine-gate-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：
// ① 持续失败 zj-fail-x=agentStatus：输入后发送 → 就地提示「引擎离线，无法发送」、输入保留、不注入消息气泡
// ② 同 tab 点提示条「重试」→ 仍离线提示仍在（查询持续失败）
// ③ 一次性失败 zj-fail=agentStatus：发送被拦提示出现 → 点重试（恢复在线）→ 提示消失 → 再发送走通（出现回复）
import { strict as assert } from 'node:assert'

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

const bodyHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
const TA = `document.querySelector('textarea[placeholder*="让 agent"]')`
const inputVal = `(${TA})?.value ?? ''`

async function step(name, fn) {
  try {
    await fn()
    console.log('PASS', name)
  } catch (e) {
    console.log('FAIL', name, '-', e.message)
    process.exitCode = 1
  }
}

// ① 持续失败：发送被拦 + 就地提示 + 输入保留 + 不注入气泡（空态仍在）
await step('① 持续失败发送被拦：提示出现/输入保留/无消息注入', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-fail-x=agentStatus#/project/demo-aseya/novel')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, `!!${TA}`, Boolean, 20000, 'agent textarea')
  await page.eval(`(() => {
    const el = ${TA}; el.focus()
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
    setter.call(el, '测试离线拦截')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  assert.equal(await page.eval(inputVal), '测试离线拦截', 'input set')
  await page.eval(`document.querySelector('button[title="发送"]').click()`)
  await evalUntil(page, bodyHas('引擎离线，无法发送'), Boolean, 20000, 'offline hint')
  assert.equal(await page.eval(inputVal), '测试离线拦截', 'input kept after block')
  assert.ok(await page.eval(bodyHas('在右侧和 agent 边聊边生成')), 'empty state still there (no message injected)')
  page.close()
})

// ② 提示条重试：仍失败 → 提示仍在
await step('② 点提示条重试（持续失败）提示仍在', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-fail-x=agentStatus#/project/demo-aseya/novel')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, `!!${TA}`, Boolean, 20000, 'agent textarea')
  await page.eval(`(() => {
    const el = ${TA}; el.focus()
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
    setter.call(el, 'x')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await page.eval(`document.querySelector('button[title="发送"]').click()`)
  await evalUntil(page, bodyHas('引擎离线，无法发送'), Boolean, 20000, 'offline hint')
  await page.eval(`[...document.querySelectorAll('button')].find(b => b.title === '重新探测引擎状态').click()`)
  await sleep(800)
  assert.ok(await page.eval(bodyHas('引擎离线，无法发送')), 'hint still there after retry (still failing)')
  page.close()
})

// ③ 页内覆盖模拟离线→发送被拦→恢复在线→重试提示消失→发送走通
// 注：不用 ?zj-fail（一次性失败会先被 EngineBadge 的 20s 轮询消耗，时序不稳定），
// 用覆盖 window.zhijuan.agentStatus 精确控制 online=false→true 两态。
await step('③ 离线覆盖→拦截→恢复→重试提示消失→发送走通', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, `!!${TA}`, Boolean, 20000, 'agent textarea')
  await page.eval(`window.__realStatus = window.zhijuan.agentStatus`)
  await page.eval(`window.zhijuan.agentStatus = async () => ({ online: false, message: '写作引擎启动失败（模拟）' })`)
  await page.eval(`(() => {
    const el = ${TA}; el.focus()
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
    setter.call(el, '测试恢复')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await page.eval(`document.querySelector('button[title="发送"]').click()`)
  await evalUntil(page, bodyHas('引擎离线，无法发送'), Boolean, 20000, 'offline hint')
  assert.ok(await page.eval(bodyHas('写作引擎启动失败（模拟）')), 'offline reason shown')
  assert.equal(await page.eval(inputVal), '测试恢复', 'input kept')
  // 恢复在线：重试 → 提示消失
  await page.eval(`window.zhijuan.agentStatus = window.__realStatus`)
  await page.eval(`[...document.querySelectorAll('button')].find(b => b.title === '重新探测引擎状态').click()`)
  await evalUntil(page, bodyHas('引擎离线，无法发送'), (v) => v === false, 20000, 'hint gone after retry')
  // 输入仍在，直接再发送 → devShim 假回复走通
  await page.eval(`document.querySelector('button[title="发送"]').click()`)
  await evalUntil(page, bodyHas('思考'), Boolean, 30000, 'agent reply after recovery')
  assert.equal(await page.eval(inputVal), '', 'input cleared after send')
  page.close()
})

const n = process.exitCode ? 'FAILED' : 'ALL PASS'
console.log('DONE', n)
