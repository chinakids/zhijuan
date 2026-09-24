// 路由级离开守卫 · 无头 UI 冒烟（2026-09-24 创作层）
// 背景：正文有未保存改动时经侧栏/⌘K/系统菜单/回首页/切项目离开正文页=内容静默丢失
//       （切章守卫只管章与章之间、关窗守卫只管 beforeunload；路由切换 Novel 卸载=丢稿）。
//       本轮落地 useBlocker（createHashRouter data router）+ 三选确认（不保存离开/保存并离开/取消）。
// 断言：A① dirty 切页弹确认（三按钮）A② 取消=留在本页 A③ 保存并离开=真落盘且已切页
//       B① 不保存离开=丢弃且已切页 B② 目标页磁盘未污染
//       C① 非 dirty 切页零弹窗直切 D① 引擎徽章（Router 外 router.navigate）同样被拦
//       E①-④ ⌘K 命令面板导航（Router 内 useNavigate）dirty 被拦 / 非 dirty 放行
//       F① 全程零 JS 异常
// 用法：node scripts/route-guard-ui-smoke.mjs （先 npm run build + node scripts/serve-renderer.mjs 8123，CDP 9224 在跑）
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
const clickChapter = (titlePart) => `(() => {
  const el = [...document.querySelectorAll('[title]')].find((e) => (e.getAttribute('title') || '').includes('${titlePart}'))
  const btn = el ? (el.closest('button') || el) : null
  if (!btn) return false
  btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  btn.click()
  return true
})()`
// 侧栏导航项：NavLink（a 标签）文本匹配
const clickNav = (label) => `(() => {
  const a = [...document.querySelectorAll('a')].find((x) => (x.textContent || '').includes('${label}'))
  if (!a) return false
  a.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  a.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  a.click()
  return true
})()`
const clickButton = (text) => `(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === '${text}')
  if (!b) return false
  b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  b.click()
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
const hashHas = (part) => ev(`window.location.hash.includes('${part}')`)

// ===== 0. 打开 Novel 页并选中第1章（createHashRouter 页面挂载零回归基线）=====
await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}#/project/demo-aseya/novel` })
await sleep(3000)
ok(await ev(clickChapter('第1章')), '0 点击第1章（雾港）')
ok(await waitEditor('雾港'), '0 第1章编辑器已挂载（data router 页面正常）')

// ===== A. dirty 切页 → 确认框 → 取消/保存并离开 =====
await ev(`window.__ZJ_EDITORS[0].applyMarkdown('守卫R1：雾更浓了。', false)`)
await sleep(800)
ok(await bodyHas('未保存'), 'A① 编辑后出现「未保存」')
ok(await ev(clickNav('人物设定')), 'A① 点击侧栏「人物设定」')
await sleep(900)
ok(await bodyHas('有未保存的改动'), 'A① 路由离开弹出守卫确认框')
ok(
  await ev(`['取消','不保存离开','保存并离开'].every((t) => document.body.innerText.includes(t))`),
  'A① 确认框含三选项（取消/不保存离开/保存并离开）'
)
try {
  const shot = await cmd('Page.captureScreenshot', { format: 'png' })
  const fs = await import('node:fs')
  const hhmm = new Date().toTimeString().slice(0, 5).replace(':', '')
  fs.writeFileSync(`${process.env.HOME}/Pictures/zhijuan/route-guard-${hhmm}.png`, Buffer.from(shot.data, 'base64'))
  console.log(`📸 截图 saved: ~/Pictures/zhijuan/route-guard-${hhmm}.png`)
} catch (e) { console.log('截图失败（不阻断）: ' + e.message) }
ok(await ev(clickButton('取消')), 'A② 点击「取消」')
await sleep(900)
ok(!(await bodyHas('有未保存的改动')), 'A② 取消=确认框关闭')
ok(await hashHas('/novel'), 'A② 仍在正文页（URL 未变）')
ok((await ev(`window.__ZJ_EDITORS?.[0]?.getMarkdown?.() ?? ''`)).includes('守卫R1'), 'A② 留在本页（内容未动）')
ok(await bodyHas('未保存'), 'A② 仍处未保存态')

ok(await ev(clickNav('人物设定')), 'A③ 再次点击「人物设定」')
await sleep(900)
ok(await bodyHas('有未保存的改动'), 'A③ 再次弹出守卫确认框')
ok(await ev(clickButton('保存并离开')), 'A③ 点击「保存并离开」')
// 保存（落盘）→ proceed → 切到 characters
await sleep(1800)
ok(await hashHas('/characters'), 'A③ 已离开正文页（URL=characters）')
ok(await diskHas('正文/第01章_雾港.md', '守卫R1'), 'A③ 第1章已落盘（含未保存内容）')

// ===== B. 再 dirty → 不保存离开（丢弃）=====
ok(await ev(clickNav('正文创作')), 'B① 回到正文创作')
await sleep(1500)
ok(await ev(clickChapter('第1章')), 'B① 点击第1章')
ok(await waitEditor('守卫R1'), 'B① 编辑器=已保存版（含 R1）')
await ev(`window.__ZJ_EDITORS[0].applyMarkdown('守卫R2：浪更急了。', false)`)
await sleep(800)
ok(await bodyHas('未保存'), 'B① 编辑后出现「未保存」')
ok(await ev(clickNav('世界观设定')), 'B① 点击「世界观设定」')
await sleep(900)
ok(await bodyHas('有未保存的改动'), 'B① 弹出守卫确认框')
ok(await ev(clickButton('不保存离开')), 'B① 点击「不保存离开」')
await sleep(1500)
ok(await hashHas('/worldview'), 'B① 已切到世界观页')
ok(!(await diskHas('正文/第01章_雾港.md', '守卫R2')), 'B② 磁盘未污染（丢弃未写盘）')

// ===== C. 非 dirty 切页零弹窗 =====
ok(await ev(clickNav('正文创作')), 'C① 回到正文创作')
await sleep(1500)
ok(await ev(clickChapter('第1章')), 'C① 点击第1章（已保存=非 dirty）')
await sleep(1200)
ok(await ev(clickNav('大纲')), 'C① 点击「大纲」')
await sleep(1500)
ok(await hashHas('/outline'), 'C① 直切成功（URL=outline）')
ok(!(await bodyHas('有未保存的改动')), 'C① 零弹窗（非 dirty 不打扰）')

// ===== D. 引擎徽章（Router 外 router.navigate 路径）也被拦 =====
ok(await ev(clickNav('正文创作')), 'D① 回到正文创作')
await sleep(1500)
ok(await ev(clickChapter('第1章')), 'D① 点击第1章')
await sleep(1000)
await ev(`window.__ZJ_EDITORS[0].applyMarkdown('守卫R3：窗外的钟敲了三下。', false)`)
await sleep(800)
ok(await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => ((x.getAttribute('title') || '') + ' ' + (x.textContent || '')).includes('引擎'))
  if (!b) return false
  b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  b.click()
  return true
})()`), 'D① 点击引擎徽章')
await sleep(900)
ok(await bodyHas('有未保存的改动'), 'D① 引擎徽章路径同样弹出确认（router.navigate 被拦）')
ok(await hashHas('/novel'), 'D① 仍在正文页（未切走）')
ok(await ev(clickButton('取消')), 'D① 取消')
await sleep(800)

// ===== E. ⌘K 命令面板导航（Router 内 useNavigate 路径）同样被拦 =====
// 实现面：CommandPalette 在 Router 内用 useNavigate = router.navigate，data router 下同受 useBlocker 保护（20dfd45 已归一）；
// 本段为 09:45 轮登记观察「⌘K 命令面板路由面未冒烟」收口——被拦与放行两态实证。
const openPalette = `(() => {
  const r = document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }))
  return true
})()`
const clickPaletteItem = (label) => `(() => {
  const el = [...document.querySelectorAll('[cmdk-item]')].find((x) => (x.textContent || '').includes('${label}'))
  if (!el) return false
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  el.click()
  return true
})()`
ok(await ev(openPalette), 'E① 打开 ⌘K 命令面板')
await sleep(700)
ok(
  await ev(`(() => { const r = document.querySelector('[cmdk-root]'); return !!(r && r.offsetParent !== null) })()`),
  'E① 命令面板已显示（cmdk-root 可见）'
)
ok(await ev(clickPaletteItem('人物设定')), 'E② 面板选择「人物设定」')
await sleep(900)
ok(await bodyHas('有未保存的改动'), 'E② ⌘K 导航同样弹出守卫确认框（被拦）')
ok(await hashHas('/novel'), 'E② 仍在正文页（未切走）')
ok(await ev(clickButton('取消')), 'E③ 取消')
await sleep(800)
ok(await hashHas('/novel'), 'E③ 仍在正文页（URL 未变）')

// E④ 非 dirty 时 ⌘K 直切零弹窗（放行态）
ok(
  await ev(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true })); return true })()`),
  'E④ Cmd+S 保存当前内容（清 dirty）'
)
await sleep(1800)
ok(await ev(openPalette), 'E④ 再次打开 ⌘K 命令面板')
await sleep(700)
ok(await ev(clickPaletteItem('大纲')), 'E④ 面板选择「大纲」')
await sleep(1500)
ok(await hashHas('/outline'), 'E④ 直切成功（URL=outline）')
ok(!(await bodyHas('有未保存的改动')), 'E④ 非 dirty 零弹窗（放行）')

ok(errors.length === 0, `F① 全程零 JS 异常（${errors.length}）`)
console.log(`RESULT: ${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
