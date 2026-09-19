// 截断文本提示（title 全量）走查 · 无头 UI 冒烟（2026-09-19 体验层）
// 断言：内容可截断的用户数据/帮助文本在列表、卡片、树节点、路径行均有 title 全量提示
//       （HIG tooltips/help tag：hover 显示完整内容，不偏离主界面）。
// 覆盖：Novel 章列标题/切片行、Agent 空态引导、世界观文档列/头部、素材类别/素材行、
//       时间线条目、设置页分区 hint/库根路径；全程零 JS 异常。
// 用法：node scripts/trunc-title-ui-smoke.mjs  （先 npm run build + node scripts/serve-renderer.mjs 8123，CDP 9224 在跑）
const PORT = 8123
const BASE = process.env.ZJ_SMOKE_BASE || `http://localhost:${PORT}`
// 每次新建独立 tab（避免复用到半坏 tab——2026-09-19 实踩 240s 挂死）
const page = await (await fetch('http://127.0.0.1:9224/json/new?' + encodeURIComponent(`${BASE}/?cb=${Date.now()}`), { method: 'PUT' })).json()
if (!page) { console.error('NO PAGE'); process.exit(1) }
// 全局看门狗：150s 强制退出（headless Chrome 僵死先例）
const watchdog = setTimeout(() => { console.error('WATCHDOG TIMEOUT'); process.exit(2) }, 150000)
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const errors = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params?.exceptionDetails?.text ?? 'exception')
  if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') errors.push('console.error')
}
function cmd(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++seq
    const to = setTimeout(() => { pending.delete(id); rej(new Error(`CDP TIMEOUT: ${method}`)) }, 8000)
    pending.set(id, (m) => { clearTimeout(to); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) })
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
await cmd('Runtime.enable')
let pass = 0, fail = 0
const ok = (cond, msg) => { console.log((cond ? '✅ ' : '❌ ') + msg); cond ? pass++ : fail++ }
const goto = async (hash, wait = 3000) => {
  await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}#${hash}` })
  await sleep(wait)
}

// ===== 1. Novel 页：章列标题 / 切片行 / Agent 空态引导 =====
await goto('/project/demo-aseya/novel')
const t1 = await ev(`(() => {
  const p = [...document.querySelectorAll('p')].find((x) => x.textContent?.includes('第1章') && x.textContent?.includes('雾港'))
  if (!p) return null
  return { title: p.getAttribute('title'), txt: p.textContent }
})()`)
ok(!!t1 && !!t1.title && t1.title === t1.txt.trim().replace(/\\s+/g, ' '), `章列标题行带 title 全量（${JSON.stringify(t1?.txt)}）`)
const t2 = await ev(`(() => {
  const spans = [...document.querySelectorAll('span')].filter((x) => (x.textContent || '').includes('第一幕_雾港之夜') || (x.textContent || '').includes('未设切片'))
  return spans.map((s) => ({ title: s.getAttribute('title'), txt: (s.textContent || '').slice(0, 40) }))
})()`)
ok(t2.some((s) => !!s.title && s.title.includes('第一幕_雾港之夜')), `章列切片行带 title（第一幕_雾港之夜）`)
// 选第01章 → AgentPanel 空态引导（引导项带 title 全量）
await ev(`(() => {
  const btn = [...document.querySelectorAll('aside button')].find((b) => (b.innerText || '').includes('第1章') && (b.innerText || '').includes('雾港'))
  if (!btn) return false
  btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  btn.click()
  return true
})()`)
await sleep(2500)
const t3 = await ev(`(() => {
  const li = document.querySelector('[data-testid="agent-empty-guide"]')
  if (!li) return null
  const sp = li.closest('ul')?.querySelector('span[title]')
  return sp ? { title: sp.getAttribute('title') } : null
})()`)
ok(!!t3 && !!t3.title, 'Agent 空态引导项带 title 全量')

// ===== 2. 世界观页（DocSection）：文档列 / 头部当前文档名 =====
await goto('/project/demo-aseya/worldview')
const t4 = await ev(`(() => {
  const sp = [...document.querySelectorAll('aside span')].find((x) => x.getAttribute('title')?.includes('第一幕_雾港之夜'))
  return sp ? sp.getAttribute('title') : null
})()`)
ok(!!t4, `世界观文档列项带 title（${t4 ?? 'null'}）`)
await ev(`(() => {
  const btn = [...document.querySelectorAll('aside button')].find((b) => (b.innerText || '').includes('第一幕_雾港之夜'))
  if (!btn) return false
  btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  btn.click()
  return true
})()`)
await sleep(1800)
const t5 = await ev(`(() => {
  const h = [...document.querySelectorAll('main span')].find((x) => x.className?.includes('font-medium') && x.getAttribute('title')?.includes('世界观/'))
  return h ? h.getAttribute('title') : null
})()`)
ok(!!t5, `文档头部文件名带 title（${t5 ?? 'null'}）`)

// ===== 3. 素材库页：类别树 / 素材行 =====
await goto('/project/demo-aseya/library')
const t6 = await ev(`(() => {
  const hits = [...document.querySelectorAll('aside span')].filter((x) => x.getAttribute('title') && (x.textContent === '桥段' || x.textContent === '环境' || x.textContent === '采集池'))
  return hits.map((x) => x.getAttribute('title'))
})()`)
ok(t6.some((x) => x === '桥段') && t6.some((x) => x === '环境'), `素材类别树节点带 title（${JSON.stringify(t6)}）`)
// 选「环境」类别 → 素材卡行名/预览带 title
await ev(`(() => {
  const btn = [...document.querySelectorAll('aside button')].find((b) => (b.innerText || '').includes('环境') && !(b.innerText || '').includes('/'))
  if (!btn) return false
  const sp = btn.querySelector('span[title="环境"]')
  ;(sp ?? btn).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  ;(sp ?? btn).dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  ;(sp ?? btn).click()
  return true
})()`)
await sleep(1800)
const t7 = await ev(`(() => {
  const sp = [...document.querySelectorAll('main span')].find((x) => x.textContent?.includes('采集_演示图书馆') && x.getAttribute('title'))
  return sp ? sp.getAttribute('title') : null
})()`)
ok(!!t7, `素材卡行名带 title（${t7 ?? 'null'}）`)

// ===== 4. 时间线页：条目标题 / 路径行 =====
await goto('/project/demo-aseya/timeline')
const t8 = await ev(`(() => {
  const sp = [...document.querySelectorAll('span')].find((x) => (x.textContent || '').includes('第1章') && (x.textContent || '').includes('雾港') && x.getAttribute('title'))
  return sp ? sp.getAttribute('title') : null
})()`)
ok(!!t8, `时间线条目标题带 title（${t8 ?? 'null'}）`)
const t9 = await ev(`(() => {
  const p = [...document.querySelectorAll('p')].find((x) => (x.textContent || '').includes('第01章_雾港') && x.getAttribute('title'))
  return p ? p.getAttribute('title') : null
})()`)
ok(!!t9, `时间线路径行带 title（${t9 ?? 'null'}）`)

// ===== 5. 设置页：分区 hint / 库根路径 =====
await goto('/project/demo-aseya/characters')
await sleep(800)
await goto('/settings')
await sleep(2200)
const t10 = await ev(`(() => {
  const hints = [...document.querySelectorAll('aside [title]:not([title=""])')]
  return hints.filter((x) => (x.textContent || '').length > 4).length
})()`)
ok(t10 > 0, `设置页左侧分区带 title（${t10} 处）`)
const t11 = await ev(`(() => {
  const p = [...document.querySelectorAll('div p')].find((x) => (x.textContent || '').startsWith('当前：') && x.getAttribute('title'))
  return p ? p.getAttribute('title') : null
})()`)
ok(!!t11 && /织卷项目库|织卷工作区/.test(t11), `设置页「当前：」路径行带 title（${t11 ?? 'null'}）`)

// ===== 6. 零 JS 异常 =====
ok(errors.length === 0, `全程零 JS 异常（${errors.length}）`)

console.log(`\nRESULT: ${pass} passed, ${fail} failed, errors=${errors.length}`)
clearTimeout(watchdog)
try { await fetch('http://127.0.0.1:9224/json/close/' + page.id) } catch { /* 关闭失败不碍事 */ }
if (fail > 0) process.exit(1)
