// V-01 侧栏/内容区分隔收尾 · 无头冒烟：纸卡去框（border/radius=0）+ 页面容器零 padding（2026-09-14 3424210 口径）
// 断言：① .zj-md 容器 borderWidth=0 ② main padding=0（页面容器零 padding）③ 纸卡与 Agent 面板贴合（无台缝，gap≈0）
//        ④ 文本区留白由 .ProseMirror padding 提供（≥1rem） ⑤ 明/暗两主题下编辑器纸面≠台面
// 用法：node scripts/sidebar-v01-smoke.mjs   （先 npm run build + node scripts/serve-renderer.mjs 8123 + CDP 9224）
const PORT = 8123
const BASE = process.env.ZJ_SMOKE_BASE || `http://localhost:${PORT}`
const list = await (await fetch('http://127.0.0.1:9224/json')).json()
// 宿主页=本端口 novel 页；无→自开兜底（㉝ 契约：找宿主页的冒烟要么自开要么兜底，health-bar 13:30 先例）
let page = list.find((t) => t.type === 'page' && new RegExp(`:${PORT}`).test(t.url) && /novel/.test(t.url))
if (!page) {
  const r = await fetch('http://127.0.0.1:9224/json/new?' + encodeURIComponent(`${BASE}/?cb=${Date.now()}`), { method: 'PUT' })
  page = await r.json()
}
if (!page || !page.webSocketDebuggerUrl) { console.error('NO NOVEL PAGE'); process.exit(1) }
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

await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}#/project/demo-aseya/novel` })
await sleep(3000)
// 选章就绪等待（负载/CDP 退化期固定 sleep 不足，2026-09-18 全量实踩点击落空→编辑器未挂载）
for (let i = 0; i < 30; i++) {
  await ev(`(() => { const b = [...document.querySelectorAll('aside button')].find((x) => (x.textContent||'').includes('第1章') && !x.closest('[aria-hidden="true"]')); if (b) { b.click(); return true } return false })()`)
  if (await ev(`!!document.querySelector('.zj-md .milkdown')`)) break
  await sleep(500)
}
ok(await ev(`!!document.querySelector('.zj-md .milkdown')`), '编辑器已渲染')

const grab = `(() => {
  const cs = (el, prop) => el ? getComputedStyle(el)[prop] : null
  const zj = document.querySelector('.zj-md')
  const main = [...document.querySelectorAll('main')].find((m) => m.className.includes('flex-1'))
  const sec = [...document.querySelectorAll('aside')].find((a) => a.className.includes('bg-surface-2') && !a.className.includes('w-80'))
  const zr = zj ? zj.getBoundingClientRect() : null
  const sr = sec ? sec.getBoundingClientRect() : null
  // 台面：编辑器卡左侧 6px 处，命中元素链中不应有 .zj-md（纸卡不覆盖台缝），底色由 body 提供
  let coveredByZj = null
  if (zr && sr) {
    const els = document.elementsFromPoint(sr.right + 6, zr.top + 20)
    coveredByZj = els.some((el) => el.classList && el.classList.contains('zj-md'))
  }
  return {
    zjBorderW: cs(zj, 'borderTopWidth'), zjRadius: zj ? cs(zj, 'borderTopLeftRadius') : null,
    mainPad: main ? [cs(main, 'paddingLeft'), cs(main, 'paddingTop')] : null,
    gap: zr && sr ? Math.round(zr.left - sr.right) : null,
    coveredByZj, body: cs(document.body, 'backgroundColor'),
    zjBg: cs(zj, 'backgroundColor')
  }
})()`
const check = async (label) => {
  const p = await ev(grab)
  console.log(label, JSON.stringify(p))
  ok(p.zjBorderW === '0px', `${label}: 纸卡容器 border=0（实际 ${p.zjBorderW}）`)
  ok(p.zjRadius === '0px', `${label}: 纸卡无圆角（实际 ${p.zjRadius}）`)
  ok(p.mainPad && Math.abs(parseFloat(p.mainPad[0])) < 0.5 && Math.abs(parseFloat(p.mainPad[1])) < 0.5, `${label}: main 台面零 padding（3424210 口径，实际 ${p.mainPad}）`)
  ok(p.gap !== null && Math.abs(p.gap) <= 2, `${label}: 纸卡与面板贴合无台缝（3424210 口径，实际 gap=${p.gap}）`)
  const pmPad = await ev(`(() => { const pm = document.querySelector('.zj-md .ProseMirror'); return pm ? [getComputedStyle(pm).paddingLeft, getComputedStyle(pm).paddingTop] : null })()`)
  ok(pmPad && parseFloat(pmPad[0]) >= 12 && parseFloat(pmPad[1]) >= 16, `${label}: 文本区留白由 .ProseMirror 提供（实际 ${pmPad}）`)
  ok(p.zjBg !== p.body, `${label}: 编辑器纸面≠台面，背景差通道成立（${p.zjBg} vs ${p.body}）`)
}
await check('LIGHT')
await ev(`document.documentElement.classList.add('dark')`)
await sleep(250)
await check('DARK')
await ev(`document.documentElement.classList.remove('dark')`)

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
ws.close()
process.exit(fail ? 1 : 0)
