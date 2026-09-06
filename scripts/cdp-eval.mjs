// 思考块 UI 真机验证：CDP 真实输入一轮，然后读 DOM 看思考过程是否渲染
const expr = process.argv[2]
const list = await (await fetch('http://127.0.0.1:9224/json')).json()
const page = list.find((t) => t.type === 'page' && /8723/.test(t.url))
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
if (expr) {
  const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  console.log(JSON.stringify(r.result?.value ?? r, null, 2))
}
ws.close()
