// V-01 侧栏/内容区分隔收尾 · 无头冒烟：纸卡去框（border/radius=0）+ 正文页台面留白（main p-3）
// 断言：① .zj-md 容器 borderWidth=0 ② main padding=12px ③ 面板与纸卡之间露出 body 纸色台面 ④ 明/暗两主题一致
// 用法：node scripts/sidebar-v01-smoke.mjs   （先 npm run build + node scripts/serve-renderer.mjs 8123 + CDP 9224）
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

await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}#/project/demo-aseya/novel` })
await sleep(3500)
await ev(`(() => { const b = [...document.querySelectorAll('aside button')].find((x) => x.textContent.includes('章')); if (b) b.click(); return !!b })()`)
await sleep(1000)
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
  ok(p.mainPad && Math.abs(parseFloat(p.mainPad[0]) - 12) < 0.5 && Math.abs(parseFloat(p.mainPad[1]) - 12) < 0.5, `${label}: main 台面留白 12px（实际 ${p.mainPad}）`)
  ok(p.gap !== null && p.gap >= 11 && p.gap <= 13, `${label}: 面板→纸卡台缝 ~12px（实际 ${p.gap}）`)
  ok(p.coveredByZj === false, `${label}: 台缝未被纸卡覆盖（透出 body 纸色，纸卡占位 ${p.coveredByZj}）`)
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
