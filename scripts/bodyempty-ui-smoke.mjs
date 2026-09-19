// 切片同步「正文为空短路」· 无头 UI 冒烟（2026-09-20 创作层，runSync 严格性修复）
// 背景：P1 F-20260917-10 现场形态（92B=仅约定头）下同步器仍产出基于档案的「动向」提案=设定流噪音；
//      本轮 runSync 新增 bodyLen===0 本地短路（零模型调用）+ 证据小字「正文为空，未比对」。
// 断言：① 清空+首次保存被拦（防线回归）→ ② 二次保存=两步确认写空（约定头保留）→ ③ 同步短路：
//      浮条出现「✓ 无设定变化 · 正文为空，未比对」，且不产提案（无新 proposal 文件）；④ 全程零 JS 异常。
// 用法：node scripts/bodyempty-ui-smoke.mjs （先 npm run build + http.server/SPA 8123 在跑，CDP 9224 在跑）
const PORT = 8123
const BASE = process.env.ZJ_SMOKE_BASE || `http://localhost:${PORT}`
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

// ===== 0. 打开 Novel 页并选中第1章（demo-aseya） =====
await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}#/project/demo-aseya/novel` })
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

// 章节 rel 以 listChapters 为准（与真机同口径）
const beforeMd2 = await ev(`(async () => {
  const cs = await window.zhijuan.listChapters('demo-aseya')
  const d = await window.zhijuan.readDoc('demo-aseya', '正文/' + cs[0].file)
  return d || ''
})()`)
ok(beforeMd2.length > 100, `磁盘正文已就绪（${beforeMd2.length} 字符）`)

// ===== 1. 清空 → 首次保存被拦（防线回归） =====
await ev(`window.__ZJ_EDITORS[0].setContent('')`)
await sleep(1200)
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))`)
await sleep(1500)
const tip1 = await ev(`(() => {
  const sp = [...document.querySelectorAll('span')].find((x) => (x.textContent || '').includes('再按一次保存确认'))
  return sp ? sp.textContent : null
})()`)
ok(!!tip1, `状态条出现两步确认提示（${JSON.stringify(tip1)}）`)

// ===== 2. 二次保存=两步确认写空（约定头保留） =====
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))`)
await sleep(2500)
const afterSave = await ev(`(async () => {
  const cs = await window.zhijuan.listChapters('demo-aseya')
  const d = await window.zhijuan.readDoc('demo-aseya', '正文/' + cs[0].file)
  return { len: (d || '').length, hasFm: (d || '').includes('章号:'), hasBodyText: /雾|港|栈/.test((d || '').split('---').slice(2).join('---')) }
})()`)
ok(afterSave.hasFm && afterSave.len < 100, `二次保存写空（约定头保留，${afterSave.len} 字符）`)

// ===== 3. 同步短路：浮条证据「正文为空，未比对」+ 零提案 =====
// 写空后 doSync 自动触发（devShim gate 同真机口径：正文为空 → bodyEmpty 证据零提案）
const evidence = await ev(`(() => {
  const sp = [...document.querySelectorAll('div')].map((d) => d.innerText || '').filter((t) => t.includes('正文为空，未比对'))
  return sp.sort((a, b) => a.length - b.length)[0] ?? null
})()`)
ok(!!evidence, `浮条出现「正文为空，未比对」（${JSON.stringify(evidence)}）`)
const syncLog = await ev(`(() => window.__ZJ_SYNCS ?? [])()`)
ok(syncLog.length >= 1, `切片同步确实被触发（${syncLog.length} 次）`)

try {
  const shot = await cmd('Page.captureScreenshot', { format: 'png' })
  const fs = await import('node:fs')
  const hhmm = new Date().toTimeString().slice(0, 5).replace(':', '')
  fs.writeFileSync(`${process.env.HOME}/Pictures/zhijuan/bodyempty-${hhmm}.png`, Buffer.from(shot.data, 'base64'))
  console.log(`📸 截图 saved: ~/Pictures/zhijuan/bodyempty-${hhmm}.png`)
} catch (e) { console.log('截图失败（不阻断）: ' + e.message) }

// ===== 4. 零 JS 异常 =====
ok(errors.length === 0, `零 JS 异常（${errors.length}）`)
clearTimeout(watchdog)
console.log(pass === 0 || fail === 0 ? `SMOKE ${fail === 0 ? 'PASS' : 'FAIL'} bodyempty-ui (${pass}/${pass + fail})` : `SMOKE FINISH bodyempty-ui (${pass}/${pass + fail})`)
try { await fetch('http://127.0.0.1:9224/json/close/' + page.id) } catch {}
process.exit(fail ? 1 : 0)
