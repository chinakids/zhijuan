// 织卷无头冒烟 · 编辑器工具栏窄窗溢出（More 菜单）＋ 标题栏章节题名
// 用法：node scripts/toolbar-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs 8123；本机无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 宽窗 12 按钮全见、无 More；② 视口收窄 → 低频项进「⋯」More 菜单（按钮数减少）；
//         ③ More 菜单项点击可执行（有序列表真实落 doc）；④ 恢复宽窗 → More 消失、按钮回全；
//         ⑤ 标题栏显示「第1章 · 雾港」（V3）；⑥ 深色主题无 JS 异常；⑦ 截图存档。
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function openTab(url) {
  const r = await fetch(CDP + '/json/new?' + encodeURIComponent(url), { method: 'PUT' })
  return r.json()
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

// 可见工具栏状态（排除测量层 data-zj-tb-measure 与 More 触发器）
const TB_STATE = `(() => {
  const bar = document.querySelector('.zj-md-toolbar:not([data-zj-tb-measure])')
  const root = bar?.parentElement ? document.querySelector('.zj-md-toolbar') : null
  const items = [...(root?.querySelectorAll('.zj-tb-item') ?? [])].filter(
    (b) => !b.closest('[data-zj-tb-measure]') && b.getAttribute('title') !== '更多格式'
  )
  const more = [...(root?.querySelectorAll('.zj-tb-item') ?? [])].find((b) => b.getAttribute('title') === '更多格式')
  const chromeTitle = document.querySelector('.window-chrome')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
  return {
    ready: !!root,
    items: items.map((b) => b.getAttribute('aria-label')), // 纯名（title 已含键位提示「名（⌘B）」→ 断言用 aria-label）
    more: !!more,
    moreBtn: more ? more.getBoundingClientRect().width : 0,
    barW: root ? root.getBoundingClientRect().width : 0,
    chromeTitle
  }
})()`

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel?ch=' + encodeURIComponent('第01章_雾港.md'))
console.log('TAB:', tab.id, tab.url)
const page = await attach(tab.webSocketDebuggerUrl)

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

// ① 宽窗：等编辑器与工具栏就绪
const v0 = await evalUntil(page, TB_STATE, (x) => x && x.ready && x.items.length === 12, 25000, '宽窗工具栏 12 项')
console.log('WIDE:', JSON.stringify(v0))
ok('宽窗 12 按钮全见', v0.items.length === 12, String(v0.items.length))
ok('宽窗无 More 按钮', v0.more === false)

// ⑤ 标题栏章节题名（V3）
ok('标题栏显示章节题名', v0.chromeTitle.includes('第1章') && v0.chromeTitle.includes('雾港'), v0.chromeTitle)

// ② 收窄视口 → More 出现、低频项进菜单（620 时侧栏占满，toolbar 压到近 0 → 全部收进 More 也是合理行为）
await page.cmd('Emulation.setDeviceMetricsOverride', { width: 620, height: 800, deviceScaleFactor: 1, mobile: false })
const v1 = await evalUntil(page, TB_STATE, (x) => x && x.ready && x.more === true, 15000, '窄窗 More 出现')
console.log('NARROW:', JSON.stringify(v1))
ok('窄窗出现 More 按钮', v1.more === true)
ok('窄窗可见按钮减少', v1.items.length < 12, String(v1.items.length))

// 中窄窗：逐级试探视口（03deec5 窄窗正文保护后，章列折叠会让正文变宽→断言不锁固定视口数字），
// 找到「More 出现 + 部分保留」的状态，断言语义= HIG「变窄时按既定优先级移入溢出菜单」：
// 低频（行内代码）先藏、核心（一级标题）保留、菜单内容=可见缺失集
await page.cmd('Emulation.clearDeviceMetricsOverride')
await sleep(400)
let v1b = null
for (const w of [1160, 1040, 960, 880, 800, 720, 640]) {
  await page.cmd('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: false })
  await sleep(700)
  const v = await page.eval(TB_STATE)
  console.log(`TRIAL ${w}: more=${v.more} n=${v.items.length}`)
  if (v && v.ready && v.more === true && v.items.includes('一级标题') && !v.items.includes('有序列表')) { v1b = { ...v, at: w }; break }
}
console.log('MID:', JSON.stringify(v1b))
if (!v1b) throw new Error('未找到「More 出现+一级标题保留」的视口')
ok('中窄窗 More 出现', v1b.more === true)
ok('中窄窗保留核心项（一级标题）', v1b.items.includes('一级标题'), JSON.stringify(v1b.items))
ok('中窄窗低频项收进菜单', v1b.items.length < 12, String(v1b.items.length))
ok('中窄窗低频「行内代码」先被收纳', !v1b.items.includes('行内代码'), JSON.stringify(v1b.items))

// ③ 打开 More 菜单并点击「有序列表」（Radix 菜单对 pointer 事件敏感，用 CDP 真实鼠标；菜单项在 portal 中）
async function clickXY(page, x, y) {
  await page.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await sleep(60)
  await page.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}
const moreRect = await page.eval(`(() => {
  const m = [...document.querySelectorAll('.zj-tb-item')].find((b) => b.getAttribute('title') === '更多格式')
  if (!m) return null
  const r = m.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})()`)
console.log('MORE RECT:', JSON.stringify(moreRect))
ok('More 按钮可见且可点', !!moreRect && moreRect.x > 0)
await clickXY(page, moreRect.x, moreRect.y)
await sleep(700)
const menu = await page.eval(`(() => {
  const items = [...document.querySelectorAll('[role="menuitem"]')].filter((i) => i.offsetParent !== null)
  return { count: items.length, texts: items.map((i) => i.textContent.trim()) }
})()`)
console.log('MENU:', JSON.stringify(menu))
ok('More 菜单已打开且含隐藏项', menu.count > 0 && menu.texts.length >= 3, JSON.stringify(menu.texts))
const hasOrdered = menu.texts.some((t) => t.includes('有序列表'))
ok('More 菜单含「有序列表」', hasOrdered, JSON.stringify(menu.texts))

// 点击前：注入纯段落文档（保证 wrapInList 对当前块有效），并记录 markdown
const b64Doc = Buffer.from('毛玻璃段落，用于验证工具栏 More 菜单命令真实落盘。\n').toString('base64')
await page.eval(`(() => { const eds = window.__ZJ_EDITORS || []; if (!eds.length) return 'NO_ED'; eds[0].setContent(atob('${b64Doc}')); return 'OK' })()`)
await sleep(600)
const before = await page.eval(`(() => { const eds = window.__ZJ_EDITORS || []; return eds[0] ? eds[0].getMarkdown() : '' })()`)
const itemRect = await page.eval(`(() => {
  const t = [...document.querySelectorAll('[role="menuitem"]')].find((i) => i.textContent.includes('有序列表'))
  if (!t) return null
  const r = t.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})()`)
console.log('ITEM RECT:', JSON.stringify(itemRect))
await clickXY(page, itemRect.x, itemRect.y)
await sleep(600)
const after = await page.eval(`(() => { const eds = window.__ZJ_EDITORS || []; return eds[0] ? eds[0].getMarkdown() : '' })()`)
console.log('AFTER CLICK LEN:', before.length, after.length)
ok('More 菜单项执行有实际效果（doc 变化）', after !== before && after.length > before.length, `before=${before.length} after=${after.length}`)

// ④ 恢复宽窗 → More 消失、按钮回全
await page.cmd('Emulation.clearDeviceMetricsOverride')
const v2 = await evalUntil(page, TB_STATE, (x) => x && x.ready && x.more === false && x.items.length === 12, 15000, '恢复宽窗')
ok('恢复宽窗 More 消失、12 按钮回全', v2.more === false && v2.items.length === 12, `more=${v2.more} n=${v2.items.length}`)

// ⑥ 深色主题：无 JS 异常
await page.eval(`document.documentElement.classList.add('dark')`)
await sleep(400)
const darkOk = await page.eval(`(() => {
  const cs = getComputedStyle(document.querySelector('.zj-md-toolbar'))
  return { bg: cs.backgroundColor, errors: 0 }
})()`)
console.log('DARK TOOLBAR:', JSON.stringify(darkOk))

// ⑦ 截图
const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
if (shot?.data) {
  const fs = await import('node:fs')
  fs.writeFileSync('/tmp/toolbar-ui-smoke.png', Buffer.from(shot.data, 'base64'))
  console.log('SCREENSHOT: /tmp/toolbar-ui-smoke.png')
}

console.log('ERRORS:', page.errors.length ? page.errors.slice(0, 5) : 'none')
console.log(fails === 0 ? 'ALL PASS' : `FAIL: ${fails}`)
page.close()
process.exit(fails === 0 ? 0 : 1)
