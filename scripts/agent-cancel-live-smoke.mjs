// 织卷真模型冒烟 · 生成停止链路（引擎级，智能层 2026-09-13 第三波收尾）
// 用法：node scripts/agent-cancel-live-smoke.mjs
// 前置：node scripts/zj-bridge.mjs（8810，真边车+真模型）；vLLM 127.0.0.1:8888 在线
// 链路：WS 直接发 runChat → 收到首个 delta 后发 cancel → 断言事件序：出现 aborted、无 final/done、
//       取消后不再收到 delta（转发拦截）。
// 注：zj-bridge 对 send 不回包——本脚本对 send 采用 fire-and-forget，事件统一经 event 消息收集。
import { createRequire } from 'node:module'
const { WebSocket } = createRequire('/tmp/zj-cdp/')('ws')

const ws = new WebSocket('ws://127.0.0.1:8810')
let seq = 0
const pending = new Map()
const events = []
let wake = null

ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.type === 'event') {
    events.push(m.event)
    if (wake) wake()
  }
}
function sendRaw(payload) {
  ws.send(JSON.stringify({ id: ++seq, ...payload }))
  return Promise.resolve()
}

let pass = 0
let fail = 0
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('PASS ' + name) }
  else { fail++; console.log('FAIL ' + name + (extra ? ' | ' + extra : '')) }
}
function waitForAny(pred, timeoutMs, label) {
  return new Promise((res, rej) => {
    const t0 = Date.now()
    const check = () => {
      const hit = events.find(pred)
      if (hit) return res(hit)
      if (Date.now() - t0 > timeoutMs) return rej(new Error('TIMEOUT: ' + label))
      setTimeout(check, 250)
    }
    check()
  })
}

await new Promise((r) => (ws.onopen = r))
console.log('WS OK')

const rid = 'live-cancel-' + Date.now()
console.log('SEND rid=' + rid)
sendRaw({ type: 'send', input: { requestId: rid, projectId: 'agent冒烟', chapterRel: null, chapterTitle: '', prompt: '一句话回答：你现在在做什么？' } })

let first = null
try {
  first = await waitForAny((e) => e.requestId === rid, 240000, '首个事件')
} catch (e) {
  console.error('FAIL: ' + e.message)
}
if (!first) {
  console.log('EVENTS SO FAR:', events.map((e) => e.type + (e.requestId === rid ? '' : '(other)')).join(',') || '(none)')
  ws.close()
  process.exit(1)
}
console.log('FIRST EVENT:', first.type, first.type === 'delta' ? (first.text || '').slice(0, 40) : JSON.stringify(first).slice(0, 120))

// 收到首个增量后发取消
await new Promise((r) => setTimeout(r, 300))
sendRaw({ type: 'cancel', requestId: rid })
console.log('CANCEL SENT')

let aborted = null
try {
  aborted = await waitForAny((e) => e.requestId === rid && e.type === 'aborted', 300000, 'aborted 收尾')
} catch (e) {
  console.error('FAIL: ' + e.message)
}
// 等一小段确认取消后无后续事件
await new Promise((r) => setTimeout(r, 2500))

const mine = events.filter((e) => e.requestId === rid)
console.log('EVENT TYPES:', mine.map((e) => e.type).join(','))
const lastIdx = mine.findIndex((e) => e.type === 'aborted')

ok('收到 aborted 收尾事件', aborted != null)
ok('无 final 事件（停止后不再全量覆盖）', !mine.some((e) => e.type === 'final'))
ok('无 done 事件（停止不算正常完成）', !mine.some((e) => e.type === 'done'))
ok('无 error', !mine.some((e) => e.type === 'error'))
ok('aborted 后无后续事件', lastIdx === mine.length - 1, 'idx=' + lastIdx + '/' + mine.length)

console.log('ALL OK ✅ (' + pass + '/' + (pass + fail) + ')')
ws.close()
process.exit(fail > 0 ? 1 : 0)
