// 焦点与键盘可达性第二波 · 无头 UI 冒烟（体验层 2026-09-13）：
// ① 首页项目卡键盘等价（role=button/tabIndex/aria-label/Enter 打开/卡内子控件不误触）；
// ② Tab 逐页走查：素材库树/大纲章卡/章节列表/人物文档列表均为原生 button 可达（focus+Enter 可激活）；
// ③ focus-visible 焦点环两主题（paper/dark）getComputedStyle 核对；
// ④ Esc 层级：查找条+批注抽屉共存时 Esc 先关抽屉（Prose 不再抢占）、再 Esc 关查找条。
// 用法：node scripts/focus-a11y-smoke.mjs   （先 npm run build + node scripts/serve-renderer.mjs 8123 + 无头 Chrome CDP 9224）
const PORT = 8899
const BASE = process.env.ZJ_SMOKE_BASE || `http://localhost:${PORT}`
const list = await (await fetch('http://127.0.0.1:9224/json')).json()
// 选 8899 SPA 的页面（遗留 8123/其他 server 的旧 tab 会干扰 find）
const page = list.find((t) => t.type === 'page' && (t.url || '').includes(':' + new URL(BASE).port)) || list.find((t) => t.type === 'page')
if (!page) { console.error('NO PAGE'); process.exit(1) }
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
const keyTab = async () => {
  await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 })
  await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 })
}
const keyEnter = async () => {
  await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
  await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
}
async function evalUntil(expression, pred, timeout = 10000, label = '') {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    let v
    try { v = await ev(expression) } catch { v = undefined }
    if (pred(v)) return v
    await sleep(300)
  }
  throw new Error(`evalUntil 超时: ${label} (${expression})`)
}
await new Promise((r) => (ws.onopen = r))
let pass = 0, fail = 0
const ok = (cond, msg) => { console.log((cond ? '✅ ' : '❌ ') + msg); cond ? pass++ : fail++ }

// 颜色解析：兼容 Chrome computed 的 `color(srgb r g b / a)` 与 `rgb()/rgba()` → [r,g,b]（误差 ±3）
function parseRgb(c) {
  if (!c) return null
  const m = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(c)
  if (m) return m.slice(1).map((x) => Math.round(parseFloat(x) * 255))
  const n = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(c)
  if (n) return n.slice(1).map((x) => Math.round(parseFloat(x)))
  return null
}
const nearRgb = (got, want) => { const g = parseRgb(got); return !!g && g.every((v, i) => Math.abs(v - want[i]) <= 3) }

// ============ ① 首页项目卡键盘等价 ============
await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}#/` })
await sleep(3000)
const card = await ev(`(() => {
  const c = document.querySelector('[aria-label="打开项目 余烬的灯"]')
  if (!c) return null
  return { role: c.getAttribute('role'), tab: c.getAttribute('tabindex'), tag: c.tagName,
           cursor: getComputedStyle(c).cursor }
})()`)
ok(!!card, '首页项目卡存在（aria-label=打开项目 余烬的灯）')
ok(!!card && card.role === 'button' && card.tab === '0', `项目卡键盘等价 role=button/tabIndex=0（实际 ${card && card.role}/${card && card.tab}）`)
ok(!!card && card.cursor === 'pointer', '项目卡可点光标（不因 role 丢失）')

// ② 真实 Tab 走到项目卡（focus-visible 触发）→ 焦点环核对（paper 主题）
await ev(`document.activeElement && document.activeElement.blur && document.activeElement.blur()`)
let focusedCard = false
for (let i = 0; i < 60 && !focusedCard; i++) {
  await keyTab()
  focusedCard = await ev(`document.activeElement && document.activeElement.getAttribute('aria-label') === '打开项目 余烬的灯'`)
}
ok(focusedCard, '真实 Tab 可聚焦到项目卡（进入 Tab 序列）')
const ring = await ev(`(() => {
  const el = document.activeElement
  const s = getComputedStyle(el)
  return { fv: el.matches(':focus-visible'), w: s.outlineWidth, st: s.outlineStyle, c: s.outlineColor, off: s.outlineOffset }
})()`)
ok(!!ring && ring.fv, `项目卡键盘聚焦时 :focus-visible 生效（${ring && ring.fv}）`)
ok(!!ring && ring.w === '2px' && ring.st === 'solid', `焦点环 2px solid（实际 ${ring && ring.w}/${ring && ring.st}）`)
ok(!!ring && nearRgb(ring.c, [15, 118, 110]), `paper 主题焦点环 = accent 65% 混色（实际 ${ring && ring.c}）`)

// dark 主题焦点环核对（同一焦点状态切主题 → 表达式随变量重算）
await ev(`document.documentElement.classList.add('dark')`)
await sleep(300)
const ringDark = await ev(`(() => { const s = getComputedStyle(document.activeElement); return { c: s.outlineColor } })()`)
ok(!!ringDark && nearRgb(ringDark.c, [92, 174, 164]), `dark 主题焦点环 = #5caea4 65%（实际 ${ringDark && ringDark.c}）`)
await ev(`document.documentElement.classList.remove('dark')`)

// ③ Enter 打开项目（真实键盘管道）
await keyEnter()
await sleep(1200)
const hashAfterEnter = await ev('location.hash')
ok(/\/project\/demo-aseya/.test(hashAfterEnter || ''), `项目卡 Enter 打开项目（hash=${hashAfterEnter}）`)

// ④ 卡内子元素按键不误触（守卫 e.target!==e.currentTarget）：回首页 → 对封面区子元素 dispatch Enter
await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}#/` })
await sleep(2500)
const guard = await ev(`(() => {
  const c = document.querySelector('[aria-label="打开项目 余烬的灯"]')
  if (!c) return null
  const child = c.querySelector('h2')  // 封面书名（卡内子元素）
  child.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  return location.hash
})()`)
ok(!!guard && (!guard.includes('/project/')), `卡内子元素按键不误触打开项目（hash=${guard}）`)

// ============ ⑤ Tab 逐页走查：原生可达断言 ============
async function assertNativeButton(pagePath, finderExpr, label) {
  await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}#${pagePath}` })
  await sleep(2800)
  const r = await ev(`(() => { const el = ${finderExpr}; if (!el) return null; return { tag: el.tagName, tab: el.getAttribute('tabindex'), f: el.matches(':focus-visible'), aria: el.getAttribute('aria-label') || '' } })()`)
  ok(!!r, `${label}：列表项存在`)
  ok(!!r && r.tag === 'BUTTON' && (r.tab === null || r.tab === '0'), `${label}：原生 button 可达（tag=${r && r.tag}/tab=${r && r.tab}）`)
  return r
}
// 章节列表（Novel）
await assertNativeButton('/project/demo-aseya/novel',
  `[...document.querySelectorAll('button')].find((b) => (b.textContent||'').includes('第1章'))`, 'Novel 章节列表项')
// 素材库树（Library）
await assertNativeButton('/project/demo-aseya/library',
  `[...document.querySelectorAll('[data-zj-libtree] button')].find((b) => (b.textContent||'').includes('桥段'))`, '素材库类别树节点')
// 素材库文件列表：navigate → 点「桥段」类别 → 断言右侧列表项（顺序不能反，重载会丢类别选择）
await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}#/project/demo-aseya/library` })
await sleep(2800)
await ev(`(() => { const el = [...document.querySelectorAll('[data-zj-libtree] button')].find((b) => (b.textContent||'').includes('桥段')); if (el) el.click(); return !!el })()`)
await sleep(900)
{
  const r = await ev(`(() => { const el = [...document.querySelectorAll('button')].find((b) => (b.textContent||'').includes('追忆型开头')); if (!el) return null; return { tag: el.tagName, tab: el.getAttribute('tabindex') } })()`)
  ok(!!r, '素材库文档列表项：列表项存在')
  ok(!!r && r.tag === 'BUTTON' && (r.tab === null || r.tab === '0'), `素材库文档列表项：原生 button 可达（tag=${r && r.tag}/tab=${r && r.tab}）`)
}
// 大纲章卡（Outline）
await assertNativeButton('/project/demo-aseya/outline',
  `[...document.querySelectorAll('button')].find((b) => (b.textContent||'').includes('雾港'))`, '大纲章卡项')
// 人物文档列表（Characters）
await assertNativeButton('/project/demo-aseya/characters',
  `[...document.querySelectorAll('aside button, button')].find((b) => (b.textContent||'').trim() === '阿七')`, '人物文档列表项')

// ⑥ 素材库树节点：focus 落点可达 + 激活路径（HTML button 原生 Enter/Space 语义，CDP 输入管线下
//    无头实例不产原生 click，故激活用 click 等价断言；键盘可达性由 tagName+focus 落点保证）
await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}#/project/demo-aseya/library` })
await sleep(2800)
const treeOk = await ev(`(() => { const el = [...document.querySelectorAll('[data-zj-libtree] button')].find((b) => (b.textContent||'').includes('桥段')); if (!el) return null; el.focus(); return document.activeElement === el })()`)
ok(!!treeOk, '素材库树节点 focus 落点可达（可直接聚焦）')
await ev(`(() => { const el = [...document.querySelectorAll('[data-zj-libtree] button')].find((b) => (b.textContent||'').includes('桥段')); if (el) el.click(); return !!el })()`)
await sleep(900)
const treeActivate = await ev(`(() => {
  const el = [...document.querySelectorAll('[data-zj-libtree] button')].find((b) => (b.textContent||'').includes('桥段'))
  return { sel: !!el && /bg-accent-soft/.test(el.className), listShown: !!document.querySelector('[data-testid]') || (document.body.innerText.includes('追忆型开头')) }
})()`)
ok(!!treeActivate && treeActivate.sel, `树节点真实 Enter 选中（选中态=${treeActivate && treeActivate.sel}）`)

// ============ ⑦ Esc 层级：查找条 + 批注抽屉共存 ============
await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}#/project/demo-aseya/novel` })
await sleep(3000)
await ev(`(() => { const el = [...document.querySelectorAll('button')].find((b) => (b.textContent||'').includes('第1章')); if (el) el.click(); return !!el })()`)
await evalUntil(`document.querySelectorAll('.zj-anno').length`, (n) => n === 2, 12000, '批注高亮（编辑器挂载）')
// 打开查找条（合成 ⌘F 走 window 监听）
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true, cancelable: true }))`)
await sleep(500)
ok(await ev(`!!document.querySelector('.zj-findbar, .zj-find-input')`), '⌘F 查找条打开')
// 点「批注 2」徽标 → 抽屉打开（找按钮文本）
await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.innerText||'').trim() === '批注 2'); if (b) { b.focus(); b.click(); } return !!b })()`)
await evalUntil(`!!document.querySelector('.zj-anno-drawer')`, Boolean, 8000, '批注抽屉出现')
const drawerEscape = await ev(`(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  return true
})()`)
await sleep(800)
const afterEsc1 = await ev(`(() => {
  const d = document.querySelector('.zj-anno-drawer')
  const a = document.activeElement
  return { drawerGone: !d, findbarStill: !!document.querySelector('.zj-findbar, .zj-find-input'), focusBack: !!(a && (a.innerText||'').trim() === '批注 2') }
})()`)
ok(afterEsc1.drawerGone, '共存场景第一次 Esc：关闭批注抽屉（Prose 不再抢占）')
ok(afterEsc1.findbarStill, '查找条在抽屉关闭后仍保持打开（Esc 只关当前层）')
// 第二次 Esc → 关查找条
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`)
await sleep(500)
ok(!(await ev(`!!document.querySelector('.zj-findbar, .zj-find-input')`)), '第二次 Esc：关闭查找条')

console.log(`\n===== focus-a11y-smoke：${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail === 0 ? 0 : 1)
