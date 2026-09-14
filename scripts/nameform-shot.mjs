// 称谓发现核查 · 无头截图（devShim 演示项目）：① Agent 面板头部（新 Tags 按钮可见）② 称谓抽屉（零命中空态）
// 用法：node scripts/nameform-shot.mjs <输出目录>
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = resolve(process.argv[2] ?? resolve(process.cwd(), 'shots'))
mkdirSync(OUT, { recursive: true })
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8899'
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
          console.log('shot:', name)
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

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
const page = await attach(tab.webSocketDebuggerUrl)
await page.cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false })
try {
  await evalUntil(page, `document.body.innerText.includes('Agent') && document.body.innerText.includes('第1章')`, (v) => v === true, 20000, '正文页就绪')
  await sleep(600)
  await page.shot('nameform-1-panel.png')
  const r = await page.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.title && x.title.startsWith('称谓发现核查'))
    if (!b) return 'NOT_FOUND'
    b.click()
    return 'CLICKED'
  })()`)
  console.log('click:', r)
  await evalUntil(page, `document.body.innerText.includes('未发现') && document.body.innerText.includes('称谓发现核查（本地规则')`, (v) => v === true, 15000, '抽屉就绪')
  await sleep(600)
  await page.shot('nameform-2-drawer.png')
} finally {
  page.close()
}
