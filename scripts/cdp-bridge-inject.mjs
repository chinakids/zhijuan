// 无头页面 → 真引擎桥：把 window.zhijuan 的 agent 通道替换为走本机 WS（zj-bridge）
// 只换通道，devShim 的 agentListeners 同步接事件，界面各卡照常渲染。
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
const patch = `
(() => {
  const api = window.zhijuan
  const bridge = new WebSocket('ws://127.0.0.1:8810')
  window.__BRIDGE = bridge
  const waiters = new Map() // requestId → resolve
  let seq = 0
  api.agentSend = async (input) => {
    const rid = input.requestId || ('b' + (++seq).toString(36))
    return new Promise((resolve) => {
      waiters.set(rid, resolve)
      bridge.send(JSON.stringify({ type: 'send', input: { ...input, requestId: rid } }))
    })
  }
  api.agentCancel = async (rid) => { bridge.send(JSON.stringify({ type: 'cancel', requestId: rid })); return true }
  api.agentAnswer = async (batch, answers) => { bridge.send(JSON.stringify({ type: 'answer', batch, answers })); return { ok: true } }
  api.agentStatus = async () => ({ online: true, provider: 'bridge->harness', model: 'deepseek-v4-flash-0731' })
  bridge.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.type === 'event') {
      if ((m.event.type === 'done' || m.event.type === 'error' || m.event.type === 'aborted')) {
        const resolve = waiters.get(m.event.requestId)
        if (resolve) { waiters.delete(m.event.requestId); resolve({ ok: true }) }
      }
      if (api.agentListeners) {
        for (const h of [...api.agentListeners]) { try { h(m.event) } catch {} }
      }
    }
  }
  return 'injected'
})()
`
const r = await cmd('Runtime.evaluate', { expression: patch, awaitPromise: true, returnByValue: true })
console.log(JSON.stringify(r.result?.value ?? r, null, 2))
ws.close()
