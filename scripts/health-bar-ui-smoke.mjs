// 规则体检状态栏 · 无头 UI 冒烟（F-20260916-05，2026-09-16 体验层）
// 断言：① 状态栏出现在编辑器下方；② devShim 演示项目存在已知问题（沈爷 alias 未列）→ issues 态（琥珀盾+处问题）；
//       ③ 点击状态钮打开 AuditDrawer（人物在场核查详情）；③.3 抽屉 Tab 栏含 缺段/切片/混用 且「让 agent 改」可点（F-20260916-05 迁移完整性，㉞）；
//       ④ 切「缺段」Tab 生效（标题=正文缺段核查）；⑤ 手动重跑可用。
// 用法：node scripts/health-bar-ui-smoke.mjs  （先 npm run build + node scripts/serve-renderer.mjs 8123，CDP 9224 在跑）
const PORT = 8123
const BASE = process.env.ZJ_SMOKE_BASE || `http://localhost:${PORT}`
const list = await (await fetch('http://127.0.0.1:9224/json')).json()
let page = list.find((t) => t.type === 'page' && new RegExp(`:${PORT}`).test(t.url) && /novel/.test(t.url))
if (!page) {
  // 兜底：宿主只需是 8123 页（脚本自会 Page.navigate 到 novel 路由）——全量 tab 治理后可能无合适页（2026-09-17 13:3x 实踩 NO NOVEL PAGE，同 icon-size/loading-indicator 22:30 兜底先例 ㉝）
  const any = list.find((t) => t.type === 'page' && new RegExp(`:${PORT}`).test(t.url))
  if (!any) {
    const r = await fetch('http://127.0.0.1:9224/json/new?' + encodeURIComponent(`${BASE}/?cb=${Date.now()}`), { method: 'PUT' })
    page = await r.json()
  } else {
    page = any
  }
}
if (!page) { console.error('NO NOVEL PAGE'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
function cmd(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++seq
    pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
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
let pass = 0, fail = 0
const ok = (cond, msg) => { console.log((cond ? '✅ ' : '❌ ') + msg); cond ? pass++ : fail++ }

await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}#/project/demo-aseya/novel` })
await sleep(3500)

// 选中第01章（状态栏只在有选中章时渲染）——直接点章节列表项
await ev(`(() => {
  const btn = [...document.querySelectorAll('aside button, [data-testid="chapter-sidebar"] button')].find((b) => (b.innerText || '').includes('第1章') && (b.innerText || '').includes('雾港'))
  if (!btn) return false
  btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  btn.click()
  return true
})()`)
await sleep(2000)

// 1. 状态栏存在（编辑器下方 footer）
const exists = await ev(`!!document.querySelector('[data-testid="health-bar"]')`)
ok(exists, '规则体检状态栏已出现于编辑器下方')

// 2. 等待体检完成 → devShim 演示项目有已知问题（人物在场：沈爷 别名未登记）→ issues 态
let icon = null
for (let i = 0; i < 30; i++) {
  icon = await ev(`(() => {
    const b = document.querySelector('[data-testid="health-bar"]')
    if (!b) return null
    const txt = b.textContent
    return {
      issues: !!document.querySelector('[data-testid="health-icon-issues"]'),
      ok: !!document.querySelector('[data-testid="health-icon-ok"]'),
      badge: document.querySelector('[data-testid="health-badge"]')?.textContent ?? null,
      txt
    }
  })()`)
  if (icon && (icon.issues || icon.ok || !!document.querySelector('[data-testid="health-icon-error"]'))) break
  await sleep(500)
}
ok(!!icon && !!icon.issues, `体检完成后为「有问题」态（琥珀盾）（实际 ${icon?.txt}）`)
ok(!!icon && !!icon.badge && /^\d+$/.test(icon.badge), `问题数为角标 badge（实际 ${icon?.badge}）`)
ok(!!icon && /有问题/.test(icon.txt) && !/处问题/.test(icon.txt), `状态文案不写数字（「规则体检：有问题」），实际 ${JSON.stringify(icon?.txt)}`)

// 3. 点击状态钮 → AuditDrawer 打开（首个有问题类=人物在场核查）
await ev(`document.querySelector('[data-testid="health-status"]').click()`)
await sleep(1200)
const drawer = await ev(`(() => {
  const t = [...document.querySelectorAll('h2,h3,[role="dialog"] *')].find((el) => el.textContent?.includes('人物在场核查'))
  return !!t
})()`)
ok(!!drawer, '点击状态图标打开详情抽屉（人物在场核查）')

// 3.3 F-20260916-05 迁移完整性（㉞ 教训资产化）：抽屉「切换」菜单含 缺段/切片/混用 三类 + 「让 agent 改」入口存在
await ev(`(() => {
  const b = document.querySelector('[data-testid="audit-kind-select"]')
  if (!b) return false
  b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  b.click()
  return true
})()`)
await sleep(600)
const tabs = await ev(`(() => {
  const items = [...document.querySelectorAll('[role="menuitem"]')].map((x) => (x.textContent || '').trim())
  const dlg = document.querySelector('[role="dialog"]')
  const btns = dlg ? [...dlg.querySelectorAll('button')].map((b) => (b.textContent || '').trim()) : []
  return { que: items.includes('缺段'), sli: items.includes('切片'), mix: items.includes('混用'), toAgent: btns.includes('让 agent 改') }
})()`)
ok(!!tabs && tabs.que && tabs.sli && tabs.mix, `切换菜单含 缺段/切片/混用（迁移完整性，实际 ${JSON.stringify(tabs)}）`)
ok(!!tabs && tabs.toAgent, '「让 agent 改」入口存在（onToAgent 已接线）')

// 3.4 经菜单切「缺段」生效（标题=正文缺段核查）
const clickedTab = await ev(`(() => {
  const b = [...document.querySelectorAll('[role="menuitem"]')].find((x) => (x.textContent || '').trim() === '缺段')
  if (b) {
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
    b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
    b.click()
  }
  return !!b
})()`)
ok(!!clickedTab, '抽屉「切换」菜单项缺段可点')
await sleep(1200)
const switched = await ev(`[...document.querySelectorAll('[role="dialog"] *')].some((el) => el.textContent?.includes('正文缺段核查'))`)
ok(!!switched, '切「缺段」后标题=正文缺段核查')
await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await sleep(600)

// 4. 手动重跑按钮可用
await ev(`(() => { const b = [...document.querySelectorAll('[data-testid="health-bar"] button')].find((x) => x.title === '重新体检'); b?.click(); return !!b })()`)
await sleep(2500)
const after = await ev(`!!document.querySelector('[data-testid="health-icon-issues"]') || !!document.querySelector('[data-testid="health-icon-ok"]')`)
ok(!!after, '手动重跑后状态恢复（体检完成）')

// 5. 截图（状态栏区域）
const clip = await ev(`(() => {
  const hb = document.querySelector('[data-testid="health-bar"]')
  if (!hb) return null
  const r = hb.getBoundingClientRect()
  return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), w: r.width + 16, h: r.height + 16, dw: window.innerWidth, dh: window.innerHeight }
})()`)
if (clip) {
  const shot = await cmd('Page.captureScreenshot', { format: 'png', clip: { x: clip.x, y: clip.y, width: Math.min(clip.w, clip.dw), height: Math.min(clip.h, clip.dh), scale: 2 } })
  const fs = await import('node:fs')
  const p = `/Users/USER/Pictures/zhijuan/healthbar-${new Date().toISOString().slice(11, 16).replace(':', '')}.png`
  fs.writeFileSync(p, Buffer.from(shot.data, 'base64'))
  console.log('SHOT', p)
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
ws.close()
process.exit(fail ? 1 : 0)
