// 通用 CDP 抓取：node scripts/cdp-fetch.mjs <url> [--wait ms] [--selector s]
const url = process.argv[2]
const waitArg = process.argv.findIndex((a) => a === '--wait')
const waitMs = waitArg >= 0 ? Number(process.argv[waitArg + 1]) : 5000
const selArg = process.argv.findIndex((a) => a === '--selector')
const sel = selArg >= 0 ? process.argv[selArg + 1] : null
const tab = await (
  await fetch('http://127.0.0.1:9224/json/new?url=' + encodeURIComponent('about:blank'), { method: 'PUT' })
).json()
const ws = new WebSocket(tab.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
function cmd(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++seq
    pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
}
await new Promise((r) => (ws.onopen = r))
await cmd('Page.enable')
await cmd('Page.navigate', { url })
await new Promise((r) => setTimeout(r, waitMs))
let expr = sel
  ? `(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? el.innerText : 'SEL_NOT_FOUND'; })()`
  : `document.body ? document.body.innerText : ''`
const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true })
const text = (r.result?.value ?? '') + ''
// 压缩连续空行
console.log(text.replace(/\n{3,}/g, '\n\n'))
ws.close()
await fetch('http://127.0.0.1:9224/json/close/' + tab.id)
