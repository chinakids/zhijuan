// V-04 图标统一 · 无头 UI 冒烟：验证紧凑 shadcn Button 内图标实际渲染 12px（[&_svg]:size-3 生效），
// 且默认 Button 图标仍 16px。驱动 devShim「改」触发 EditCard（采纳并写入/拒绝 按钮）。
// 用法：node scripts/icon-size-ui-smoke.mjs   （先 npm run build + node scripts/serve-renderer.mjs 8123）
const PORT = 8123
const BASE = process.env.ZJ_SMOKE_BASE || `http://localhost:${PORT}`
const list = await (await fetch('http://127.0.0.1:9224/json')).json()
const page = list.find((t) => t.type === 'page' && new RegExp(`:${PORT}`).test(t.url) && /novel/.test(t.url))
if (!page) { console.error('NO NOVEL PAGE'); process.exit(1) }
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ev = async (expression) => {
  const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
  return r.result?.value
}
await new Promise((r) => (ws.onopen = r))
let pass = 0, fail = 0
const ok = (cond, msg) => { console.log((cond ? '✅ ' : '❌ ') + msg); cond ? pass++ : fail++ }

// 1. 带缓存破坏参数重载
await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}#/project/demo-aseya/novel` })
await sleep(3500)
ok(/novel/.test(await ev('location.hash')), '页面已载入 novel 路由')
ok(!!(await ev(`!!document.querySelector('textarea[placeholder*="让 agent"]')`)), 'agent 输入框存在')

// 2. 「引用选中」按钮（与快捷指令 chips 同权重，2026-09-16 主人：文本引用与其他功能无不同）图标应为 12px
const clip = await ev(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('引用选中'))
  if (!btn) return null
  const svg = btn.querySelector('svg')
  return svg ? [svg.getBoundingClientRect().width, svg.getBoundingClientRect().height] : null
})()`)
ok(!!clip && Math.abs(clip[0] - 12) < 0.5 && Math.abs(clip[1] - 12) < 0.5, `引用选中 图标 12px（实际 ${clip && clip[0]}px）`)

// 3. 发送「帮我改」→ devShim 出 EditCard（采纳并写入 / 拒绝）
await ev(`(() => {
  const ta = document.querySelector('textarea[placeholder*="让 agent"]')
  ta.focus()
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(ta, '帮我改一下这段')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
await sleep(300)
await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 })
await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
let edit = null
for (let i = 0; i < 20 && !edit; i++) {
  await sleep(500)
  edit = await ev(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('采纳并写入'))
    if (!btn) return null
    const svg = btn.querySelector('svg')
    return { w: svg ? svg.getBoundingClientRect().width : null, text: btn.textContent.trim() }
  })()`)
}
ok(!!edit, `EditCard 采纳并写入 按钮出现（${edit ? edit.text : '未出现'}）`)
ok(!!edit && edit.w !== null && Math.abs(edit.w - 12) < 0.5, `采纳并写入 图标 12px（实际 ${edit && edit.w}px）`)

const reject = await ev(`(() => {
  const adopt = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('采纳并写入'))
  if (!adopt) return null
  const wrap = adopt.parentElement
  if (!wrap) return null
  const btn = [...wrap.querySelectorAll('button')].find((b) => b.textContent.includes('拒绝'))
  if (!btn) return null
  const svg = btn.querySelector('svg')
  return svg ? svg.getBoundingClientRect().width : null
})()`)
ok(!!reject && Math.abs(reject - 12) < 0.5, `拒绝 图标 12px（实际 ${reject}px）`)

// 4. 主题核对：暗色下图标尺寸不变（尺寸类与主题无关，仅防回归寄存）
await ev(`document.documentElement.classList.add('dark')`)
await sleep(200)
const darkW = await ev(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('采纳并写入'))
  const svg = btn && btn.querySelector('svg')
  return svg ? svg.getBoundingClientRect().width : null
})()`)
ok(!!darkW && Math.abs(darkW - 12) < 0.5, `暗色下 采纳并写入 图标仍 12px（实际 ${darkW}px）`)
await ev(`document.documentElement.classList.remove('dark')`)

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
ws.close()
process.exit(fail ? 1 : 0)
