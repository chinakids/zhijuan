// 关窗未保存守卫 · 无头 UI 冒烟（2026-09-24 创作层）
// 背景：正文有未保存改动时关闭窗口/重载/退出=内容静默丢失（此前无任何防线；切章守卫 a8c7636 同族但动作不同）。
//       本轮落地 renderer beforeunload 拦截（Electron 官方：handler 返回非 undefined 值静默取消关闭，
//       覆盖窗口关闭/Cmd+W/重载/app quit 链）+ 三选确认（取消/不保存关闭/保存并关闭）。
// 断言：A① dirty 关窗弹守卫框（三按钮）且 returnValue=true（Electron 会取消关闭）
//       A② 取消=框关/不关闭/内容未动（仍未保存） B① 不保存关闭=关闭且磁盘未污染
//       C① 保存并关闭=落盘后关闭（磁盘含内容） D① 非 dirty 关窗零打扰
//       D② 全程零 JS 异常
// 用法：node scripts/close-guard-ui-smoke.mjs （先 npm run build + node scripts/serve-renderer.mjs 8123，CDP 9224 在跑）
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
// 合成 beforeunload 事件（listener 与真实 Electron 同路径）；返回 defaultPrevented
// （合成 Event.returnValue 标准初始值即 true，非「拦截」信号——断言用 defaultPrevented 可靠）
const fireBeforeUnload = `(() => {
  const e = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(e)
  return e.defaultPrevented
})()`
const clickText = (t) => `(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === '${t}')
  if (b) { b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' })); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' })); b.click() }
  return !!b
})()`

// ===== 0. 打开 Novel 页并选中第1章，stub window.close（无头环境无真实窗口） =====
await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}#/project/demo-aseya/novel` })
await sleep(3000)
ok(await ev(clickChapter('第1章')), '点击第1章（雾港）')
ok(await waitEditor('雾港'), '第1章编辑器已挂载')
await ev(`window.__CLOSE_CALLS = 0; window.close = () => { window.__CLOSE_CALLS++ }`)

// ===== A. dirty 关窗 → 守卫框 + 取消 =====
await ev(`window.__ZJ_EDITORS[0].applyMarkdown('关窗A1：风向偏了。', false)`)
await sleep(800)
ok(await bodyHas('未保存'), 'A① 编辑后出现「未保存」')
ok(await ev(fireBeforeUnload) === true, 'A① dirty 关窗被拦截（returnValue=true=Electron 取消关闭）')
await sleep(900)
ok(await bodyHas('有未保存的改动'), 'A① 弹出关窗守卫确认框')
ok(
  await ev(`['取消','不保存关闭','保存并关闭'].every((t) => document.body.innerText.includes(t))`),
  'A① 确认框含三选项（取消/不保存关闭/保存并关闭）'
)
// 截图：关窗守卫确认框
try {
  const shot = await cmd('Page.captureScreenshot', { format: 'png' })
  const fs = await import('node:fs')
  const hhmm = new Date().toTimeString().slice(0, 5).replace(':', '')
  fs.writeFileSync(`${process.env.HOME}/Pictures/zhijuan/close-guard-${hhmm}.png`, Buffer.from(shot.data, 'base64'))
  console.log(`📸 截图 saved: ~/Pictures/zhijuan/close-guard-${hhmm}.png`)
} catch (e) { console.log('截图失败（不阻断）: ' + e.message) }
ok(await ev(clickText('取消')), 'A② 点击取消')
await sleep(900)
ok(!(await bodyHas('有未保存的改动')), 'A② 取消=确认框关闭')
ok((await ev(`window.__CLOSE_CALLS`)) === 0, 'A② 未调用 window.close（窗口未关）')
ok((await ev(`window.__ZJ_EDITORS?.[0]?.getMarkdown?.() ?? ''`)).includes('关窗A1'), 'A② 内容未动（仍未保存）')

// ===== B. dirty → 不保存关闭 =====
ok(await ev(fireBeforeUnload) === true, 'B① 再次关窗被拦截')
await sleep(900)
ok(await bodyHas('有未保存的改动'), 'B① 再次弹出守卫框')
ok(await ev(clickText('不保存关闭')), 'B① 点击不保存关闭')
await sleep(900)
ok((await ev(`window.__CLOSE_CALLS`)) === 1, 'B① 调用了 window.close（窗口关闭）')
ok(!(await diskHas('正文/第01章_雾港.md', '关窗A1')), 'B② 磁盘未污染（丢弃未写盘）')

// B 后重建：真实「不保存关闭」=窗口已关；无头 stub 不销毁页面，重新导航模拟（closingRef 放行标记随之清零）
await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}#/project/demo-aseya/novel` })
await sleep(3000)
ok(await ev(clickChapter('第1章')), 'C① 重建后点击第1章（雾港）')
ok(await waitEditor('雾港'), 'C① 重建后编辑器已挂载')
await ev(`window.__CLOSE_CALLS = 0; window.close = () => { window.__CLOSE_CALLS++ }`)

// ===== C. dirty → 保存并关闭（真落盘后关闭） =====
await ev(`window.__ZJ_EDITORS[0].applyMarkdown('关窗C1：锚链收紧。', false)`)
await sleep(800)
ok(await ev(fireBeforeUnload) === true, 'C① 编辑后关窗被拦截（defaultPrevented）')
await sleep(900)
ok(await bodyHas('有未保存的改动'), 'C① 弹出守卫框')
ok(await ev(clickText('保存并关闭')), 'C① 点击保存并关闭')
await sleep(1800)
ok((await ev(`window.__CLOSE_CALLS`)) === 1, 'C① 保存成功后调用了 window.close')
ok(await diskHas('正文/第01章_雾港.md', '关窗C1'), 'C① 内容已落盘（保存并关闭=先保存再关）')

// C 后重建：保存并关闭=窗口已关；重建清零 closingRef，验证非 dirty 零打扰路径
await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}#/project/demo-aseya/novel` })
await sleep(3000)
ok(await ev(clickChapter('第1章')), 'D① 重建后点击第1章（已保存=非 dirty）')
await waitEditor('雾港')
await ev(`window.__CLOSE_CALLS = 0; window.close = () => { window.__CLOSE_CALLS++ }`)

// ===== D. 非 dirty 关窗零打扰 =====
await sleep(600)
ok(await ev(fireBeforeUnload) === false, 'D① 非 dirty 关窗零拦截（defaultPrevented=false）')
await sleep(600)
ok(!(await bodyHas('有未保存的改动')), 'D① 非 dirty 关窗零弹窗')
ok((await ev(`window.__CLOSE_CALLS`)) === 0, 'D① 未新增 window.close 调用')

// ===== D② 全程零 JS 异常 =====
ok(errors.length === 0, 'D② 全程无 JS 异常/console.error' + (errors.length ? `（${errors.slice(0, 3).join(' | ')}）` : ''))

clearTimeout(watchdog)
console.log(`---\n${pass}/${pass + fail} PASS${fail ? ' — FAIL!' : ''}`)
process.exit(fail ? 1 : 0)
