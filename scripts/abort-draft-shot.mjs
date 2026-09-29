// 中断草稿恢复 · 无头截图（体验层 2026-09-29 候选 1）：① 响应未产出前停止 → 原输入恢复在输入框
// ② ↑ 回取最近草稿后的输入框。用法：node scripts/abort-draft-shot.mjs <输出目录>
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = resolve(process.argv[2] ?? resolve(process.cwd(), 'shots'))
mkdirSync(OUT, { recursive: true })
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
        shot: async (name) => {
          const r = await cmd('Page.captureScreenshot', { format: 'png' })
          writeFileSync(resolve(OUT, name), Buffer.from(r.data, 'base64'))
          console.log('SHOT', name)
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
      ta.focus()
      const proto = Object.getPrototypeOf(ta)
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
      setter.call(ta, ta.value + ${JSON.stringify(ch)})
      const pos = ta.value.length
      ta.setSelectionRange(pos, pos)
      const ev = new Event('input', { bubbles: true })
      ev.isComposing = false
      ta.dispatchEvent(ev)
      return ta.value
    })()`)
    await sleep(30)
  }
}
const taValue = `(() => { const ta = document.querySelector('textarea'); return ta ? ta.value : 'NO_TA' })()`

const tab = await openTab(BASE + '/?zj-agent-delay=800&cb=' + Date.now() + '#/project/demo-aseya/novel')
const page = await attach(tab.webSocketDebuggerUrl)
try {
  await evalUntil(
    page,
    `document.body.innerText.includes('Agent') && !!document.querySelector('textarea')`,
    (v) => v === true,
    25000,
    '正文页就绪'
  )
  const promptA = '长草稿不会丢甲：帮我回看雾港那段的灯语铺垫'
  await typeText(page, promptA)
  await page.eval(`(() => {
    const ta = document.querySelector('textarea')
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    return true
  })()`)
  await evalUntil(page, `!!document.querySelector('button[aria-label="停止生成"]')`, (v) => v === true, 15000, '停止按钮')
  await page.eval(`(() => { document.querySelector('button[aria-label="停止生成"]').click(); return true })()`)
  await evalUntil(page, `!document.querySelector('button[aria-label="停止生成"]')`, (v) => v === true, 30000, '流结束')
  await sleep(500)
  console.log('INPUT:', JSON.stringify(await page.eval(taValue)))
  await cmdShot(page, '中断草稿恢复-1-未产出前停止-恢复输入.png')
} catch (err) {
  console.error('FAIL:', err.message)
  process.exitCode = 1
} finally {
  page.close()
}

async function cmdShot(page, name) {
  // 聚焦输入区，裁出 Agent 面板区域截图（整页即可，重在输入框内容可见）
  await page.eval(`(() => {
    const ta = document.querySelector('textarea')
    ta && ta.focus()
    return true
  })()`)
  await sleep(300)
  await page.shot(name)
}
