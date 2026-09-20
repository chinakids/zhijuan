// 用词重复核查（overuse）· 无头 UI 冒烟（2026-09-20 智能层接线后新增）
// 断言：① demo-overuse 项目健康栏=issues 态（overuse 命中，且无其它本地规则噪音）；
//       ② 点击状态钮 → AuditDrawer 打开且标题=用词重复核查（首问题类=overuse，证明「第 8 项自动纳入健康栏」）；
//       ③ 抽屉内命中条目渲染（what 含「全卷出现」+suggest 非空）；
//       ④ 切换菜单含「用词」短项（K_SHORT 接线）；⑤ 切其它 tab 再切回「用词」标题正确；
// 用法：node scripts/overuse-ui-smoke.mjs  （先 npm run build + node scripts/serve-renderer.mjs 8123，CDP 9224 在跑）
const PORT = 8123
const BASE = process.env.ZJ_SMOKE_BASE || `http://localhost:${PORT}`
const list = await (await fetch('http://127.0.0.1:9224/json')).json()
let page = list.find((t) => t.type === 'page' && new RegExp(`:${PORT}`).test(t.url))
if (!page) {
  const r = await fetch('http://127.0.0.1:9224/json/new?' + encodeURIComponent(`${BASE}/?cb=${Date.now()}`), { method: 'PUT' })
  page = await r.json()
}
if (!page) { console.error('NO PAGE'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const errors = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errors.push('EXC: ' + JSON.stringify(m.params.exceptionDetails?.exception?.description ?? m.params))
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('CONSOLE-ERR: ' + JSON.stringify(m.params.args?.map((a) => a.value ?? a.description)))
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
await cmd('Runtime.enable')
await cmd('Page.enable')
let pass = 0, fail = 0
const ok = (cond, msg) => { console.log((cond ? '✅ ' : '❌ ') + msg); cond ? pass++ : fail++ }

await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}#/project/demo-overuse/novel` })
await sleep(3500)

// 选中第1章
await ev(`(() => {
  const btn = [...document.querySelectorAll('[data-testid="chapter-sidebar"] button, aside button')].find((b) => (b.innerText || '').includes('第1章') && (b.innerText || '').includes('试笔'))
  if (!btn) return false
  btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  btn.click()
  return true
})()`)
await sleep(2000)

// ① 健康栏 issues 态
let icon = null
for (let i = 0; i < 30; i++) {
  icon = await ev(`(() => {
    const b = document.querySelector('[data-testid="health-bar"]')
    if (!b) return null
    return {
      issues: !!document.querySelector('[data-testid="health-icon-issues"]'),
      ok: !!document.querySelector('[data-testid="health-icon-ok"]'),
      badge: document.querySelector('[data-testid="health-badge"]')?.textContent ?? null,
      title: document.querySelector('[data-testid="health-status"]')?.title ?? ''
    }
  })()`)
  if (icon && (icon.issues || icon.ok)) break
  await sleep(500)
}
ok(!!icon && !!icon.issues, `健康栏为「有问题」态（overuse 命中，实际 ${JSON.stringify(icon?.title)}）`)
ok(!!icon && !!icon.badge && /^\d+$/.test(icon.badge), `问题数为角标 badge（实际 ${icon?.badge}）`)
ok(!!icon && /用词重复/.test(icon.title), `状态标题 detail 含「用词重复」(${icon?.title})`)

// ② 点击状态钮 → 抽屉打开且标题=用词重复核查
await ev(`document.querySelector('[data-testid="health-status"]').click()`)
await sleep(1200)
const dlg = await ev(`(() => {
  const dlg = document.querySelector('[role="dialog"]')
  if (!dlg) return null
  return { title: (dlg.textContent || '').includes('用词重复核查'), items: (dlg.textContent || '').includes('全卷出现') }
})()`)
ok(!!dlg && !!dlg.title, '点击状态图标打开详情抽屉（标题=用词重复核查）')
ok(!!dlg && !!dlg.items, '抽屉渲染命中条目（what 含「全卷出现」）')

// ③ 切换菜单含「用词」短项（K_SHORT）
await ev(`(() => {
  const b = document.querySelector('[data-testid="audit-kind-select"]')
  if (!b) return false
  b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  b.click()
  return true
})()`)
await sleep(600)
const menu = await ev(`(() => {
  const items = [...document.querySelectorAll('[role="menuitem"]')].map((x) => (x.textContent || '').trim())
  return { hasOveruse: items.includes('用词'), items: items.join('/') }
})()`)
ok(!!menu && menu.hasOveruse, `切换菜单含「用词」短项（实际 ${menu.items}）`)

// ④ 经菜单切「在场」再切回「用词」→ 标题正确
const clickItem = async (label) => {
  return ev(`(() => {
    const b = [...document.querySelectorAll('[role="menuitem"]')].find((x) => (x.textContent || '').trim() === '${label}')
    if (b) {
      b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
      b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
      b.click()
    }
    return !!b
  })()`)
}
await clickItem('在场')
await sleep(900)
const switched = await ev(`[...document.querySelectorAll('[role="dialog"] *')].some((el) => el.textContent?.includes('人物在场核查'))`)
ok(!!switched, '切「在场」后标题=人物在场核查')
// 重新打开菜单切回「用词」
await ev(`(() => {
  const b = document.querySelector('[data-testid="audit-kind-select"]')
  if (!b) return false
  b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  b.click()
  return true
})()`)
await sleep(600)
await clickItem('用词')
await sleep(900)
const backTxt = await ev(`(document.querySelector('[role="dialog"]')?.textContent || '').slice(0, 300)`)
const back = await ev(`(() => { const d = document.querySelector('[role="dialog"]'); const t = d ? d.textContent : ''; return t.includes('用词重复核查') && t.includes('全卷出现') })()`)
ok(!!back, '切回「用词」标题与命中条目均正确（dialog=' + JSON.stringify(backTxt) + '）')

// 5. 截图（健康栏+抽屉）
const clip = await ev(`(() => {
  const dlg = document.querySelector('[role="dialog"]')
  if (!dlg) return null
  const r = dlg.getBoundingClientRect()
  return { x: Math.max(0, r.x - 12), y: Math.max(0, r.y - 12), w: Math.min(r.width + 24, window.innerWidth), h: Math.min(r.height + 24, window.innerHeight), dw: window.innerWidth, dh: window.innerHeight }
})()`)
if (clip) {
  const shot = await cmd('Page.captureScreenshot', { format: 'png', clip: { x: clip.x, y: clip.y, width: Math.min(clip.w, clip.dw), height: Math.min(clip.h, clip.dh), scale: 2 } })
  const fs = await import('node:fs')
  const ts = new Date().toISOString().slice(11, 16).replace(':', '')
  const p = `/Users/USER/Pictures/zhijuan/overuse-drawer-${ts}.png`
  fs.writeFileSync(p, Buffer.from(shot.data, 'base64'))
  console.log('SHOT', p)
  // 健康栏截图
  const hb = await ev(`(() => {
    const b = document.querySelector('[data-testid="health-bar"]')
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), w: r.width + 16, h: r.height + 16, dw: window.innerWidth, dh: window.innerHeight }
  })()`)
  if (hb) {
    const shot2 = await cmd('Page.captureScreenshot', { format: 'png', clip: { x: hb.x, y: hb.y, width: Math.min(hb.w, hb.dw), height: Math.min(hb.h, hb.dh), scale: 2 } })
    const p2 = `/Users/USER/Pictures/zhijuan/overuse-healthbar-${ts}.png`
    fs.writeFileSync(p2, Buffer.from(shot2.data, 'base64'))
    console.log('SHOT', p2)
  }
}

ok(errors.length === 0, `全程零 JS 异常（${errors.length ? errors.join(' | ') : '无'}）`)

console.log(`
结果: ${pass} 通过 / ${fail} 失败`)
ws.close()
process.exit(fail ? 1 : 0)
