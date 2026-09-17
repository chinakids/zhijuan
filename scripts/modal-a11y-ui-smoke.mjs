// 模态无障碍（Apple HIG Keyboards · Focus and selection）· 无头 UI 冒烟：
// 验证自研抽屉 useModalA11y：初始聚焦入面板、Tab/Shift+Tab 圈闭、Esc 关闭、滚动锁、关闭回焦；
// 以及 icon-only 按钮 aria-label 补齐（可发现性）。
// 用法：node scripts/modal-a11y-ui-smoke.mjs   （先 npm run build + node scripts/serve-renderer.mjs 8123 + 无头 Chrome CDP 9224）
const PORT = 8123
const BASE = process.env.ZJ_SMOKE_BASE || `http://localhost:${PORT}`
const list = await (await fetch('http://127.0.0.1:9224/json')).json()
// 宿主页=本端口页；无→自开兜底（㉝ 契约：找宿主页的冒烟要么自开要么兜底；原「任意第一个 page」在 tab 治理后可能是 about:blank/外域）
let page = list.find((t) => t.type === 'page' && (t.url || '').includes(':' + new URL(BASE).port))
if (!page) {
  const r = await fetch('http://127.0.0.1:9224/json/new?' + encodeURIComponent(`${BASE}/?cb=${Date.now()}`), { method: 'PUT' })
  page = await r.json()
}
if (!page || !page.webSocketDebuggerUrl) { console.error('NO PAGE'); process.exit(1) }
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

// 1. 载入 novel 路由（缓存破坏）
await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}#/project/demo-aseya/novel` })
await sleep(3500)
ok(/novel/.test(await ev('location.hash')), '页面已载入 novel 路由')
ok(!!(await ev(`!!document.querySelector('textarea[placeholder*="让 agent"]')`)), 'agent 输入框存在')

// 2. icon-only 按钮可发现性：Agent 头部「本章小环」按钮 aria-label 存在
const cc = await ev(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '本章小环')
  return btn ? { disabled: btn.disabled } : null
})()`)
ok(!!cc, `Agent 头部「本章小环」按钮 aria-label 存在`)

// 2b. Novel 页默认不挂载编辑器 → 先选中章节（devShim 预设首章），等待编辑器挂载后再查工具栏
if (cc && cc.disabled) {
  // 限定 button：章节列表项为分行结构，li 也含「第1章」文本且 li.click() 对 React onClick 无效（2026-09-18 实踩）
  await ev(`(() => { const el = [...document.querySelectorAll('button')].find((b) => (b.textContent||'').includes('第1章') && !b.closest('[aria-hidden="true"]')); if (el) { el.focus(); el.click(); } return !!el })()`)
  await sleep(600)
}
let tb = null
for (let i = 0; i < 20 && !(tb && tb.n > 0); i++) {
  tb = await ev(`(() => {
    const btns = [...document.querySelectorAll('button.zj-tb-item')].filter((b) => !b.closest('[aria-hidden="true"]'))
    const missing = btns.filter((b) => !b.getAttribute('aria-label')).length
    const names = btns.map((b) => b.getAttribute('aria-label')).filter(Boolean)
    return { n: btns.length, missing, hasBold: names.some((x) => x.includes('加粗')), sample: names.slice(0, 3) }
  })()`)
  if (!tb || tb.n === 0) await sleep(500)
}
ok(!!tb && tb.n > 0 && tb.missing === 0, `编辑器工具栏按钮均带 aria-label（${tb && tb.n} 个，缺 ${tb && tb.missing}）`)
ok(!!tb && tb.hasBold, `含「加粗」按钮（${tb && tb.sample && tb.sample.join('/')}）`)

// 3. 打开「本章小环」抽屉（先 focus 再 click＝键盘发起路径，restore 才有明确目标）
await ev(`(() => { const btn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '本章小环'); if (btn) { btn.focus(); btn.click(); } return !!btn })()`)
await sleep(800)
const dlg = await ev(`(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => x.getAttribute('aria-label') === '本章小环')
  if (!d) return null
  const act = document.activeElement
  return { dlg: !!d, focusIn: !!(act && d.contains(act)), focusTag: act ? act.tagName + ':' + (act.getAttribute('aria-label') || act.textContent || '').slice(0, 12) : null, overflow: document.body.style.overflow }
})()`)
ok(!!dlg, `本章小环抽屉（role=dialog+aria-label）打开`)
ok(!!dlg && dlg.focusIn, `打开后焦点已入面板（${dlg && dlg.focusTag}）`)
ok(!!dlg && dlg.overflow === 'hidden', `body 滚动锁 hidden（实际 ${dlg && dlg.overflow}）`)

// 4. Tab 圈闭：真实 Tab keydown 到 document（handler 手动圈闭）
const tabLoop = await ev(`(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => x.getAttribute('aria-label') === '本章小环')
  if (!d) return null
  const sel = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
  const els = [...d.querySelectorAll(sel)].filter((el) => el.getClientRects().length > 0 && !el.closest('[aria-hidden="true"]'))
  const first = els[0], last = els[els.length - 1]
  // 正向：焦点在末元素 + Tab → 应回首个
  last.focus()
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
  const afterFwd = document.activeElement === first
  // 反向：焦点在首元素 + Shift+Tab → 应到末元素
  first.focus()
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
  const afterBack = document.activeElement === last
  return { n: els.length, afterFwd, afterBack }
})()`)
ok(!!tabLoop && tabLoop.n > 0, `面板内可聚焦元素 ${tabLoop && tabLoop.n} 个`)
ok(!!tabLoop && tabLoop.afterFwd, 'Tab 从末元素圈闭回首元素')
ok(!!tabLoop && tabLoop.afterBack, 'Shift+Tab 从首元素圈闭到末元素')

// 5. Esc 关闭 + 滚动锁恢复 + 焦点回触发按钮
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`)
await sleep(600)
const afterEsc = await ev(`(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => x.getAttribute('aria-label') === '本章小环')
  const act = document.activeElement
  return { dlgGone: !d, overflow: document.body.style.overflow, focusBack: !!(act && act.getAttribute && act.getAttribute('aria-label') === '本章小环') }
})()`)
ok(afterEsc.dlgGone, 'Esc 后抽屉关闭')
ok(afterEsc.overflow === '', `滚动锁已恢复（''，实际 ${JSON.stringify(afterEsc.overflow)}）`)
ok(afterEsc.focusBack, '关闭后焦点回到「本章小环」触发按钮')

// 6. 版本历史抽屉同口径（打开 → 焦点入内 → Esc 关闭回焦）
await ev(`(() => { const el = [...document.querySelectorAll('button')].find((b) => (b.textContent||'').trim() === '历史'); if (el) { el.focus(); el.click(); } return !!el })()`)
await sleep(700)
const hist = await ev(`(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => x.getAttribute('aria-label') === '版本历史')
  if (!d) return null
  const act = document.activeElement
  return { focusIn: !!(act && d.contains(act)), overflow: document.body.style.overflow }
})()`)
ok(!!hist, `版本历史抽屉（role=dialog+aria-label）打开`)
ok(!!hist && hist.focusIn, '版本历史 打开后焦点入面板')
ok(!!hist && hist.overflow === 'hidden', '版本历史 滚动锁 hidden')
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`)
await sleep(600)
const histAfter = await ev(`(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => x.getAttribute('aria-label') === '版本历史')
  const act = document.activeElement
  return { dlgGone: !d, focusBack: !!(act && (act.textContent||'').trim() === '历史') }
})()`)
ok(histAfter.dlgGone, '版本历史 Esc 后关闭')
ok(histAfter.focusBack, '版本历史 关闭后焦点回「历史」按钮')

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
ws.close()
process.exit(fail ? 1 : 0)
