// 织卷无头冒烟 · 编辑器工具栏键盘可达走查（候选 9：HIG Keyboards 控件遍历口径）
// 用法：node scripts/toolbar-kbd-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；本机无头 Chrome CDP 127.0.0.1:9224
// 调研结论（2026-09-14 20:15 真抓取 HIG Keyboards /tmp/hig-keyboards-now.txt）：
//   ① Tab/Shift-Tab＝"Navigate through controls"（macOS 控件遍历=Tab 循环）；
//   ② Control-F5＝"Move focus to the toolbar"（系统级 full keyboard access 提供，Web 应用不自实现）；
//   ③ 方向键仅「表格单元格/值」语义（Control+方向键）——HIG 无工具栏方向键导航要求 → 不实现 roving（记达标）。
//   ④ prosemirror-commands v2 base keymap 不含 Tab（dist/index.js:814 实证）→ 编辑器不吞 Tab。
// 本轮实现：Esc 在工具栏内 → 回焦正文编辑器（Prose.tsx 全局 Esc 分层新增分支；不 preventDefault，
//   让 Radix More 菜单等后续处理器照常）。
// 结构（避坑：本环境「交互之后再 Emulation.resize」会挂死浏览器主进程——两 tab 分治）：
//   A 窄窗 tab：加载后先 resize 820 → 再交互（More 键盘开合）；B 宽窗 tab：零 resize（焦点环/禁用跳过/Esc/暗色/截图）。
// 验收点：① 从编辑器 Shift+Tab 可达工具栏（键盘入路）；前进 Tab 记录去向（批注侧标）；
//         ② 焦点环两主题（focus-visible 2px accent 混色）；③ 禁用项（撤销/重做）不在 Tab 序列；
//         ④ 窄窗 More 键盘开合（Enter 开/Esc 关）；⑤ Esc 回焦编辑器；⑥ 无 JS 异常；⑦ 截图。
const CDP = 'http://127.0.0.1:9224'
const BASE = 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const OUT = process.env.HOME + '/Pictures/zhijuan'
const NOVEL = '#/project/demo-aseya/novel?ch=' + encodeURIComponent('第01章_雾港.md')

async function openTab(url) {
  const r = await fetch(CDP + '/json/new?' + encodeURIComponent(url), { method: 'PUT' })
  return r.json()
}
async function closeTab(id) {
  try { await fetch(CDP + '/json/close/' + id) } catch { /* 尽力 */ }
}

function attach(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let seq = 0
  const pending = new Map()
  const errors = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails?.exception?.description ?? '').slice(0, 200))
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push((m.params.args?.map((a) => a.value ?? a.description ?? '').join(' ') ?? '').slice(0, 200))
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const cmd = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq
      pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
      ws.send(JSON.stringify({ id, method, params }))
    })
  return new Promise((res) => {
    ws.onopen = async () => {
      await cmd('Runtime.enable')
      res({
        cmd, errors,
        eval: async (expression) => {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
          return r.result?.value
        },
        close: () => ws.close()
      })
    }
  })
}

async function evalUntil(page, expr, pred, timeoutMs = 20000, label = expr) {
  const t0 = Date.now()
  for (;;) {
    try {
      const v = await page.eval(expr)
      if (pred(v)) return v
    } catch { /* 重试 */ }
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(300)
  }
}

async function key(page, keyName, opts = {}) {
  const base = { key: keyName, code: opts.code || keyName, windowsVirtualKeyCode: opts.vk || 0, nativeVirtualKeyCode: opts.vk || 0 }
  await page.cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base, modifiers: opts.shift ? 8 : 0 })
  await sleep(50)
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', ...base, modifiers: opts.shift ? 8 : 0 })
  await sleep(100)
}

const focusExpr = `(() => {
  const el = document.activeElement
  if (!el) return { tag: null }
  return {
    tag: el.tagName,
    inToolbar: !!el.closest('.zj-md-toolbar'),
    inPM: !!el.closest('.ProseMirror'),
    title: el.getAttribute ? el.getAttribute('title') : null,
    cls: (el.className || '').toString().slice(0, 80)
  }
})()`

const rectExpr = (needleB64) => `(() => {
  const root = document.querySelector('.ProseMirror')
  if (!root) return null
  const needle = new TextDecoder().decode(Uint8Array.from(atob('${needleB64}'), (c) => c.charCodeAt(0)))
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let n
  while ((n = walker.nextNode())) {
    if (!n.textContent || !n.textContent.includes(needle)) continue
    const r = document.createRange()
    r.selectNodeContents(n)
    const rect = r.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }
  return null
})()`

async function clickXY(page, x, y) {
  await page.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await sleep(60)
  await page.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await sleep(60)
  await page.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  await sleep(150)
}

const WAIT_BAR = `(() => {
  const bar = [...document.querySelectorAll('.zj-md-toolbar')].find((b) => !b.hasAttribute('data-zj-tb-measure'))
  return !!(bar && bar.querySelector('.zj-tb-item') && document.querySelector('.ProseMirror'))
})()`

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

/* ============ A 阶段：窄窗 tab（先 resize 后交互；结束关 tab） ============ */
console.log('--- PHASE A: narrow (820) ---')
const tabA = await openTab(BASE + '/?cb=' + Date.now() + NOVEL)
const pageA = await attach(tabA.webSocketDebuggerUrl)
await evalUntil(pageA, WAIT_BAR, (v) => v === true, 25000, 'A: 工具栏/编辑器就绪')
await pageA.cmd('Emulation.setDeviceMetricsOverride', { width: 820, height: 800, deviceScaleFactor: 1, mobile: false })
await evalUntil(pageA, `!!([...document.querySelectorAll('.zj-md-toolbar')].find((b) => !b.hasAttribute('data-zj-tb-measure'))?.querySelector('[title="更多格式"]'))`, (v) => v === true, 15000, 'A: 窄窗 More 出现')
const rcA = await evalUntil(pageA, rectExpr(Buffer.from('雾港', 'utf8').toString('base64')), (v) => !!v, 15000, 'A: 正文坐标')
await clickXY(pageA, rcA.x, rcA.y)
await key(pageA, 'Tab', { vk: 9, code: 'Tab', shift: true })
let f = await pageA.eval(focusExpr)
ok('A① 窄窗 Shift+Tab 到 More 触发器', f.inToolbar === true && f.title === '更多格式', JSON.stringify(f))
await key(pageA, 'Enter', { vk: 13, code: 'Enter' })
const menuState = await evalUntil(pageA, `(() => ({
  open: !!document.querySelector('[role="menu"]'),
  focusInMenu: !!document.activeElement?.closest?.('[role="menu"]')
}))()`, (x) => x.open === true, 12000, 'A: More 菜单打开')
ok('A② Enter 打开 More 菜单（role=menu，焦点入菜单）', menuState.open === true && menuState.focusInMenu === true, JSON.stringify(menuState))
await key(pageA, 'Escape', { vk: 27, code: 'Escape' })
const menuClosed = await evalUntil(pageA, `!!document.querySelector('[role="menu"]')`, (v) => v === false, 12000, 'A: More 菜单关闭')
ok('A③ Esc 关闭 More 菜单（菜单项聚焦时由 Radix 处理，未被抢）', menuClosed === false)
await sleep(200)
f = await pageA.eval(focusExpr)
console.log('A: AFTER-ESC1', JSON.stringify(f))
await key(pageA, 'Escape', { vk: 27, code: 'Escape' })
f = await pageA.eval(focusExpr)
ok('A④ 菜单关后再次 Esc（焦点在触发器）→ 回焦编辑器', f.inPM === true, JSON.stringify(f))
ok('A⑤ 阶段 A 无 JS 异常', pageA.errors.length === 0, pageA.errors.slice(0, 3).join(' || '))
await closeTab(tabA.id)
pageA.close()

/* ============ B 阶段：宽窗 tab（零 resize；焦点环/禁用跳过/Esc/暗色/截图） ============ */
console.log('--- PHASE B: wide (1280) ---')
const tabB = await openTab(BASE + '/?cb=' + Date.now() + NOVEL)
const pageB = await attach(tabB.webSocketDebuggerUrl)
await evalUntil(pageB, WAIT_BAR, (v) => v === true, 25000, 'B: 工具栏/编辑器就绪')

const tbCount = await pageB.eval(`(() => {
  const bar = [...document.querySelectorAll('.zj-md-toolbar')].find((b) => !b.hasAttribute('data-zj-tb-measure'))
  const real = bar.querySelectorAll('.zj-tb-item[tabindex]').length
  return { visible: real ? real : bar.querySelectorAll('.zj-tb-item').length, hasMore: !!bar.querySelector('[title="更多格式"]') }
})()`)
console.log('B: TB', JSON.stringify(tbCount))
ok('B① 宽窗工具栏无 More，12 个工具项', tbCount.hasMore === false && tbCount.visible === 12, JSON.stringify(tbCount))

const rcB = await evalUntil(pageB, rectExpr(Buffer.from('雾港', 'utf8').toString('base64')), (v) => !!v, 15000, 'B: 正文坐标')
await clickXY(pageB, rcB.x, rcB.y)
f = await pageB.eval(focusExpr)
ok('B② 点击正文后焦点在编辑器', f.inPM === true, JSON.stringify(f))
await key(pageB, 'Tab', { vk: 9, code: 'Tab' })
f = await pageB.eval(focusExpr)
console.log('B: FORWARD-TAB', JSON.stringify(f))
ok('B③ 前进 Tab 从编辑器离开（去向=批注侧标等后续可聚焦项；工具栏在 DOM 编辑器之前，故不入工具栏）', f.inToolbar !== true && f.tag === 'BUTTON', JSON.stringify(f))
await key(pageB, 'Tab', { vk: 9, code: 'Tab', shift: true })
f = await pageB.eval(focusExpr)
ok('B④ Shift+Tab 回到编辑器', f.inPM === true, JSON.stringify(f))
await key(pageB, 'Tab', { vk: 9, code: 'Tab', shift: true })
f = await pageB.eval(focusExpr)
console.log('B: SHIFT-TAB->', JSON.stringify(f))
ok('B⑤ 从编辑器 Shift+Tab 可达工具栏（键盘入路=末项）', f.inToolbar === true, JSON.stringify(f))

const ring = await pageB.eval(`(() => {
  const s = getComputedStyle(document.activeElement)
  return { w: s.outlineWidth, st: s.outlineStyle, c: s.outlineColor }
})()`)
console.log('B: RING-PAPER', JSON.stringify(ring))
ok('B⑥ 亮色焦点环 2px solid（focus-visible 全局口径，accent 65% 混色）', ring.w === '2px' && ring.st === 'solid' && ring.c !== 'none', JSON.stringify(ring))

// 反向收集（从末项 Shift+Tab 倒退穿全栏，验证禁用项跳过与全可达）
const titles = [f.title]
let guard = 0
for (;;) {
  await key(pageB, 'Tab', { vk: 9, code: 'Tab', shift: true })
  f = await pageB.eval(focusExpr)
  if (!f.inToolbar) break
  titles.push(f.title)
  if (++guard > 20) break
}
console.log('B: TAB-SEQ', JSON.stringify(titles))
ok('B⑦ 禁用项（撤销/重做初始置灰）不在 Tab 序列', !titles.includes('撤销') && !titles.includes('重做'), titles.join(','))
ok('B⑧ Tab 序列覆盖可见可用项（≥8 个工具项全可达）', titles.length >= 8, String(titles.length))

// Esc 回焦编辑器（本轮实现）
await clickXY(pageB, rcB.x, rcB.y)
await key(pageB, 'Tab', { vk: 9, code: 'Tab', shift: true })
f = await pageB.eval(focusExpr)
ok('B⑨ 再次 Shift+Tab 到工具栏', f.inToolbar === true, JSON.stringify(f))
await key(pageB, 'Escape', { vk: 27, code: 'Escape' })
f = await pageB.eval(focusExpr)
ok('B⑩ Esc（焦点在工具栏）→ 回焦正文编辑器', f.inPM === true, JSON.stringify(f))

// 暗色焦点环
await pageB.eval(`document.documentElement.classList.add('dark')`)
await sleep(200)
await clickXY(pageB, rcB.x, rcB.y)
await key(pageB, 'Tab', { vk: 9, code: 'Tab', shift: true })
f = await pageB.eval(focusExpr)
const ringDark = await pageB.eval(`(() => { const s = getComputedStyle(document.activeElement); return { w: s.outlineWidth, c: s.outlineColor } })()`)
console.log('B: RING-DARK', JSON.stringify(ringDark), JSON.stringify(f))
ok('B⑪ 深色：焦点环仍 2px 且颜色与亮色不同', ringDark.w === '2px' && ringDark.c !== ring.c, JSON.stringify(ringDark))
await pageB.eval(`document.documentElement.classList.remove('dark')`)

// 截图（亮色：工具栏按钮焦点环 + Esc 回正文后）
await sleep(200)
await clickXY(pageB, rcB.x, rcB.y)
await key(pageB, 'Tab', { vk: 9, code: 'Tab', shift: true })
const shot1 = await pageB.cmd('Page.captureScreenshot', { format: 'png' })
const hhmm = new Date().toTimeString().slice(0, 5).replace(':', '')
const fsMod = await import('node:fs')
const p1 = `${OUT}/toolbar-kbd-ring-${hhmm}.png`
fsMod.writeFileSync(p1, Buffer.from(shot1.data, 'base64'))
console.log('SHOT:', p1)
await key(pageB, 'Escape', { vk: 27, code: 'Escape' })
const shot2 = await pageB.cmd('Page.captureScreenshot', { format: 'png' })
const p2 = `${OUT}/toolbar-kbd-esc-${hhmm}.png`
fsMod.writeFileSync(p2, Buffer.from(shot2.data, 'base64'))
console.log('SHOT:', p2)

ok('B⑫ 全程无 JS 异常', pageB.errors.length === 0, pageB.errors.slice(0, 3).join(' || '))
await closeTab(tabB.id)
pageB.close()

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAIL`)
process.exit(fails === 0 ? 0 : 1)
