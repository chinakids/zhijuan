// 织卷无头验证 · 简体 CDP 驱动（node 原生 WebSocket）：真实输入事件，测 React 界面最贴近真机
// 用法:
//   node scripts/cdp-cmd.mjs eval '<js>'
//   node scripts/cdp-cmd.mjs type '<textarea的selector>' '<text>'   
//   node scripts/cdp-cmd.mjs enter
//   node scripts/cdp-cmd.mjs url '<url>'
const [,, sub, a, b] = process.argv
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
async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
if (sub === 'url') {
  await cmd('Page.navigate', { url: a })
  await sleep(3000)
} else if (sub === 'eval') {
  const r = await cmd('Runtime.evaluate', { expression: a, awaitPromise: true, returnByValue: true })
  console.log(JSON.stringify(r.result?.value ?? r, null, 2))
} else if (sub === 'type') {
  await cmd('Page.enable')
  await cmd('DOM.enable')
  const doc = await cmd('DOM.getDocument')
  const { nodeId } = await cmd('DOM.querySelector', { nodeId: doc.root.nodeId, selector: a })
  await cmd('DOM.focus', { nodeId })
  await cmd('Input.insertText', { text: b })
} else if (sub === 'enter') {
  await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 })
  await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
} else if (sub === 'click') {
  const doc = await cmd('DOM.getDocument')
  const { nodeId } = await cmd('DOM.querySelector', { nodeId: doc.root.nodeId, selector: a })
  if (!nodeId) { console.log('selector not found'); ws.close(); process.exit(1) }
  const { objectId } = await cmd('DOM.resolveNode', { nodeId })
  await cmd('Runtime.callFunctionOn', { objectId, functionDeclaration: 'function(){ this.click() }' })
}
ws.close()
