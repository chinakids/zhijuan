// 体验层 2026-09-22 · Agent 对话按项目分桶截图（无头 CDP 9224 + SPA 8899）
// 用法：node scripts/agent-bucket-snap.mjs
import { writeFileSync } from 'node:fs'
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://127.0.0.1:8899'
const DIR = '/Users/USER/Pictures/zhijuan'
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
async function sendMsg(page, text) {
  await page.eval(`(() => { const t = document.querySelector('textarea'); if (t) t.focus(); return !!t })()`)
  await page.cmd('Input.insertText', { text })
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 })
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  for (let i = 0; i < 120; i++) {
    await sleep(500)
    const idle = await page.eval(`!document.querySelector('button[title="停止生成"]')`)
    if (idle && i > 2) break
  }
  await sleep(800)
}
async function shot(page, name) {
  const r = await page.cmd('Page.captureScreenshot', { format: 'png' })
  const p = DIR + '/' + name
  writeFileSync(p, Buffer.from(r.data, 'base64'))
  console.log('saved', p)
}
const hhmm = new Date().toTimeString().slice(0, 5).replace(':', '')
const tab = await openTab(`${BASE}/#/project/demo-aseya/novel?cb=${Date.now()}`)
const page = await attach(tab.webSocketDebuggerUrl)
await page.cmd('Page.enable')
await sleep(4500)
await sendMsg(page, '帮我看一下第01章的开头节奏')
await shot(page, `agent-bucket-aseya-${hhmm}.png`)
await page.eval(`location.hash = '#/project/demo-order/novel'`)
await sleep(1800)
await sendMsg(page, '第02章的高潮铺垫够不够')
await shot(page, `agent-bucket-order-${hhmm}.png`)
// 切回 A：A 消息仍在（分桶不丢）——补一张隔离证明
await page.eval(`location.hash = '#/project/demo-aseya/novel'`)
await sleep(1800)
await shot(page, `agent-bucket-back-aseya-${hhmm}.png`)
await page.cmd('Target.closeTarget', { targetId: tab.id }).catch(() => {})
page.close()
console.log('DONE')
