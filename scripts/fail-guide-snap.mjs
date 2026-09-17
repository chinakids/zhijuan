// 体验层 2026-09-17 · 失败步处置引导截图（无头 CDP 9224 + out/renderer）
// 用法：node scripts/fail-guide-snap.mjs [out.png]
import { writeFileSync } from 'node:fs'
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const OUT = process.argv[2] || '/Users/USER/Pictures/zhijuan/fail-guide.png'
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
async function typeText(page, text) {
  for (const ch of text) {
    await page.eval(`(() => {
      const ta = document.querySelector('textarea')
      ta.focus()
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), 'value').set
      setter.call(ta, ta.value + ${JSON.stringify(ch)})
      const pos = ta.value.length
      ta.setSelectionRange(pos, pos)
      const ev = new Event('input', { bubbles: true })
      ev.isComposing = false
      ta.dispatchEvent(ev)
      ta.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    await sleep(50)
  }
}
const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
const page = await attach(tab.webSocketDebuggerUrl)
await evalUntil(page, `!!document.querySelector('textarea')`, (v) => v === true, 20000, '就绪')
await typeText(page, '链失败演示')
await page.eval(`(() => {
  const ta = document.querySelector('textarea')
  ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
})()`)
await evalUntil(
  page,
  `document.body.innerText.includes('×3 展开') && document.body.innerText.includes('第 3 段读取失败')`,
  (v) => v === true,
  25000,
  '链失败演示结束'
)
await sleep(500)
// 展开链，展示第 3 步失败卡按钮
await page.eval(`([...document.querySelectorAll('button')].find((b) => b.textContent.includes('×3')))?.click()`)
await sleep(500)
// 点击组头按钮：输入框出现预写指引（截图可见「失败徽标+按钮+指引」完整状态）
await page.eval(`document.querySelector('[data-testid="zj-tool-chain"] [data-testid="zj-tool-fail-guide"]')?.click()`)
await sleep(500)
const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
if (shot?.data) {
  writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
  console.log('SHOT', OUT)
} else {
  console.log('NO SHOT')
}
page.close()
