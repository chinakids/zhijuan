// 体验层 2026-10-01 · 排队消息/命令可视化截图（无头 CDP 9224 + out/renderer）
// 用法：node scripts/queue-vis-snap.mjs [out.png]
import { writeFileSync } from 'node:fs'
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://127.0.0.1:8899'
const OUT = process.argv[2] || process.env.HOME + '/Pictures/zhijuan/queue-vis.png'
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
    await sleep(250)
  }
}
async function shot(page, file) {
  const r = await page.cmd('Page.captureScreenshot', { format: 'png' })
  writeFileSync(file, Buffer.from(r.data, 'base64'))
  console.log('SAVED ' + file)
}
const tab = await openTab(`${BASE}/?zj-agent-delay=300&zj-delay=agentDirector:3000&cb=${Date.now()}#/project/demo-aseya/novel?ch=${encodeURIComponent('第02章_灯塔.md')}`)
const page = await attach(tab.webSocketDebuggerUrl)
await page.cmd('Page.enable')
await evalUntil(page, `!!document.querySelector('textarea')`, (v) => !!v, 20000, '正文页就绪')
await sleep(800)
// 发送一条普通消息进入流式
await page.eval(`(() => { const t = document.querySelector('textarea'); t.focus(); return true })()`)
await page.cmd('Input.insertText', { text: '请先通读这一章，然后替我把握节奏。' })
await page.eval(`(() => { const t = document.querySelector('textarea'); t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return true })()`)
await evalUntil(page, `!!document.querySelector('button[title="停止生成"]')`, (v) => !!v, 10000, '流式开始')
await sleep(800)
// 排队两条：一条消息 + 一条命令
await page.eval(`(() => { const t = document.querySelector('textarea'); t.focus(); return true })()`)
await page.cmd('Input.insertText', { text: '把这段再写细腻一点，加一个留白。' })
await page.eval(`(() => { const t = document.querySelector('textarea'); t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return true })()`)
await sleep(500)
await page.eval(`(() => { const t = document.querySelector('textarea'); t.focus(); return true })()`)
await page.cmd('Input.insertText', { text: '/巡查 本章' })
await page.eval(`(() => { const t = document.querySelector('textarea'); t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return true })()`)
await sleep(1200)
const qinfo = await page.eval(`(() => {
  const q = document.querySelector('[data-testid="agent-queue-item"]')
  if (!q) return { none: true }
  const inner = q.querySelector('div.relative')
  const cs = getComputedStyle(inner)
  const label = inner.firstElementChild
  const lcs = label ? getComputedStyle(label) : null
  return { bg: cs.backgroundColor, border: cs.borderColor, color: cs.color, fontSize: cs.fontSize, br: cs.borderRadius,
    lfont: lcs?.fontSize, lcolor: lcs?.color, overflow: inner.scrollWidth > inner.clientWidth + 1 }
})()`)
console.log('STYLE', JSON.stringify(qinfo))
await evalUntil(page, `document.querySelectorAll('[data-testid="agent-queue-item"]').length`, (v) => v === 2, 8000, '两条排队条目')
await sleep(400)
await shot(page, OUT)
page.close()
process.exit(0)
