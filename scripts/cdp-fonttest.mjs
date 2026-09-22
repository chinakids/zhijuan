// 中英文混排字形归属实验（无头 Chrome canvas.measureText）
// 用法: node scripts/cdp-fonttest.mjs
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

const expr = `
(() => {
  const c = document.createElement('canvas').getContext('2d');
  const w = (text, family) => { c.font = '64px ' + family; return Math.round(c.measureText(text).width * 100) / 100; };
  const probes = ['A','a','0','.','-','\\"','“','”','「','」','，','—'];
  const fams = {
    songti: '"Songti SC", serif',
    georgia: 'Georgia, serif',
    times: '"Times New Roman", serif',
    songti_only: '"Songti SC"',
    georgia_only: 'Georgia',
    stack_current: '"Songti SC", "Noto Serif SC", Georgia, "Times New Roman", serif',
    stack_georgia_first: 'Georgia, "Songti SC", serif',
    mix_fontface: '"zj-latin", "Songti SC", serif'
  };
  const out = {};
  for (const [k, f] of Object.entries(fams)) { out[k] = {}; for (const p of probes) out[k][p] = w(p, f); }
  return out;
})()
`
const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true })
console.log(JSON.stringify(r.result?.value, null, 1))
ws.close()
await fetch('http://127.0.0.1:9224/json/close/' + tab.id)
