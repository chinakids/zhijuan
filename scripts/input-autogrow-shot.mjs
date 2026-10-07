// Agent 输入区 auto-grow 截图（体验层 2026-10-03 候选 1）
// 用法：node scripts/input-autogrow-shot.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const OUT = `${process.env.HOME}/Pictures/zhijuan`
mkdirSync(OUT, { recursive: true })
const CDP = 'http://127.0.0.1:9224'
const BASE = 'http://127.0.0.1:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const tab = await fetch(CDP + '/json/new?' + encodeURIComponent(BASE + '/#/project/demo-aseya/novel?cb=' + Date.now()), { method: 'PUT' }).then((r) => r.json())
const ws = new WebSocket(tab.webSocketDebuggerUrl)
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
await new Promise((r) => (ws.onopen = r))
await cmd('Page.enable')
const ev = async (expression) => {
  const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r.result?.value
}
const shot = async (name) => {
  const r = await cmd('Page.captureScreenshot', { format: 'png' })
  writeFileSync(resolve(OUT, name), Buffer.from(r.data, 'base64'))
  console.log('SHOT', name)
}
const setTa = (text) =>
  ev(`(() => {
    const ta = document.querySelector('textarea[role="combobox"]')
    if (!ta) return false
    ta.focus()
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, ${JSON.stringify(text)})
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)

for (let i = 0; i < 30; i++) {
  await sleep(1000)
  if (await ev('!!document.querySelector("#zj-agent-panel")')) break
}
await sleep(1500)
await ev(`(() => { const els = Array.from(document.querySelectorAll('button')).filter((b) => (b.textContent || '').includes('第1章')); if (els.length) els[0].click(); return els.length })()`)
await sleep(1000)

// light 空态
await shot('input-autogrow-empty-2023.png')
// light 3 行（增高）
await setTa('陈默蹲在码头边，把烟盒里最后一根烟摸出来，却没有点。\n海风把浪声推得很远，像是刻意要留出一段安静，\n好让人听清自己心里那些没说的话。')
await sleep(600)
await shot('input-autogrow-2023.png')
// light 超长（滚动）
await setTa(Array.from({ length: 14 }, (_, i) => `第${i + 1}段：夜里的雾港没什么行人，只有路灯把湿漉漉的街面照得发亮，陈默沿着防波堤慢慢走。`).join('\n'))
await sleep(600)
await shot('input-autogrow-max-2023.png')
// dark 3 行
await setTa('陈默蹲在码头边，把烟盒里最后一根烟摸出来，却没有点。\n海风把浪声推得很远，像是刻意要留出一段安静，\n好让人听清自己心里那些没说的话。')
await ev(`document.documentElement.classList.add('dark')`)
await sleep(600)
await shot('input-autogrow-dark-2023.png')

await fetch(CDP + '/json/close/' + tab.id).catch(() => {})
process.exit(0)
