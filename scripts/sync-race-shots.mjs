// 织卷截图 · Novel 浮条竞态修复后状态（创作层 2026-09-19 00:45 轮）
// 用法：node scripts/sync-race-shots.mjs  （修复后 out/renderer 已 build；CDP 9224 + 8123）
import { writeFileSync } from 'node:fs'
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
    ws.onopen = () => {
      res({
        cmd,
        eval: async (expression) => {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
          return r.result?.value
        },
        close: () => ws.close()
      })
    }
  })
}
async function evalUntil(page, expr, pred, timeoutMs = 20000, label = expr) {
  const t0 = Date.now()
  for (;;) {
    try { const v = await page.eval(expr); if (pred(v)) return v } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(300)
  }
}
const bodyHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
const clickBtn = (text) => `(() => {
  const el = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes(${JSON.stringify(text)}))
  if (!el) return false
  el.click()
  return true
})()`

async function shot(name) {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + name.qs + '#/project/demo-aseya/novel')
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    await evalUntil(page, bodyHas('第1章'), Boolean, 20000, '载入')
    await page.eval(clickBtn('第1章 · 雾港'))
    await evalUntil(page, `window.__ZJ_EDITORS && window.__ZJ_EDITORS.length > 0`, Boolean, 20000, '编辑器')
    await page.eval(`window.__ZJ_EDITORS[0].applyMarkdown('截图填充：雾港的夜又深了一层。', false)`)
    await evalUntil(page, bodyHas('未保存'), Boolean, 10000, '脏')
    await page.eval(clickBtn('保存'))
    await evalUntil(page, bodyHas(name.expect), Boolean, 15000, name.expect)
    await sleep(600)
    const { data } = await page.cmd('Page.captureScreenshot', { format: 'png' })
    writeFileSync(name.out, Buffer.from(data, 'base64'))
    console.log('OK ' + name.out)
  } finally {
    page.close()
  }
}

const hh = new Date().toTimeString().slice(0, 5).replace(':', '')
await shot({ qs: '&zj-slice=雾港夜', expect: '✓ 无设定变化', out: `/Users/USER/Pictures/zhijuan/sync-race-kept-${hh}.png` })
await shot({ qs: '&zj-slice=雾港夜&zj-fail-x=agentSync', expect: '✗ 切片同步失败', out: `/Users/USER/Pictures/zhijuan/sync-race-fail-${hh}.png` })
process.exit(0)
