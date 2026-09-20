// 切片同步「未处置同款」复用旧卡 · 无头 UI 冒烟（2026-09-20 创作层，候选 3 收口）
// 背景：作者见过 pending 切片提案但未处置（没接受没拒绝）又保存——既有语义=同章旧 pending
//       置 stale + 新同款照建（「刚看又弹」）；本轮 createSliceProposals 复用旧卡
//       （pending 保护不置 stale 不新建，GitHub「未处置 alert 保持 open」同构），kept 浮条明示。
// 断言：K1 保存→「已生成 1 条切片提案」（devShim ?zj-sync-items=1 注入固定同款动向）
//       K2 数据层：pending 1 条（target=人物/沈藏.md）
//       K3 不处置→改正文再保存→浮条「同款 1 条待确认，未重复提案」+ pending 仍 1 + 零 stale
//       K4 devShim createSliceProposals 同款→{created:[],kept:1}（同口径）
//       K5 after 微差→不误判（created=1/kept=0）
//       全程零 JS 异常。
// 用法：node scripts/slice-kept-ui-smoke.mjs （先 npm run build + SPA 8123 在跑，CDP 9224 在跑）
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

// ===== K1. 保存 → 浮条「已生成 1 条切片提案」 =====
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))`)
await sleep(2500)
const f1 = await findFloat('已生成 1 条切片提案')
ok(!!f1, `浮条出现「已生成 1 条切片提案」（${JSON.stringify((f1 || '').slice(0, 60))}）`)

// ===== K2. 数据层：pending 1 条（同款动向） =====
const p1 = await ev(`(async () => {
  const ps = await window.zhijuan.listProposals('demo-aseya')
  return ps.map((p) => ({ id: p.id, status: p.status, target: p.items[0]?.target, source: p.source }))
})()`)
ok(p1.length === 1 && p1[0].status === 'pending' && p1[0].target === '人物/沈藏.md', `同步产出 1 条 pending 切片提案（${JSON.stringify(p1[0])}）`)

// ===== K3. 不处置（不拒绝不接受）→ 改正文（一字）再保存 → 同款复用旧卡 + 浮条明示 =====
await ev(`window.__ZJ_EDITORS[0].setContent(window.__ZJ_EDITORS[0].getMarkdown().replace(/的/, '的。'))`)
await sleep(800)
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))`)
await sleep(2500)
const f3 = await findFloat('同款 1 条待确认，未重复提案')
ok(!!f3, `浮条出现「同款 1 条待确认，未重复提案」（${JSON.stringify((f3 || '').slice(0, 80))}）`)
// 截图留档（浮条 6s 自清，须在此步即截）
try {
  const shot = await cmd('Page.captureScreenshot', { format: 'png' })
  const { writeFileSync, mkdirSync } = await import('node:fs')
  mkdirSync(process.env.HOME + '/Pictures/zhijuan', { recursive: true })
  const hhmm = new Date().toTimeString().slice(0, 5).replace(':', '')
  const file = process.env.HOME + `/Pictures/zhijuan/slice-kept-${hhmm}.png`
  writeFileSync(file, Buffer.from(shot.data, 'base64'))
  console.log('📸 截图已存', file)
} catch (e) { console.log('截图失败（不阻塞）：', String(e)) }
const p3 = await ev(`(async () => {
  const ps = await window.zhijuan.listProposals('demo-aseya')
  return { total: ps.length, pending: ps.filter((p) => p.status === 'pending').length, stale: ps.filter((p) => p.status === 'stale').length }
})()`)
ok(p3.total === 1 && p3.pending === 1 && p3.stale === 0, `再次保存后原卡仍在 pending、零 stale 零新建（${JSON.stringify(p3)}）`)

// ===== K4. devShim createSliceProposals 同款 → kept=1/created=0（同口径） =====
const k4 = await ev(`(async () => {
  const it = { target: '人物/沈藏.md', anchor: '切片：雾港夜', kind: 'upsert-section', before: '', after: '## 切片：雾港夜\\n\\n（演示）沈藏开始密切来往：雾港夜场散后总在栈桥口等阿七。', reason: '（演示）固定动向：沈藏行为变化' }
  return await window.zhijuan.createSliceProposals('demo-aseya', '正文/第01章_雾港.md', '雾港夜', [it])
})()`)
ok(Array.isArray(k4.created) && k4.created.length === 0 && k4.kept === 1 && k4.suppressed === 0, `同款再建 kept=1/created=0/suppressed=0（${JSON.stringify(k4)}）`)

// ===== K5. after 微差（真变化）→ 不误判 =====
const k5 = await ev(`(async () => {
  const it = { target: '人物/沈藏.md', anchor: '切片：雾港夜', kind: 'upsert-section', before: '', after: '## 切片：雾港夜\\n\\n（演示）沈藏开始密切来往的第二天。', reason: '（演示）第二天动向' }
  return await window.zhijuan.createSliceProposals('demo-aseya', '正文/第01章_雾港.md', '雾港夜', [it])
})()`)
ok(Array.isArray(k5.created) && k5.created.length === 1 && k5.kept === 0, `after 真变化不误判（created=1/kept=0）`)

// ===== 收尾 =====
ok(errors.length === 0, `零 JS 异常（${errors.length}：${errors.slice(0, 3).join(' | ')}）`)
try { await fetch('http://127.0.0.1:9224/json/close/' + page.id) } catch { /* 忽略 */ }
clearTimeout(watchdog)
console.log(`\nSLICE-KEPT UI SMOKE ${fail === 0 ? 'PASS' : 'FAIL'} (${pass} pass, ${fail} fail)`)
process.exit(fail === 0 ? 0 : 1)
