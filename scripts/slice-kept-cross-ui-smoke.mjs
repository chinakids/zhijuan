// 切片同步「跨章同款」复用旧卡 · 无头 UI 冒烟（2026-09-20 创作层 15:45，候选 3 跨章聚合收口）
// 背景：作者在第1章收到同款 pending 但未处置（没接受没拒绝），又去写第2章——第2章续写同一
//       未落档事件时模型再产出同款「动向」。既有语义=第2章另建新卡（作者跨章重复处置同一补丁）；
//       本轮 unsettledSameOf 放宽为项目级收集，跨章同样复用旧卡（Tripl-i problem grouping 同构）。
// 断言：C1 第1章保存 →「已生成 1 条切片提案」（devShim ?zj-sync-items=1 注入固定同款动向）
//       C2 数据层：pending 1 条（chapter=第01章）
//       C3 切第2章（编辑器加载「灯塔」内容）
//       C4 第2章保存 → 浮条「同款 1 条待确认，未重复提案」（跨章复用，不另建卡）
//       C5 数据层：total 仍 1 / pending 1 / stale 0（无跨章新建、第1章卡未被置 stale）
//       C6 devShim createSliceProposals 以第2章为 chapter 直调同款 → kept=1/created=0（同口径）
//       C7 after 微差 → 不误判（created=1/kept=0）
//       全程零 JS 异常。
// 用法：node scripts/slice-kept-cross-ui-smoke.mjs （先 npm run build + SPA 8123 在跑，CDP 9224 在跑）
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
const clickChapter = async (txt) => ev(`(() => {
  const btn = [...document.querySelectorAll('aside button')].find((b) => (b.innerText || '').includes(${JSON.stringify(txt)}))
  if (!btn) return false
  btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  btn.click()
  return true
})()`)
const pressSave = () => ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))`)

// ===== 0. 打开 Novel 页并选中第1章 =====
await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}&zj-sync-items=1#/project/demo-aseya/novel` })
await sleep(3000)
ok(await clickChapter('第1章'), '点击了第1章')
await sleep(2500)
ok(await ev(`!!(window.__ZJ_EDITORS && window.__ZJ_EDITORS.length)`), '编辑器实例已挂载')

// ===== C1. 第1章保存 → 浮条「已生成 1 条切片提案」 =====
await pressSave()
await sleep(2500)
const f1 = await findFloat('已生成 1 条切片提案')
ok(!!f1, `保存出现「已生成 1 条切片提案」（${JSON.stringify((f1 || '').slice(0, 60))}）`)

// ===== C2. 数据层：pending 1 条（chapter=第01章） =====
const p2 = await ev(`(async () => {
  const ps = await window.zhijuan.listProposals('demo-aseya')
  return ps.map((p) => ({ id: p.id, status: p.status, chapter: p.chapter, target: p.items[0]?.target }))
})()`)
ok(p2.length === 1 && p2[0].status === 'pending' && p2[0].chapter.includes('第01章'), `第1章同步产出 1 条 pending（${JSON.stringify(p2[0])}）`)

// ===== C3. 切第2章（编辑器加载「灯塔」内容） =====
ok(await clickChapter('第2章'), '点击了第2章')
await sleep(2500)
const c3 = await ev(`(() => {
  const es = window.__ZJ_EDITORS || []
  return es.length ? es[es.length - 1].getMarkdown().includes('灯塔') : false
})()`)
ok(c3, '第2章编辑器已加载（内容含「灯塔」）')

// ===== C4. 第2章保存 → 跨章同款复用（浮条明示，不另建卡） =====
await pressSave()
await sleep(2500)
const f4 = await findFloat('同款 1 条待确认，未重复提案')
ok(!!f4, `第2章保存浮条出现「同款 1 条待确认，未重复提案」（${JSON.stringify((f4 || '').slice(0, 80))}）`)
// 截图留档（浮条 6s 自清，须在此步即截）
try {
  const shot = await cmd('Page.captureScreenshot', { format: 'png' })
  const { writeFileSync, mkdirSync } = await import('node:fs')
  mkdirSync(process.env.HOME + '/Pictures/zhijuan', { recursive: true })
  const hhmm = new Date().toTimeString().slice(0, 5).replace(':', '')
  const file = process.env.HOME + `/Pictures/zhijuan/slice-kept-cross-${hhmm}.png`
  writeFileSync(file, Buffer.from(shot.data, 'base64'))
  console.log('📸 截图已存', file)
} catch (e) { console.log('截图失败（不阻塞）：', String(e)) }

// ===== C5. 数据层：total 仍 1 / pending 1 / stale 0 =====
const p5 = await ev(`(async () => {
  const ps = await window.zhijuan.listProposals('demo-aseya')
  return { total: ps.length, pending: ps.filter((p) => p.status === 'pending').length, stale: ps.filter((p) => p.status === 'stale').length, chapter: ps[0]?.chapter }
})()`)
ok(p5.total === 1 && p5.pending === 1 && p5.stale === 0 && p5.chapter.includes('第01章'), `跨章保存后未新建、原卡仍 pending（${JSON.stringify(p5)}）`)

// ===== C6. devShim createSliceProposals 以第2章为 chapter 直调同款 → kept=1/created=0（同口径） =====
const c6 = await ev(`(async () => {
  const it = { target: '人物/沈藏.md', anchor: '切片：雾港夜', kind: 'upsert-section', before: '', after: '## 切片：雾港夜' + String.fromCharCode(10, 10) + '（演示）沈藏开始密切来往：雾港夜场散后总在栈桥口等阿七。', reason: '（演示）固定动向：沈藏行为变化' }
  return await window.zhijuan.createSliceProposals('demo-aseya', '正文/第02章_灯塔.md', '雾港夜', [it])
})()`)
ok(Array.isArray(c6.created) && c6.created.length === 0 && c6.kept === 1 && c6.suppressed === 0, `第2章chapter直调同款 kept=1/created=0/suppressed=0（${JSON.stringify(c6)}）`)

// ===== C7. after 微差（真变化）→ 不误判 =====
const c7 = await ev(`(async () => {
  const it = { target: '人物/沈藏.md', anchor: '切片：雾港夜', kind: 'upsert-section', before: '', after: '## 切片：雾港夜' + String.fromCharCode(10, 10) + '（演示）沈藏开始密切来往的第二天。', reason: '（演示）第二天动向' }
  return await window.zhijuan.createSliceProposals('demo-aseya', '正文/第02章_灯塔.md', '雾港夜', [it])
})()`)
ok(Array.isArray(c7.created) && c7.created.length === 1 && c7.kept === 0, `after 真变化不误判（created=1/kept=0）`)

// ===== 收尾 =====
ok(errors.length === 0, `零 JS 异常（${errors.length}：${errors.slice(0, 3).join(' | ')}）`)
try { await fetch('http://127.0.0.1:9224/json/close/' + page.id) } catch { /* 忽略 */ }
clearTimeout(watchdog)
console.log(`\nSLICE-KEPT-CROSS UI SMOKE ${fail === 0 ? 'PASS' : 'FAIL'} (${pass} pass, ${fail} fail)`)
process.exit(fail === 0 ? 0 : 1)
