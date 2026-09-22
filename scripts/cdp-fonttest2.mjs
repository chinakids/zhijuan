// 实验2：注入 @font-face（unicode-range 分离）后验证字形归属
// 用法: node scripts/cdp-fonttest2.mjs
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

const inject = `
(() => {
  const style = document.createElement('style');
  style.textContent = \`
    @font-face {
      font-family: 'zj-serif-latin';
      src: local('Georgia'), local('Times New Roman');
      unicode-range: U+0000-00FF, U+0100-017F, U+0180-024F;
    }
  \`;
  document.head.appendChild(style);
  return 'injected';
})()
`
await cmd('Runtime.evaluate', { expression: inject, returnByValue: true })
await new Promise((r) => setTimeout(r, 1200))

const expr = `
(() => {
  const c = document.createElement('canvas').getContext('2d');
  const w = (text, family) => { c.font = '64px ' + family; return Math.round(c.measureText(text).width * 100) / 100; };
  const probes = ['A','a','0','.','-','\\"','“','”','’','—','…','「','，','的'];
  const fams = {
    songti_only: '"Songti SC"',
    georgia_only: 'Georgia',
    stack_current: '"Songti SC", "Noto Serif SC", Georgia, "Times New Roman", serif',
    stack_mixed: '"zj-serif-latin", "Songti SC", Georgia, serif'
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
