// 文档读取 null（不存在/不可读）不静默当空文档 · 无头 UI 冒烟（2026-09-19 智能层，P1 F-20260917-10 代码走查落地）
// 背景：DocEditor 加载 effect 旧代码 `readDoc(...) ?? ''` 把 null（真机 readDoc 不存在/不可读返回 null）
//      静默当空文档 → 编辑器空白（占位「开始写作…」）→ 保存即覆盖整篇为空（P1「保存→清空」疑点机理②）。
//      本轮改为 null → 「读取文档失败」卡 + 重试（与 eac71e8 states 体系同口径）。
// 断言：① null 注入下 Novel 选中章出现「读取文档失败」错误卡；② 编辑器未挂载（无 .ProseMirror/无空占位）=
//      不再静默显示空文档；③ 错误卡含「重试」按钮；④ 对照 tab（无注入）编辑器正常挂载（隔离证明注入生效）。
// 用法：node scripts/null-read-ui-smoke.mjs （先 npm run build + node scripts/serve-renderer.mjs 8123，CDP 9224 在跑）
const PORT = 8123
const BASE = process.env.ZJ_SMOKE_BASE || `http://localhost:${PORT}`
const NULL_Q = encodeURIComponent('readDoc:正文/第01章_雾港.md')
const page = await (await fetch('http://127.0.0.1:9224/json/new?' + encodeURIComponent(`${BASE}/?cb=${Date.now()}`), { method: 'PUT' })).json()
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
const clickChapter = `(() => {
  const btn = [...document.querySelectorAll('aside button')].find((b) => (b.innerText || '').includes('第1章') && (b.innerText || '').includes('雾港'))
  if (!btn) return false
  btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  btn.click()
  return true
})()`

// ===== Tab A：zj-null 注入 —— null 应显式报错而非静默空文档 =====
await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}&zj-null=${NULL_Q}#/project/demo-aseya/novel` })
await sleep(3200)
ok(await ev(clickChapter), 'TabA 点击了第1章（雾港）')
await sleep(2500)
const errCard = await ev(`(() => {
  const el = [...document.querySelectorAll('p,span,div')].find((x) => (x.textContent || '').includes('读取文档失败'))
  return el ? el.textContent : null
})()`)
ok(!!errCard, `TabA 出现「读取文档失败」错误卡（${JSON.stringify(errCard)}）`)
ok(await ev(`document.querySelectorAll('.ProseMirror').length === 0`), 'TabA 无 .ProseMirror（未挂载空编辑器）')
ok(await ev(`!(window.__ZJ_EDITORS && window.__ZJ_EDITORS.length)`), 'TabA 编辑器实例未创建')
ok(await ev(`!(document.body.innerText || '').includes('开始写作')`), 'TabA 无「开始写作」空占位')
const retryBtn = await ev(`(() => {
  const btns = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '重试')
  return !!btns
})()`)
ok(retryBtn, 'TabA 错误卡含「重试」按钮')
try {
  const shot = await cmd('Page.captureScreenshot', { format: 'png' })
  const fs = await import('node:fs')
  const hhmm = new Date().toTimeString().slice(0, 5).replace(':', '')
  fs.writeFileSync(`${process.env.HOME}/Pictures/zhijuan/null-read-${hhmm}.png`, Buffer.from(shot.data, 'base64'))
  console.log(`📸 截图 saved: ~/Pictures/zhijuan/null-read-${hhmm}.png`)
} catch (e) { console.log('截图失败（不阻断）: ' + e.message) }

// ===== Tab B：对照（无注入）—— 同一章编辑器正常挂载 =====
const pageB = await (await fetch('http://127.0.0.1:9224/json/new?' + encodeURIComponent(`${BASE}/?cb=${Date.now()}B`), { method: 'PUT' })).json()
const wsB = new WebSocket(pageB.webSocketDebuggerUrl)
let seqB = 0
const pendingB = new Map()
wsB.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pendingB.has(m.id)) { pendingB.get(m.id)(m); pendingB.delete(m.id) }
}
function cmdB(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++seqB
    const to = setTimeout(() => { pendingB.delete(id); rej(new Error(`CDP TIMEOUT: ${method}`)) }, 8000)
    pendingB.set(id, (m) => { clearTimeout(to); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) })
    wsB.send(JSON.stringify({ id, method, params }))
  })
}
const evB = async (expression) => {
  const r = await cmdB('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
  return r.result?.value
}
await new Promise((r) => (wsB.onopen = r))
await cmdB('Runtime.enable')
await cmdB('Page.navigate', { url: `${BASE}/?cb=${Date.now()}B#/project/demo-aseya/novel` })
await sleep(3200)
ok(await evB(clickChapter), 'TabB 点击了第1章（雾港）')
await sleep(2500)
ok(await evB(`!!(window.__ZJ_EDITORS && window.__ZJ_EDITORS.length)`), 'TabB 编辑器正常挂载（对照隔离证明）')
ok(await evB(`document.querySelectorAll('.ProseMirror').length > 0`), 'TabB 出现 .ProseMirror')

ok(errors.length === 0, `全程零 JS 异常（${errors.length ? errors.slice(0, 3).join('; ') : '无'}）`)
console.log(`\nRESULT: ${pass} pass / ${fail} fail`)
clearTimeout(watchdog)
process.exit(fail > 0 ? 1 : 0)
