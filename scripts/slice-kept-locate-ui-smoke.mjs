// 切片同步「同款待确认」浮条→「查看提案」直达定位 · 无头 UI 冒烟（2026-09-20 创作层，候选 3 可行动性）
// 背景：跨章同款聚合后（45f792b）作者在章 B 保存收到「同款 1 条待确认，未重复提案」但卡在章 A
//       ——提示存在、处置路径断裂；本轮浮条加「查看提案」按钮（kept>0 时），点击打开提案抽屉
//       并滚动+高亮定位该卡（keptIds 由 createSliceProposals 返回透传）。
// 断言：L1 保存→「已生成 1 条切片提案」（devShim ?zj-sync-items=1 注入固定同款动向）
//       L2 改正文再保存→浮条「同款 1 条待确认，未重复提案」+「查看提案」按钮出现
//       L3 devShim createSliceProposals 同款→kept=1/keptIds=[旧卡 id]（同口径透传）
//       L4 点击「查看提案」→ 提案抽屉打开（role=dialog「提案」+「待确认 1」）
//       L5 抽屉内 [data-pid=<旧卡id>] 存在且 data-focused="true"（定位命中）
//       L6 关闭抽屉→重开（普通打开）→ 无 data-focused（focusId 已清，零残留）
//       全程零 JS 异常。
// 用法：node scripts/slice-kept-locate-ui-smoke.mjs （先 npm run build + SPA 8123 在跑，CDP 9224 在跑）
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

// ===== L1. 保存 → 浮条「已生成 1 条切片提案」 =====
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))`)
await sleep(2500)
const f1 = await findFloat('已生成 1 条切片提案')
ok(!!f1, `浮条出现「已生成 1 条切片提案」（${JSON.stringify((f1 || '').slice(0, 60))}）`)

// ===== L2. 不处置→改正文再保存→「同款 1 条待确认」+「查看提案」按钮 =====
await ev(`window.__ZJ_EDITORS[0].setContent(window.__ZJ_EDITORS[0].getMarkdown().replace(/的/, '的。'))`)
await sleep(800)
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))`)
await sleep(2500)
const f2 = await findFloat('同款 1 条待确认，未重复提案')
ok(!!f2, `浮条出现「同款 1 条待确认，未重复提案」（${JSON.stringify((f2 || '').slice(0, 80))}）`)
const btn = await ev(`(() => {
  const b = document.querySelector('[data-testid="zj-goto-proposals"]')
  return b ? { text: b.innerText, visible: !!b.offsetParent } : null
})()`)
ok(!!btn && btn.text === '查看提案' && btn.visible, `「查看提案」按钮出现（${JSON.stringify(btn)}）`)

// 旧卡 id（浮条定位目标）
const pid = await ev(`(async () => {
  const ps = await window.zhijuan.listProposals('demo-aseya')
  return ps.find((p) => p.status === 'pending')?.id ?? null
})()`)
ok(!!pid, `取得 pending 旧卡 id（${pid}）`)

// ===== L3. devShim createSliceProposals 同款 → kept=1/keptIds=[旧卡 id]（同口径透传） =====
const k3 = await ev(`(async () => {
  const it = { target: '人物/沈藏.md', anchor: '切片：雾港夜', kind: 'upsert-section', before: '', after: '## 切片：雾港夜\\n\\n（演示）沈藏开始密切来往：雾港夜场散后总在栈桥口等阿七。', reason: '（演示）固定动向：沈藏行为变化' }
  const r = await window.zhijuan.createSliceProposals('demo-aseya', '正文/第01章_雾港.md', '雾港夜', [it])
  return { kept: r.kept, keptIds: r.keptIds, created: r.created.length }
})()`)
ok(Array.isArray(k3.keptIds) && k3.keptIds.length === 1 && k3.keptIds[0] === pid && k3.kept === 1 && k3.created === 0, `同款再建 kept=1/keptIds=[旧卡 id]/created=0（${JSON.stringify(k3)}）`)

// ===== L4/L5. 点击「查看提案」→ 抽屉打开 + 定位命中 =====
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
const pendText = await ev(`(() => {
  const d = document.querySelector('[role="dialog"][aria-label="提案"]')
  return d ? (d.innerText || '') : ''
})()`)
ok(pendText.includes('待确认 1'), `抽屉待确认计数=1（${JSON.stringify(pendText.slice(0, 40))}）`)
// 截图留档（抽屉+定位高亮实态）
try {
  const shot = await cmd('Page.captureScreenshot', { format: 'png' })
  const { writeFileSync, mkdirSync } = await import('node:fs')
  mkdirSync(process.env.HOME + '/Pictures/zhijuan', { recursive: true })
  const hhmm = new Date().toTimeString().slice(0, 5).replace(':', '')
  const file = process.env.HOME + `/Pictures/zhijuan/slice-kept-locate-${hhmm}.png`
  writeFileSync(file, Buffer.from(shot.data, 'base64'))
  console.log('📸 截图已存', file)
} catch (e) { console.log('截图失败（不阻塞）：', String(e)) }

// ===== L6. 关闭抽屉→左导航普通打开→无 data-focused（focusId 已清零残留） =====
await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').includes('收起')); if (!b) return false; b.click(); return true })()`)
await sleep(800)
// SectionNav 底部「待确认提案」入口（左导航）
await ev(`(() => {
  const b = [...document.querySelectorAll('aside button, nav button')].find((x) => (x.innerText || '').includes('待确认提案'))
  if (!b) return false
  b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  b.click()
  return true
})()`)
await sleep(1000)
const noFocus = await ev(`(() => {
  const d = document.querySelector('[role="dialog"][aria-label="提案"]')
  if (!d) return null
  const card = d.querySelector('[data-pid="${pid}"]')
  return card ? card.getAttribute('data-focused') : 'no-card'
})()`)
ok(noFocus === null || noFocus === 'no-card', `普通打开（focusId 已清）：无 data-focused（${JSON.stringify(noFocus)}）`)

// ===== 收尾 =====
ok(errors.length === 0, `零 JS 异常（${errors.length}：${errors.slice(0, 3).join(' | ')}）`)
try { await fetch('http://127.0.0.1:9224/json/close/' + page.id) } catch { /* 忽略 */ }
clearTimeout(watchdog)
console.log(`\nSLICE-KEPT-LOCATE UI SMOKE ${fail === 0 ? 'PASS' : 'FAIL'} (${pass} pass, ${fail} fail)`)
process.exit(fail === 0 ? 0 : 1)
