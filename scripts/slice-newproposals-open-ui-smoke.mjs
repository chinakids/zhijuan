// 切片同步「新建提案」浮条→「查看提案」直达 · 无头 UI 冒烟（2026-10-14 创作层）
// 背景：保存→切片同步「已生成 N 条切片提案」此前无直达入口——「先文沉淀设定」的产出
//       需先到左导航「待确认提案」才能复审（与 kept>0 的「查看提案」直达不对齐）。
//       本轮浮条在新建提案（items>0）时同样出现「查看提案」，点击打开提案抽屉并定位该新卡。
// 断言：L1 保存→「已生成 1 条切片提案」浮条（新建提案，kept=0）
//       L2 「查看提案」按钮出现（data-testid=zj-goto-proposals）
//       L3 取得新建 pending 提案 id
//       L4 点击「查看提案」→ 抽屉打开（role=dialog「提案」）+ 定位命中（data-focused=true + ring）
//       L5 零 JS 异常
// 用法：node scripts/slice-newproposals-open-ui-smoke.mjs （先 npm run build + SPA 8123 在跑，CDP 9224 在跑）
const PORT = 8123
const BASE = process.env.ZJ_SMOKE_BASE || `http://localhost:${PORT}`
const page = await (await fetch('http://127.0.0.1:9224/json/new?' + encodeURIComponent(`${BASE}/?cb=${Date.now()}&zj-sync-items=1`), { method: 'PUT' })).json()
if (!page) { console.error('NO PAGE'); process.exit(1) }
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
const findFloat = async (substr) => ev(`(() => {
  const els = [...document.querySelectorAll('div, span, p')].map((d) => (d.innerText || d.textContent || ''))
  const hit = els.filter((t) => t.includes(${JSON.stringify(substr)}))
  return hit.sort((a, b) => a.length - b.length)[0] ?? null
})()`)

// ===== 0. 打开 Novel 页并选中第1章 =====
await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}&zj-sync-items=1#/project/demo-aseya/novel` })
await sleep(3000)
const clicked = await ev(`(() => {
  const btn = [...document.querySelectorAll('aside button')].find((b) => (b.innerText || '').includes('第1章'))
  if (!btn) return false
  btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  btn.click()
  return true
})()`)
ok(!!clicked, '点击了第1章')
await sleep(2500)
ok(await ev(`!!(window.__ZJ_EDITORS && window.__ZJ_EDITORS.length)`), '编辑器实例已挂载')

// ===== L1. 保存 → 浮条「已生成 1 条切片提案」（新建提案，kept=0） =====
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))`)
await sleep(2500)
const f1 = await findFloat('已生成 1 条切片提案')
ok(!!f1, `浮条出现「已生成 1 条切片提案」（${JSON.stringify((f1 || '').slice(0, 60))}）`)

// ===== L2. 「查看提案」按钮出现（新建提案直达，不对称已消除） =====
const btn = await ev(`(() => {
  const b = document.querySelector('[data-testid="zj-goto-proposals"]')
  return b ? { text: b.innerText, visible: !!b.offsetParent } : null
})()`)
ok(!!btn && btn.text === '查看提案' && btn.visible, `「查看提案」按钮出现（${JSON.stringify(btn)}）`)

// ===== L3. 取得新建 pending 提案 id（浮条定位目标） =====
const pid = await ev(`(async () => {
  const ps = await window.zhijuan.listProposals('demo-aseya')
  return ps.find((p) => p.status === 'pending')?.id ?? null
})()`)
ok(!!pid, `取得新建 pending 提案 id（${pid}）`)

// ===== L4. 点击「查看提案」→ 抽屉打开 + 定位命中 =====
await ev(`(() => { const b = document.querySelector('[data-testid="zj-goto-proposals"]'); if (!b) return false; b.click(); return true })()`)
await sleep(1200)
const drawer = await ev(`(() => {
  const d = document.querySelector('[role="dialog"][aria-label="提案"]')
  return d ? { open: true, text: (d.innerText || '').slice(0, 60) } : { open: false }
})()`)
ok(drawer.open, `提案抽屉打开（${JSON.stringify(drawer)}）`)
const located = await ev(`(() => {
  const card = document.querySelector('[data-pid="${pid}"]')
  return card ? { found: true, focused: card.getAttribute('data-focused'), ring: (card.className || '').includes('ring') } : { found: false }
})()`)
ok(located.found && located.focused === 'true' && located.ring, `定位命中：data-pid 卡 data-focused=true + ring 高亮（${JSON.stringify(located)}）`)

// 截图留档（新建提案直达 + 定位高亮实态）
try {
  const shot = await cmd('Page.captureScreenshot', { format: 'png' })
  const { writeFileSync, mkdirSync } = await import('node:fs')
  mkdirSync(process.env.HOME + '/Pictures/zhijuan', { recursive: true })
  const hhmm = new Date().toTimeString().slice(0, 5).replace(':', '')
  const file = process.env.HOME + `/Pictures/zhijuan/slice-newproposals-open-${hhmm}.png`
  writeFileSync(file, Buffer.from(shot.data, 'base64'))
  console.log('📸 截图已存', file)
} catch (e) { console.log('截图失败（不阻塞）：', String(e)) }

// ===== L5. 零 JS 异常 =====
ok(errors.length === 0, `零 JS 异常（${errors.length}：${errors.slice(0, 3).join(' | ')}）`)
try { await fetch('http://127.0.0.1:9224/json/close/' + page.id) } catch { /* 忽略 */ }
clearTimeout(watchdog)
console.log(`\nSLICE-NEWPROPOSALS-OPEN UI SMOKE ${fail === 0 ? 'PASS' : 'FAIL'} (${pass} pass, ${fail} fail)`)
process.exit(fail === 0 ? 0 : 1)
