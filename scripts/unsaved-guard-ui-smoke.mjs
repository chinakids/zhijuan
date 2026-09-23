// 切章未保存守卫 · 无头 UI 冒烟（2026-09-23 创作层）
// 背景：正文有未保存改动时点其他章节=内容静默丢失（Novel 章项 onClick 此前直接 setSel）。
//       本轮落地三选确认（保存并切换/不保存切换/取消），只在 dirty 时弹（NN/g 确认过频成路障）。
// 断言：A① dirty 切章弹确认（三按钮）A② 取消=留在本章 A③ 保存并切换=落盘且已切章
//       B① dirty 切章→不保存切换=丢弃且已切章 B② 目标章磁盘未污染
//       C① 非 dirty 切章零弹窗直切 C② 全程零 JS 异常
// 用法：node scripts/unsaved-guard-ui-smoke.mjs （先 npm run build + node scripts/serve-renderer.mjs 8123，CDP 9224 在跑）
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

// 章列按钮：title 形如「第N章 · 题名」（正文按钮），pointer 三连（Radix/React 事件需 pointer 序列）
// 注意：title 挂在行内 <p title=...> 上（Novel.tsx），须经 p 上溯 closest('button') 再触发。
const clickChapter = (titlePart) => `(() => {
  const el = [...document.querySelectorAll('[title]')].find((e) => (e.getAttribute('title') || '').includes('${titlePart}'))
  const btn = el ? (el.closest('button') || el) : null
  if (!btn) return false
  btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  btn.click()
  return true
})()`
const waitEditor = (textPart, timeout = 15000) => ev(`(async () => {
  const t0 = Date.now()
  while (Date.now() - t0 < ${timeout}) {
    const md = (window.__ZJ_EDITORS?.[0]?.getMarkdown?.() ?? '')
    if (md.includes(${JSON.stringify(textPart)})) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
})()`)
const diskHas = (rel, textPart) => ev(`(async () => {
  const d = (await window.zhijuan.readDoc('demo-aseya', '${rel}')) ?? ''
  return d.includes(${JSON.stringify(textPart)})
})()`)
const bodyHas = (t) => ev(`document.body.innerText.includes(${JSON.stringify(t)})`)

// ===== 0. 打开 Novel 页并选中第1章 =====
await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}#/project/demo-aseya/novel` })
await sleep(3000)
ok(await ev(clickChapter('第1章')), '点击第1章（雾港）')
const ready = await waitEditor('雾港')
ok(ready, '第1章编辑器已挂载')

// ===== A. dirty 切章 → 确认框 → 取消/保存并切换 =====
await ev(`window.__ZJ_EDITORS[0].applyMarkdown('守卫A1：雾更浓了。', false)`)
await sleep(800)
ok(await bodyHas('未保存'), 'A① 编辑后出现「未保存」')
ok(await ev(clickChapter('第2章')), 'A① 点击第2章')
await sleep(900)
ok(await bodyHas('有未保存的改动'), 'A① dirty 切章弹出守卫确认框')
ok(
  await ev(`['取消','不保存切换','保存并切换'].every((t) => document.body.innerText.includes(t))`),
  'A① 确认框含三选项（取消/不保存切换/保存并切换）'
)
// 截图：守卫确认框
try {
  const shot = await cmd('Page.captureScreenshot', { format: 'png' })
  const fs = await import('node:fs')
  const hhmm = new Date().toTimeString().slice(0, 5).replace(':', '')
  fs.writeFileSync(`${process.env.HOME}/Pictures/zhijuan/unsaved-guard-${hhmm}.png`, Buffer.from(shot.data, 'base64'))
  console.log(`📸 截图 saved: ~/Pictures/zhijuan/unsaved-guard-${hhmm}.png`)
} catch (e) { console.log('截图失败（不阻断）: ' + e.message) }
await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === '取消'); if (b) { b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' })); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' })); b.click() } return !!b })()`)
await sleep(900)
ok(!(await bodyHas('有未保存的改动')), 'A② 取消=确认框关闭')
ok((await ev(`window.__ZJ_EDITORS?.[0]?.getMarkdown?.() ?? ''`)).includes('守卫A1'), 'A② 留在本章（内容未动）')
ok(await bodyHas('未保存'), 'A② 仍处未保存态')

ok(await ev(clickChapter('第2章')), 'A③ 再次点击第2章')
await sleep(900)
ok(await bodyHas('有未保存的改动'), 'A③ 再次弹出守卫确认框')
await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === '保存并切换'); if (b) { b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' })); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' })); b.click() } return !!b })()`)
ok(await waitEditor('本章待写'), 'A③ 已切到第2章（编辑器=灯塔待写）')
ok(await diskHas('正文/第01章_雾港.md', '守卫A1'), 'A③ 第1章已落盘（含未保存内容）')

// ===== B. 第2章 dirty → 不保存切换 =====
await ev(`window.__ZJ_EDITORS[0].applyMarkdown('守卫B1：浪更急了。', false)`)
await sleep(800)
ok(await bodyHas('未保存'), 'B① 第2章编辑后出现「未保存」')
ok(await ev(clickChapter('第1章')), 'B① 点击第1章')
await sleep(900)
ok(await bodyHas('有未保存的改动'), 'B① 弹出守卫确认框')
await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === '不保存切换'); if (b) { b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' })); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' })); b.click() } return !!b })()`)
ok(await waitEditor('守卫A1'), 'B① 已切回第1章（内容=已保存版）')
ok(!(await diskHas('正文/第02章_灯塔.md', '守卫B1')), 'B② 第2章磁盘未污染（丢弃未写盘）')

// ===== C. 非 dirty 切章零弹窗 =====
ok(await ev(clickChapter('第2章')), 'C① 点击第2章（当前第1章已保存=非 dirty）')
await sleep(1200)
ok(await waitEditor('本章待写'), 'C① 直切成功（编辑器=第2章）')
ok(!(await bodyHas('有未保存的改动')), 'C① 零弹窗（非 dirty 不打扰）')

ok(errors.length === 0, `C② 全程零 JS 异常（${errors.length}）`)
console.log(`RESULT: ${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
