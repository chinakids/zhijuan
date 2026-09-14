// 定制 LoadingIndicator · 无头 UI 冒烟（F-20260912-02 质感专项：loading 定制动画）
// 验证：agent「生成中…」行渲染的是织卷定制指示器（svg[data-zj-ind]，12px，两圆环=底环+行走弧，
// 弧旋转动画 zj-ind-spin 1.2s、accent 色），reduced-motion 下动画关闭，暗色主题色跟随。
// 用法：node scripts/loading-indicator-ui-smoke.mjs   （先 npm run build + SPA server 8123 + CDP 9224）
const PORT = 8123
const BASE = process.env.ZJ_SMOKE_BASE || `http://localhost:${PORT}`
const list = await (await fetch('http://127.0.0.1:9224/json')).json()
const page = list.find((t) => t.type === 'page' && new RegExp(`:${PORT}`).test(t.url))
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ev = async (expression) => {
  const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
  return r.result?.value
}
await new Promise((r) => (ws.onopen = r))
let pass = 0, fail = 0
const ok = (cond, msg) => { console.log((cond ? '✅ ' : '❌ ') + msg); cond ? pass++ : fail++ }

// 1. 带缓存破坏参数重载（防旧 bundle）
await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}#/project/demo-aseya/novel` })
await sleep(3500)
ok(/novel/.test(await ev('location.hash')), '页面已载入 novel 路由')
ok(!!(await ev(`!!document.querySelector('textarea[placeholder*="让 agent"]')`)), 'agent 输入框存在')
ok(!!(await ev(`!!document.querySelector('script[src]').src.includes('index-')`)), 'bundle 已加载')

// 2. 发送消息 → 「生成中…」行应出现定制指示器（devShim agentSend 总时长 >1.5s，窗口充足）
await ev(`(() => {
  const ta = document.querySelector('textarea[placeholder*="让 agent"]')
  ta.focus()
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(ta, '帮我看看这段')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
await sleep(300)
await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 })
await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
let ind = null
for (let i = 0; i < 40 && !ind; i++) {
  await sleep(150)
  ind = await ev(`(() => {
    const row = [...document.querySelectorAll('div,span')].find((el) => el.textContent.trim() === '生成中…' || (el.textContent.includes('生成中') && el.textContent.length < 20))
    if (!row) return null
    const svg = row.querySelector('svg[data-zj-ind]')
    if (!svg) return null
    const cs = window.getComputedStyle
    const arc = svg.querySelector('circle.zj-ind-arc')
    const base = svg.querySelector('circle:not(.zj-ind-arc)')
    const st = arc ? window.getComputedStyle(arc) : null
    const bst = base ? window.getComputedStyle(base) : null
    const r = svg.getBoundingClientRect()
    return {
      w: r.width, h: r.height,
      circles: svg.querySelectorAll('circle').length,
      animName: st ? st.animationName : null,
      animDur: st ? st.animationDuration : null,
      arcStroke: st ? st.stroke : null,
      baseStroke: bst ? bst.stroke : null,
      lineCap: st ? st.strokeLinecap : null
    }
  })()`)
}
ok(!!ind, `「生成中…」行出现且含定制指示器（${ind ? `${ind.w}x${ind.h}` : '未捕获'}）`)
if (ind) {
  ok(Math.abs(ind.w - 12) < 0.5 && Math.abs(ind.h - 12) < 0.5, `指示器 12px（实际 ${ind.w}x${ind.h}）`)
  ok(ind.circles === 2, `双圆环结构（底环+行走弧，实际 ${ind.circles} 个 circle）`)
  ok(ind.animName === 'zj-ind-spin', `行走弧动画 zj-ind-spin（实际 ${ind.animName}）`)
  ok(ind.animDur === '1.2s', `动画时长 1.2s（实际 ${ind.animDur}）`)
  const light = ind.arcStroke && ind.arcStroke.replace(/\s/g, '')
  ok(!!light && (light.startsWith('rgb(15,118,110') || light.startsWith('rgb(15,118,110') || /#0f766e/i.test(light)), `亮色下弧=accent #0f766e（实际 ${ind.arcStroke}）`)
  ok(!!ind.baseStroke && ind.baseStroke !== ind.arcStroke, `底环≠弧（底环 ${ind.baseStroke}）`)
  ok(ind.lineCap === 'round', `圆头线帽（实际 ${ind.lineCap}）`)
}

// 3. prefers-reduced-motion：动画应关闭（HIG 让动效可取消）
await cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
await sleep(300)
const still = await ev(`(() => {
  const svg = document.querySelector('svg[data-zj-ind]')
  if (!svg) return null
  const arc = svg.querySelector('circle.zj-ind-arc')
  return arc ? window.getComputedStyle(arc).animationName : null
})()`)
ok(still === 'none', `reduced-motion 下动画 none（实际 ${still}）`)
await cmd('Emulation.setEmulatedMedia', { features: [] })

// 4. 暗色主题：弧色应跟随 tokens（--accent → #5caea4）——切换后重新触发一次生成（巧用第二条消息的窗口）
await ev(`document.documentElement.classList.add('dark')`)
await ev(`(() => {
  const ta = document.querySelector('textarea[placeholder*="让 agent"]')
  ta.focus()
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(ta, '再润一下这段')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
await sleep(300)
await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 })
await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
let dark = null
for (let i = 0; i < 30 && !dark; i++) {
  await sleep(150)
  dark = await ev(`(() => {
    const svg = document.querySelector('svg[data-zj-ind]')
    if (!svg) return null
    const arc = svg.querySelector('circle.zj-ind-arc')
    return arc ? window.getComputedStyle(arc).stroke : null
  })()`)
}
ok(!!dark && /rgb\(92,174,164|#5caea4|color\(srgb 0\.36/i.test(dark.replace(/\s/g, '')), `暗色下弧=accent #5caea4（实际 ${dark}）`)
await ev(`document.documentElement.classList.remove('dark')`)

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
ws.close()
process.exit(fail ? 1 : 0)
