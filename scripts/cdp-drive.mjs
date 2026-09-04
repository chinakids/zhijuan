// 织卷无头验证 · 极简 CDP 驱动（node 原生 WebSocket，无需依赖）
// 用法: node scripts/cdp-drive.mjs <url> '(optional) js-expression'
const url = process.argv[2]
const expr = process.argv[3]
const list = await (await fetch('http://127.0.0.1:9224/json')).json()
const page = list.find((t) => t.type === 'page' && t.url.startsWith('http://127.0.0.1:8723'))
if (!page) { console.error('NO PAGE'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
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
if (url) {
  await cmd('Page.enable')
  await cmd('Page.navigate', { url })
  await new Promise((r) => setTimeout(r, 4000))
}
if (expr) {
  const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  console.log(JSON.stringify(r.result?.value ?? r, null, 2))
}
ws.close()
