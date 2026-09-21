// 双线结构点巡检 · 无头 UI 冒烟（2026-09-21 创作层）
// 断言：①大纲区「结构点巡检」按钮存在且可点（demo-aseya 有章卡）；②点击开抽屉并渲染演示报告
//      （summary/时间线分组/ends 已收束/notes 镜像/重跑按钮）；③?zj-structurefail 弱结果 →「检查未完成」+重试。
// 用法：node scripts/structure-check-ui-smoke.mjs（先 npm run build + http.server 8123 在跑，CDP 9224 在跑）
const PORT = 8123
const BASE = process.env.ZJ_SMOKE_BASE || `http://localhost:${PORT}`
const list = await (await fetch('http://127.0.0.1:9224/json')).json()
let page = list.find((t) => t.type === 'page' && new RegExp(`:${PORT}`).test(t.url))
if (!page) {
  const r = await fetch('http://127.0.0.1:9224/json/new?' + encodeURIComponent(`${BASE}/?cb=${Date.now()}`), { method: 'PUT' })
  page = await r.json()
}
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
// 无 JS 异常收集（36 支模板：Runtime.enable 早于导航 + 双通道收集）
const errors = []
ws.addEventListener('message', (ev2) => {
  const m = JSON.parse(ev2.data)
  if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params.exceptionDetails?.exception?.description ?? m.params))
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args?.map((a) => a.value ?? a.description).join(' ') ?? '')
})
await new Promise((r) => (ws.onopen = r))
await cmd('Runtime.enable')
let pass = 0, fail = 0
const ok = (cond, msg) => { console.log((cond ? '✅ ' : '❌ ') + msg); cond ? pass++ : fail++ }

// ===== 段 A：正常演示报告 =====
await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}#/project/demo-aseya/outline` })
await sleep(3500)

// 确保有章卡（demo-aseya 若无卡则经「回建」补齐——与真机同链路）
let hasCard = await ev(`window.zhijuan.readDoc('demo-aseya','大纲/第01章_雾港.md').then(x => !!x)`)
if (!hasCard) {
  await ev(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === '回建缺失的 1 张章卡' || x.getAttribute('aria-label') === '回建缺失章卡')
    if (!b) return false
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
    b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
    b.click()
    return true
  })()`)
  await sleep(2500)
  hasCard = await ev(`window.zhijuan.readDoc('demo-aseya','大纲/第01章_雾港.md').then(x => !!x)`)
}
ok(!!hasCard, 'demo-aseya 已具备章卡（回建兜底生效）')

const btn = await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === '结构点巡检')
  return b ? { disabled: b.disabled, title: b.title } : null
})()`)
ok(!!btn && !btn.disabled, `大纲区「结构点巡检」按钮存在且可点（title=${btn?.title?.slice(0, 30)}…）`)

await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === '结构点巡检')
  b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  b.click()
})()`)
await sleep(1500)

const panel = await ev(`(() => {
  const dlg = document.querySelector('[role="dialog"][aria-label="双线结构点巡检"]')
  if (!dlg) return null
  const t = dlg.textContent || ''
  return {
    title: (dlg.querySelector('[role="dialog"] > div')?.textContent || '').slice(0, 20),
    hasSummary: t.includes('（演示）主线三章完成开局'),
    hasLine1: t.includes('时间线：主线'),
    hasLine2: t.includes('时间线：过去线'),
    hasRole: t.includes('开局') && t.includes('高潮'),
    hasEnds: t.includes('早线收束检查') && t.includes('已收束') && t.includes('早线「过去线」'),
    hasNotes: t.includes('镜像'),
    hasRetry: [...dlg.querySelectorAll('button')].some((b) => (b.textContent || '').includes('重跑'))
  }
})()`)
ok(!!panel, '点击后打开「双线结构点巡检」抽屉')
ok(!!panel && !!panel.hasSummary, 'summary 渲染')
ok(!!panel && !!panel.hasLine1 && !!panel.hasLine2, '按时间线分组渲染（主线/过去线）')
ok(!!panel && !!panel.hasRole, '结构点 role 徽标渲染（开局/高潮）')
ok(!!panel && !!panel.hasEnds, '早线收束检查渲染（已收束 + 早线名）')
ok(!!panel && !!panel.hasNotes, '其他发现渲染（镜像）')
ok(!!panel && !!panel.hasRetry, '重跑按钮存在')
await ev(`document.querySelector('[role="dialog"][aria-label="双线结构点巡检"] button[aria-label]')?.click?.()`)
await sleep(300)

// ===== 段 B：弱结果注入（?zj-structurefail）→「检查未完成」+重试 =====
await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}&zj-structurefail=1#/project/demo-aseya/outline` })
await sleep(3200)
await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === '结构点巡检')
  if (!b) return false
  b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  b.click()
  return true
})()`)
await sleep(1200)
const weak = await ev(`(() => {
  const dlg = document.querySelector('[role="dialog"][aria-label="双线结构点巡检"]')
  if (!dlg) return null
  const t = dlg.textContent || ''
  return { notDone: t.includes('检查未完成'), retryBtn: [...dlg.querySelectorAll('button')].some((b) => (b.textContent || '').includes('重试')) }
})()`)
ok(!!weak && !!weak.notDone, '弱结果显示「检查未完成」（而非「没发现问题」）')
ok(!!weak && !!weak.retryBtn, '弱结果显示「重试」按钮')

ok(errors.length === 0, `全程无 JS 异常（${errors.length}）`)
if (errors.length) console.log('  异常：' + errors.slice(0, 3).join(' | '))
console.log(`\n[结构点巡检 UI 冒烟] ${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
