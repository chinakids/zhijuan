// 保存防线「空编辑器不落盘」· 无头 UI 冒烟（2026-09-19 智能层，F-20260917-10 P1）
// 背景：织卷smoke 第01章 2026-09-19 09:30 被写成「仅约定头」（92B）。代码走查结论=
//      能产出该形态的渲染层调用只有 DocEditor.doSave 且 getMarkdown() 为空，而
//      Cmd+S/菜单保存不检查 dirty（空态也写盘）。本次落地防线：md==='' 且磁盘正文非空 → 拒绝写盘+提示。
// 断言：① 编辑器被清空后按 Cmd+S → 磁盘正文仍完整（未写空）且状态条出现拦截提示；
//       ② 正常编辑（非空）保存仍可写盘（防线不误伤）；③ 全程零 JS 异常。
// 用法：node scripts/save-guard-ui-smoke.mjs （先 npm run build + node scripts/serve-renderer.mjs 8123，CDP 9224 在跑）
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

// ===== 0. 打开 Novel 页并选中第1章 =====
await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}#/project/demo-aseya/novel` })
await sleep(3000)
const clicked = await ev(`(() => {
  const btn = [...document.querySelectorAll('aside button')].find((b) => (b.innerText || '').includes('第1章') && (b.innerText || '').includes('雾港'))
  if (!btn) return false
  btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  btn.click()
  return true
})()`)
ok(!!clicked, '点击了第1章（雾港）')
await sleep(2500)
const hasEditor = await ev(`!!(window.__ZJ_EDITORS && window.__ZJ_EDITORS.length)`)
ok(!!hasEditor, '编辑器实例已挂载')

const REL = '正文/第01章_雾港栈桥.md'  // demo-aseya 章文件：以 readDoc 为准探测
const beforeMd = await ev(`(async () => {
  const d = await window.zhijuan.readDoc('demo-aseya', '正文/第01章_雾港.md')
  return d || ''
})()`)
ok(beforeMd.length > 100 && beforeMd.includes('港口'), `磁盘正文已就绪（${beforeMd.length} 字符）`)

// ===== 1. 模拟「编辑器被清空」→ Cmd+S 不应写空 =====
await ev(`window.__ZJ_EDITORS[0].setContent('')`)
await sleep(1200)
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))`)
await sleep(1500)
const afterMd = await ev(`(async () => {
  const d = await window.zhijuan.readDoc('demo-aseya', '正文/第01章_雾港.md')
  return d || ''
})()`)
ok(afterMd === beforeMd, `清空+保存未写盘（磁盘仍 ${afterMd.length} 字符，拦截生效）`)
const tip = await ev(`(() => {
  const sp = [...document.querySelectorAll('span')].find((x) => (x.textContent || '').includes('正文疑似为空'))
  return sp ? sp.textContent : null
})()`)
ok(!!tip, `状态条出现拦截提示（${JSON.stringify(tip)}）`)
try {
  const shot = await cmd('Page.captureScreenshot', { format: 'png' })
  const fs = await import('node:fs')
  const hhmm = new Date().toTimeString().slice(0, 5).replace(':', '')
  fs.writeFileSync(`${process.env.HOME}/Pictures/zhijuan/save-guard-${hhmm}.png`, Buffer.from(shot.data, 'base64'))
  console.log(`📸 截图 saved: ~/Pictures/zhijuan/save-guard-${hhmm}.png`)
} catch (e) { console.log('截图失败（不阻断）: ' + e.message) }

// ===== 2. 正常编辑保存仍可用（防线不误伤） =====
const edited = await ev(`(() => {
  const md0 = window.__ZJ_EDITORS[0]
  md0.setContent('测试正文：雾重新浓了起来。\\n\\n新的一段。')
  return true
})()`)
await sleep(1200)
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))`)
await sleep(1500)
const savedMd = await ev(`(async () => {
  const d = await window.zhijuan.readDoc('demo-aseya', '正文/第01章_雾港.md')
  return d || ''
})()`)
ok(savedMd.includes('测试正文：雾重新浓了起来'), '正常编辑保存仍写盘（防线零误伤）')
ok(!(savedMd.includes('正文疑似为空')), '拦截提示未残留状态')

// ===== 3.（创作层 2026-09-19 扩展）作者确要清空：第一次保存被拦 → 再按一次保存=两步确认放行 =====
await ev(`window.__ZJ_EDITORS[0].setContent('')`)
await sleep(1200)
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))`)
await sleep(1500)
const midMd = await ev(`(async () => {
  const d = await window.zhijuan.readDoc('demo-aseya', '正文/第01章_雾港.md')
  return d || ''
})()`)
ok(midMd.includes('测试正文：雾重新浓了起来'), '清空首次保存仍被拦（磁盘未变）')
const tip2 = await ev(`(() => {
  const sp = [...document.querySelectorAll('span')].find((x) => (x.textContent || '').includes('再按一次保存确认'))
  return sp ? sp.textContent : null
})()`)
ok(!!tip2, `拦截提示含「再按一次保存确认」步骤指引（${JSON.stringify(tip2)}）`)
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))`)
await sleep(1500)
const emptiedMd = await ev(`(async () => {
  const d = await window.zhijuan.readDoc('demo-aseya', '正文/第01章_雾港.md')
  return d || ''
})()`)
ok(emptiedMd.includes('章号') && !emptiedMd.includes('测试正文'), `确认后写空生效（约定头保留、正文体为空，${emptiedMd.length} 字符）`)

// ===== 4. 恢复内容后再次清空仍会被拦一次（confirmEmpty 不残留误放行） =====
await ev(`window.__ZJ_EDITORS[0].setContent('恢复正文：灯塔亮起。')`)
await sleep(1200)
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))`)
await sleep(1500)
await ev(`window.__ZJ_EDITORS[0].setContent('')`)
await sleep(1200)
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))`)
await sleep(1500)
const guard2 = await ev(`(async () => {
  const d = await window.zhijuan.readDoc('demo-aseya', '正文/第01章_雾港.md')
  return d || ''
})()`)
ok(guard2.includes('恢复正文：灯塔亮起'), '恢复内容→再清空→首次保存仍被拦（无确认残留）')
// 确认放行并恢复现场（demo-aseya 为内存 mock，收回为后续冒烟留可读态）
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))`)
await sleep(1500)
await ev(`window.__ZJ_EDITORS[0].setContent('测试正文：雾重新浓了起来。\\n\\n新的一段。')`)
await sleep(1200)
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))`)
await sleep(1500)
const restored = await ev(`(async () => {
  const d = await window.zhijuan.readDoc('demo-aseya', '正文/第01章_雾港.md')
  return d || ''
})()`)
ok(restored.includes('测试正文：雾重新浓了起来'), '现场已恢复（正文可再读可再保存）')
try {
  const shot2 = await cmd('Page.captureScreenshot', { format: 'png' })
  const fs2 = await import('node:fs')
  const hhmm2 = new Date().toTimeString().slice(0, 5).replace(':', '')
  fs2.writeFileSync(`${process.env.HOME}/Pictures/zhijuan/save-guard-confirm-${hhmm2}.png`, Buffer.from(shot2.data, 'base64'))
  console.log(`📸 截图 saved: ~/Pictures/zhijuan/save-guard-confirm-${hhmm2}.png`)
} catch (e) { console.log('截图失败（不阻断）: ' + e.message) }

// ===== 5.（2026-09-19 创作层扩展，P1 F-20260917-10）渲染层取证点 save-trace 留痕 =====
const trace = await ev(`(() => {
  const t = (window.__ZJ_SAVETRACE || []).map((x) => x.action + '|' + x.mdLen + '|' + x.status + '|' + x.confirmEmpty)
  return t
})()`)
ok(trace.some((x) => x.startsWith('blocked|0|')), `取证点记录 blocked（空写拦截留痕）`)
ok(trace.some((x) => x.startsWith('allow-empty|0|')), `取证点记录 allow-empty（两步确认写空放行留痕）`)
ok(trace.some((x) => x.startsWith('write|') && !x.startsWith('write-empty') && !x.startsWith('write|0|')), `取证点记录 write（正常写盘留痕）`)
const full = await ev(`(() => {
  const t = window.__ZJ_SAVETRACE || []
  const w = t.find((x) => x.action === 'write')
  return w ? { mdLen: w.mdLen, status: w.status, epoch: w.epoch, diskBodyLen: w.diskBodyLen, confirmEmpty: w.confirmEmpty, rel: w.rel, time: w.time } : null
})()`)
ok(
  !!full && typeof full.mdLen === 'number' && typeof full.status === 'string' && typeof full.epoch === 'number' &&
    typeof full.diskBodyLen === 'number' && typeof full.confirmEmpty === 'boolean' &&
    typeof full.time === 'number' && full.rel.includes('正文/'),
  `取证字段完整（mdLen/status/epoch/diskBodyLen/confirmEmpty/time/rel）`
)

// ===== 6. 零 JS 异常 =====
ok(errors.length === 0, `全程零 JS 异常（${errors.length}）`)

console.log(`\nRESULT: ${pass} passed, ${fail} failed, errors=${errors.length}`)
clearTimeout(watchdog)
try { await fetch('http://127.0.0.1:9224/json/close/' + page.id) } catch { /* 关闭失败不碍事 */ }
if (fail > 0) process.exit(1)
