// 织卷无头冒烟 · 正文页章节列按时间线筛选（多时间线叙事体验层，封版目标① 双线中篇动线）
// 用法：node scripts/chapter-line-filter-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；本机无头 Chrome CDP 127.0.0.1:9224
// 断言面：① 多线项目（demo-order）章列出现线筛选 chips（全部/主线·3/过去线·3）且默认全部 6 章；
//   ② 选「过去线」→ 仅第2/4/6章、保持阅读序；③ 回到全部 → 6 章；④ 键盘 ←/→/Home/End 选中与焦点同步 + roving tabindex；
//   ⑤ sticky 常驻（滚动后 chips 仍在容器可视区）；⑥ 单线项目（demo-aseya）零打扰（无 chips、章数不变）；
//   ⑦ 窄窗 1000×700 折叠后抽屉内 chips 可用且零横向溢出；⑧ 深色主题可用；⑨ 全程零 JS 异常。
import { writeFileSync, mkdirSync } from 'node:fs'
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const OUT = process.env.HOME + '/Pictures/zhijuan'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const cb = Date.now()
let fails = 0
function ok(name, cond, detail = '') {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + String(detail).slice(0, 200) : ''))
  if (!cond) fails++
}
async function openTab(url) {
  const r = await fetch(CDP + '/json/new?' + encodeURIComponent(url), { method: 'PUT' })
  return r.json()
}
function attach(wsUrl) {
  const ws = new WebSocket(wsUrl); let seq = 0; const pending = new Map(); const errors = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails?.exception?.description ?? '').slice(0, 200))
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push((m.params.args?.map((a) => a.value ?? a.description ?? '').join(' ') ?? '').slice(0, 200))
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const cmd = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq; pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
  return new Promise((res) => {
    ws.onopen = async () => {
      await cmd('Runtime.enable')
      res({
        cmd, errors,
        eval: async (expression) => {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 250))
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
    try { const v = await page.eval(expr); if (pred(v)) return v } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(300)
  }
}
async function shot(page, name) {
  mkdirSync(OUT, { recursive: true })
  const hh = String(new Date().getHours()).padStart(2, '0')
  const mm = String(new Date().getMinutes()).padStart(2, '0')
  const s = await page.cmd('Page.captureScreenshot', { format: 'png' })
  const p = OUT + '/' + name + '-' + hh + mm + '.png'
  writeFileSync(p, Buffer.from(s.data, 'base64'))
  console.log('SCREENSHOT:', p)
}
// 章列状态快照：chips（文本/选中/data-line/tabindex）+ 章行标题（只取「第N章 · 题名」行）
const snap = (root = '[data-testid="chapter-sidebar"]') => `(() => {
  const r = document.querySelector('${root}')
  if (!r) return { root: false }
  const tabs = [...r.querySelectorAll('[role=tab]')].map((t) => ({
    t: (t.innerText || '').trim(), line: t.getAttribute('data-line'),
    sel: t.getAttribute('aria-selected') === 'true', ti: t.getAttribute('tabindex')
  }))
  const chs = [...r.querySelectorAll('button')]
    .map((b) => (b.innerText || '').replace(/\\s+/g, ' ').trim())
    .filter((t) => /第\\d+章 ·/.test(t))
    .map((t) => t.match(/第\\d+章 · [^\\s·]+/)[0])
  const tl = r.querySelector('[data-testid="chapter-line-filter"]')
  // sticky 容器（2026-10-27 起 chips 与「当前章不在镜头内」说明同处一个 sticky wrapper；取容器计算样式）
  const lensWrap = r.querySelector('[data-testid="chapter-line-lens"]') ?? tl
  const cs = lensWrap ? getComputedStyle(lensWrap) : null
  return {
    root: true, tabs, chs,
    tablist: !!tl,
    sticky: cs ? cs.position : null,
    overflow: tl ? tl.scrollWidth > tl.clientWidth + 1 : null
  }
})()`
const clickTab = (line) => `(() => {
  const t = [...document.querySelectorAll('[data-testid="chapter-line-filter"] [role=tab]')].find((x) => x.getAttribute('data-line') === ${JSON.stringify(line)})
  if (!t) return false
  t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  t.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  t.click(); return true
})()`
const keyOn = (key) => `(() => {
  const t = document.querySelector('[data-testid="chapter-line-filter"] [role=tab][tabindex="0"]')
  if (!t) return { ok: false }
  t.focus()
  t.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }))
  return { ok: true }
})()`
const focusState = `(() => {
  const a = document.activeElement
  const sel = [...document.querySelectorAll('[data-testid="chapter-line-filter"] [role=tab]')].find((x) => x.getAttribute('aria-selected') === 'true')
  const zeros = [...document.querySelectorAll('[data-testid="chapter-line-filter"] [role=tab]')].filter((x) => x.getAttribute('tabindex') === '0')
  return { focus: a ? a.getAttribute('data-line') : null, sel: sel ? sel.getAttribute('data-line') : null, zero: zeros.length }
})()`

// ---------- ① 多线项目 demo-order ----------
const tab = await openTab(BASE + '/#/project/demo-order/novel?cb=' + cb)
const p = await attach(tab.webSocketDebuggerUrl)
try {
  await evalUntil(p, `document.body.innerText.includes('第1章')`, (v) => v === true, 25000, '正文页就绪')

  let s = await p.eval(snap())
  ok('章列有 6 章（默认全部）', JSON.stringify(s.chs) === JSON.stringify(['第1章 · 晨港', '第2章 · 旧港', '第3章 · 灯塔', '第4章 · 长堤', '第5章 · 归航', '第6章 · 旧港之二']), JSON.stringify(s.chs))
  ok('多线项目出现线筛选 chips', s.tablist === true && s.tabs.map((t) => t.t).join('|') === '全部|主线 · 3|过去线 · 3', JSON.stringify(s.tabs.map((t) => t.t)))
  ok('默认选中「全部」且 roving tabindex 唯一', s.tabs[0]?.sel === true && s.tabs.filter((t) => t.ti === '0').length === 1, JSON.stringify(s.tabs.map((t) => [t.line, t.sel, t.ti])))
  ok('chips 行零横向溢出（窄列内换行不越界）', s.overflow === false, String(s.overflow))
  ok('chips 容器为 sticky（长章列表滚动常驻）', s.sticky === 'sticky', String(s.sticky))

  // ---------- ② 选「过去线」----------
  ok('点击「过去线」chip', (await p.eval(clickTab('过去线'))) === true)
  await sleep(350)
  s = await p.eval(snap())
  ok('过去线筛选=第2/4/6章（保持阅读序）', JSON.stringify(s.chs) === JSON.stringify(['第2章 · 旧港', '第4章 · 长堤', '第6章 · 旧港之二']), JSON.stringify(s.chs))
  ok('选中态转移到「过去线」', s.tabs.find((t) => t.line === '过去线')?.sel === true && s.tabs.find((t) => t.line === '__all__')?.sel === false, JSON.stringify(s.tabs.map((t) => [t.line, t.sel])))
  await shot(p, 'chapters-line-filter-past')

  // 筛选后仍可正常打开章节（镜头不影响章节数据）
  await p.eval(`(() => { const b = [...document.querySelectorAll('[data-testid="chapter-sidebar"] button')].find((x) => (x.innerText || '').includes('第4章 · 长堤')); if (b) b.click(); return !!b })()`)
  await sleep(700)
  const opened = await p.eval(`(() => {
    const b = [...document.querySelectorAll('[data-testid="chapter-sidebar"] button')].find((x) => (x.innerText || '').includes('第4章 · 长堤'))
    const list = document.querySelector('[data-testid="chapter-sidebar"]')
    const titles = [...(list?.querySelectorAll('h1,h2,[data-testid*="title"]') ?? [])].map((x) => (x.innerText || '').trim()).filter(Boolean)
    return { sel: b ? b.className.includes('accent-soft') : false, titles, editor: !!document.querySelector('.ProseMirror'), text: document.body.innerText.includes('雨夜的长堤') }
  })()`)
  ok('筛选态点章可照常打开（第4章选中+正文到位）', opened.sel === true && opened.editor === true && opened.text === true, JSON.stringify({ sel: opened.sel, editor: opened.editor, text: opened.text }))

  // ---------- ③/④ 键盘 ----------
  const kbA = await p.eval(keyOn('ArrowRight'))
  await sleep(200)
  let fs = await p.eval(focusState)
  ok('键盘 → 从「过去线」移到「全部」（循环）且焦点同步', kbA.ok === true && fs.sel === '__all__' && fs.focus === '__all__' && fs.zero === 1, JSON.stringify(fs))
  await p.eval(keyOn('End'))
  await sleep(200)
  fs = await p.eval(focusState)
  ok('键盘 End → 末条「过去线」', fs.sel === '过去线' && fs.focus === '过去线', JSON.stringify(fs))
  await p.eval(keyOn('Home'))
  await sleep(200)
  fs = await p.eval(focusState)
  s = await p.eval(snap())
  ok('键盘 Home → 「全部」且恢复 6 章', fs.sel === '__all__' && s.chs.length === 6, JSON.stringify(fs) + ' chs=' + s.chs.length)

  // ---------- ⑤ 滚动后 chips 仍可见 ----------
  const stickyVis = await p.eval(`(() => {
    const list = document.querySelector('[data-testid="chapter-sidebar"] > div:last-child')
    const tl = document.querySelector('[data-testid="chapter-line-filter"]')
    if (!list || !tl) return { ok: false }
    list.scrollTop = list.scrollHeight
    const a = tl.getBoundingClientRect(), b = list.getBoundingClientRect()
    return { ok: true, top: Math.round(a.top), listTop: Math.round(b.top), visible: a.top >= b.top - 1 && a.bottom <= b.bottom + 1 }
  })()`)
  ok('列滚动到底后 chips 仍贴在列顶可见', stickyVis.ok === true && stickyVis.visible === true, JSON.stringify(stickyVis))
  await p.eval(`(() => { const list = document.querySelector('[data-testid="chapter-sidebar"] > div:last-child'); if (list) list.scrollTop = 0; return true })()`)
  await sleep(200)

  // ---------- ⑥ 深色主题 ----------
  await p.eval(`document.documentElement.classList.add('dark')`)
  await sleep(300)
  const dark = await p.eval(`(() => {
    const t = document.querySelector('[data-testid="chapter-line-filter"] [aria-selected="true"]')
    const tl = document.querySelector('[data-testid="chapter-line-filter"]')
    if (!t || !tl) return { ok: false }
    const cs = getComputedStyle(t)
    return { ok: true, bg: cs.backgroundColor, color: cs.color, overflow: tl.scrollWidth > tl.clientWidth + 1 }
  })()`)
  ok('深色主题：选中 chip 用主题色填充、chips 零溢出', dark.ok === true && dark.bg !== 'rgba(0, 0, 0, 0)' && dark.overflow === false, JSON.stringify(dark))
  await shot(p, 'chapters-line-filter-dark')
  await p.eval(`document.documentElement.classList.remove('dark')`)
  await sleep(200)

  // ---------- ⑦ 窄窗 1000×700 → 章列折叠 → 抽屉内 chips ----------
  await p.cmd('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false })
  await sleep(700)
  const toggled = await p.eval(`document.querySelector('[data-testid="chapter-toggle"]') !== null`)
  ok('窄窗触发章列折叠（entry 条在）', toggled === true, String(toggled))
  if (toggled) {
    await p.eval(`(() => { const t = document.querySelector('[data-testid="chapter-toggle"]'); if (t) t.click(); return !!t })()`)
    await sleep(700)
    let d = await p.eval(snap('[data-testid="chapter-drawer"]'))
    ok('抽屉内出现线筛选 chips（默认全部 6 章）', d.tablist === true && d.chs.length === 6, JSON.stringify({ tabs: d.tabs?.length, chs: d.chs }))
    ok('抽屉 chips 零横向溢出', d.overflow === false, String(d.overflow))
    await p.eval(`(() => {
      const t = [...document.querySelectorAll('[data-testid="chapter-drawer"] [role=tab]')].find((x) => x.getAttribute('data-line') === '主线')
      if (t) t.click(); return !!t
    })()`)
    await sleep(350)
    d = await p.eval(snap('[data-testid="chapter-drawer"]'))
    ok('抽屉内筛选生效（主线=第1/3/5章）', JSON.stringify(d.chs) === JSON.stringify(['第1章 · 晨港', '第3章 · 灯塔', '第5章 · 归航']), JSON.stringify(d.chs))
    await shot(p, 'chapters-line-filter-narrow-drawer')
    await p.eval(`(() => { const x = document.querySelector('[data-testid="chapter-drawer"] [aria-label="关闭"]'); if (x) x.click(); return !!x })()`)
    await sleep(300)
  }
  await p.cmd('Emulation.clearDeviceMetricsOverride')
  await sleep(400)

  // ---------- ⑧ 单线项目零打扰 ----------
  await p.eval(`window.location.hash = '#/project/demo-aseya/novel'`)
  await sleep(1200)
  await evalUntil(p, `document.querySelector('[data-testid="chapter-sidebar"]') !== null`, (v) => v === true, 20000, '单线项目章列')
  const single = await p.eval(snap())
  ok('单线项目：无线筛选 chips（零打扰）', single.tablist === false, String(single.tablist))
  ok('单线项目：章行照常全量列出', single.chs.length >= 1, JSON.stringify(single.chs))

  ok('全程无 JS 异常', p.errors.length === 0, String(p.errors.slice(0, 2)))
} catch (e) {
  console.log('FATAL', String(e).slice(0, 400))
  fails++
}
console.log(fails === 0 ? 'ALL PASS' : 'FAIL: ' + fails)
p.close()
process.exit(fails === 0 ? 0 : 1)