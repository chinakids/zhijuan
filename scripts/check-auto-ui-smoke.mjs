// 织卷无头冒烟 · 检查自动化收口后的 UI 走查（2026-10-29 体验层，W44 封版验收预演·双线中篇写作面）
// 背景：20dfad7 把「检查」收成统一入口（工具栏 + 提案抽屉菜单 + 保存后 4s 自动跑→提案），
//       这套新面未经体验层走查。本轮走查四点：
//   ① 工具栏「检查」与既有工具图标并排是否拥挤（1440 / 1000 两档，是否溢出/被挤掉）
//   ② 提案抽屉「检查」菜单：空态（0 提案）可达性、开关语义是否可播报（aria-checked）、切换是否文字位移
//   ③ 保存后自动检查的反馈可见性（作者是否知道「刚才是自动检查带来的」、去哪看）
//   ④ 窄窗（1000）与深色下的菜单/抽屉排版
// 修复项：菜单开关改 DropdownMenuCheckboxItem（role=menuitemcheckbox + aria-checked + 引导位勾选，文字不位移）；
//        自动检查 toast「自动检查完成 / 新增 N 条提案，可在左侧「提案」查看」（自动 vs 手动可分辨 + 给落点）；
//        抽屉空态补「与自动检查」（说明提案来源不止切片同步）。
// 用法：node scripts/check-auto-ui-smoke.mjs   （需 out/renderer 已 build + SPA server 8123 + CDP 9224）
import { writeFileSync } from 'node:fs'
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const HM = new Date().toTimeString().slice(0, 5).replace(':', '')
const SHOT_DIR = process.env.HOME + '/Pictures/zhijuan/'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function openTab(url) { const r = await fetch(CDP + '/json/new?' + encodeURIComponent(url), { method: 'PUT' }); return r.json() }
function attach(wsUrl) {
  const ws = new WebSocket(wsUrl); let seq = 0; const p = new Map(); const errors = []
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); return }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params?.exceptionDetails?.exception?.description || JSON.stringify(m.params?.exceptionDetails || {}).slice(0, 200))
    if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') errors.push((m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200))
  }
  const cmd = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; p.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result))); ws.send(JSON.stringify({ id, method, params })) })
  return new Promise((res) => {
    ws.onopen = async () => {
      const page = { cmd, errors, eval: async (expression) => { const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('EVAL ' + JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result?.value } }
      try { await cmd('Runtime.enable') } catch {}
      res(page)
    }
  })
}
async function evalUntil(page, expr, pred, timeoutMs = 12000, label = expr) {
  const t0 = Date.now()
  for (;;) { try { const v = await page.eval(expr); if (pred(v)) return v } catch {} if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT ' + label); await sleep(250) }
}
let fail = 0
const ok = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' | ' + x : '')); if (!c) fail++ }
const shot = async (page, name) => { const s = await page.cmd('Page.captureScreenshot', { format: 'png' }); writeFileSync(SHOT_DIR + name, Buffer.from(s.data, 'base64')); console.log('SHOT ' + SHOT_DIR + name) }
// Radix 菜单/触发器需要真实 pointer 序列（programmatic click 不开菜单）
const clickSel = (sel) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; const o = { bubbles: true, cancelable: true, pointerType: 'mouse' }; el.dispatchEvent(new PointerEvent('pointerdown', o)); el.dispatchEvent(new PointerEvent('pointerup', o)); el.click(); return true })()`
const openMenu = `(() => { const t = document.querySelector('[data-testid="audit-settings"]'); if (!t) return false; const o = { bubbles: true, cancelable: true, pointerType: 'mouse' }; t.dispatchEvent(new PointerEvent('pointerdown', o)); t.dispatchEvent(new PointerEvent('pointerup', o)); t.click(); return true })()`
// 菜单项：role + aria-checked + 标签首字（「保存后自动检查」的「保」）相对视口左缘 x —— 用来证明勾选不以文字前缀实现（切换不位移）
const menuInfo = `(() => {
  const els = [...document.querySelectorAll('[role="menuitemcheckbox"],[role="menuitem"]')]
  return els.map((el) => {
    const roles = el.getAttribute('role')
    const checked = el.getAttribute('aria-checked')
    const text = (el.innerText || '').trim()
    let labelLeft = null
    for (const n of el.childNodes) {
      if (n.nodeType !== 3) continue
      const i = n.textContent.indexOf('保存后自动检查')
      if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1); labelLeft = Math.round(r.getBoundingClientRect().left) }
    }
    return { role: roles, checked, text, labelLeft }
  })
})()`
const menuBg = `(() => { const m = document.querySelector('[role="menu"]'); if (!m) return null; const s = getComputedStyle(m); return { bg: s.backgroundColor, color: s.color } })()`
const clickItemByText = (t) => `(() => { const el = [...document.querySelectorAll('[role="menuitemcheckbox"],[role="menuitem"]')].find(x => (x.innerText||'').includes(${JSON.stringify(t)})); if (!el) return false; const o = { bubbles: true, cancelable: true, pointerType: 'mouse' }; el.dispatchEvent(new PointerEvent('pointerdown', o)); el.dispatchEvent(new PointerEvent('pointerup', o)); el.click(); return true })()`
const openDrawer = `(() => { const b = document.querySelector('[data-testid="nav-proposals"]') || [...document.querySelectorAll('button')].find(x => /待确认提案|已过期提案/.test(x.innerText || '')); if (b) { b.click(); return true } return false })()`

async function boot(projectId, opts = {}) {
  const tab = await openTab(BASE)
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, `typeof window.zhijuan?.listChapters === 'function'`, (v) => v === true, 20000, 'zhijuan 就绪')
  await page.eval(`window.zhijuan.setSettings({ guideEnabled: false, theme: 'paper', auditAuto: { enabled: true, ai: false } })`)
  await page.eval(`(location.hash = '#/project/${projectId}/novel', 1)`)
  await sleep(1800)
  if (opts.selectFirst) {
    await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => /第1章/.test(x.innerText || '')); if (b) { b.click(); return true } return false })()`)
    await sleep(1500)
  }
  return { tab, page }
}

// ── A/B：工具栏检查入口 + 提案抽屉「检查」菜单（demo-order 冷启动 0 提案） ──
{
  const { tab, page } = await boot('demo-order', { selectFirst: true })
  try {
    // A 工具栏入口
    const wide = await page.eval(`(() => {
      const btn = document.querySelector('[data-testid="audit-open"]')
      const bar = document.querySelector('.zj-md-toolbar')
      return { has: !!btn, text: (btn?.innerText || '').trim(), sw: bar?.scrollWidth, cw: bar?.clientWidth }
    })()`)
    ok('A1 正文工具栏有「检查」入口（带文字）', wide.has && /检查/.test(wide.text), JSON.stringify(wide))
    ok('A2 宽窗工具栏零横向溢出', wide.sw <= wide.cw + 1, `sw=${wide.sw} cw=${wide.cw}`)
    await page.eval(clickSel('[data-testid="audit-open"]'))
    const opened = await evalUntil(page, `!!document.querySelector('[data-testid="audit-kind-select"]')`, (v) => v === true, 6000, '审计抽屉打开').catch(() => false)
    ok('A3 点「检查」开审计抽屉（本地 9 类 + AI 3 类同处）', opened === true)
    await shot(page, `check-auto-toolbar-${HM}.png`)
    await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await sleep(600)
    // A4 窄窗 1000
    await page.cmd('Emulation.setDeviceMetricsOverride', { width: 1000, height: 760, deviceScaleFactor: 1, mobile: false })
    await sleep(900)
    const narrow = await page.eval(`(() => {
      const btn = document.querySelector('[data-testid="audit-open"]')
      const bar = document.querySelector('.zj-md-toolbar')
      return { has: !!btn, sw: bar?.scrollWidth, cw: bar?.clientWidth }
    })()`)
    ok('A4 窄窗 1000「检查」仍在工具栏且零溢出', narrow.has && narrow.sw <= narrow.cw + 1, JSON.stringify(narrow))
    await page.cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    await sleep(700)

    // B 抽屉 + 检查菜单
    const drawerOpened = await page.eval(openDrawer)
    await sleep(1000)
    const empty = await page.eval(`(() => { const d = document.querySelector('[role="dialog"][aria-label="提案"]'); return d ? d.innerText : '' })()`)
    ok('B1 0 提案时抽屉空态说明含「自动检查」（提案来源交代完整）', drawerOpened === true && /还没有提案/.test(empty) && /自动检查/.test(empty), empty.replace(/\n/g, ' / ').slice(0, 160))

    await page.eval(openMenu)
    await sleep(700)
    const on = await evalUntil(page, menuInfo, (v) => Array.isArray(v) && v.length >= 3, 6000, '检查菜单打开')
    const cb = on.filter((i) => i.role === 'menuitemcheckbox')
    ok('B2 两个开关为 menuitemcheckbox（读屏可播报开/关）', cb.length === 2, JSON.stringify(on))
    ok('B3 勾选状态与设置一致（自动检查开 / AI 巡读关）', cb[0]?.checked === 'true' && cb[1]?.checked === 'false', JSON.stringify(cb.map((i) => i.checked)))
    ok('B4 勾选改用引导位图标，标签无「✓ 」文字前缀', !on.some((i) => /^✓|✓ /.test(i.text)), JSON.stringify(on.map((i) => i.text)))
    ok('B5 「立即检查一次」仍为普通 menuitem', on.some((i) => i.role === 'menuitem' && /立即检查一次/.test(i.text)))
    const onLeft = cb[0]?.labelLeft
    await shot(page, `check-auto-menu-${HM}.png`)

    // 关掉自动检查 → 落盘 + 重开菜单看勾选与文字位置
    await page.eval(clickItemByText('保存后自动检查'))
    await sleep(800)
    const cfgOff = await page.eval(`(async () => ((await window.zhijuan.getSettings()) || {}).auditAuto)()`)
    ok('B6 点击开关保存到设置（enabled=false 落盘）', cfgOff?.enabled === false, JSON.stringify(cfgOff))
    await page.eval(openMenu)
    await sleep(700)
    const off = await evalUntil(page, menuInfo, (v) => Array.isArray(v) && v.length >= 3, 6000, '菜单重开')
    const offCb = off.filter((i) => i.role === 'menuitemcheckbox')
    ok('B7 重开后勾选随设置变化（aria-checked=false）', offCb[0]?.checked === 'false', JSON.stringify(offCb.map((i) => i.checked)))
    ok('B8 切换前后标签左缘不位移（勾选不占文字位）', onLeft != null && offCb[0]?.labelLeft != null && Math.abs(onLeft - offCb[0].labelLeft) <= 1, `on=${onLeft} off=${offCb[0]?.labelLeft}`)
    // 恢复开启（后续 C 段复验保存后自动跑）
    await page.eval(clickItemByText('保存后自动检查'))
    await sleep(800)
    const cfgOn = await page.eval(`(async () => ((await window.zhijuan.getSettings()) || {}).auditAuto)()`)
    ok('B9 再点一次恢复自动检查（enabled=true 落盘）', cfgOn?.enabled === true, JSON.stringify(cfgOn))

    // 手动「立即检查一次」：反馈与列表刷新（自动/手动两条路径文案可分辨）
    await page.eval(openMenu)
    await sleep(600)
    await page.eval(clickItemByText('立即检查一次'))
    const toastText = await evalUntil(page, `[...document.querySelectorAll('[role="status"],[role="alert"]')].map(x => x.innerText).filter(Boolean).join(' | ')`, (v) => /检查/.test(v || ''), 8000, '手动检查 toast')
    ok('B10 手动检查反馈为「检查完成」（与自动路径可分辨）', /检查完成/.test(toastText) && !/自动检查完成/.test(toastText), toastText.replace(/\n/g, ' / '))
    const cards = await evalUntil(page, `[...document.querySelectorAll('[data-pid]')].map(c => c.innerText.replace(/\\n/g, ' | '))`, (v) => Array.isArray(v) && v.length > 0, 8000, '提案卡出现')
    ok('B11 检查产出的提案在抽屉内立即可见（含「来自：检查」）', cards.some((c) => /来自：检查/.test(c)), `cards=${cards.length}`)
  } catch (e) {
    console.error('FATAL A/B: ' + e.message); fail++
  } finally {
    try { await fetch(CDP + '/json/close/' + tab.id) } catch {}
  }
}

// ── C：保存 → 4s 自动检查的作者可见反馈（独立 tab = 独立 devShim 内存，保证 created>0） ──
{
  const { tab, page } = await boot('demo-order', { selectFirst: true })
  try {
    const before = await page.eval(`[...document.querySelectorAll('button')].map(b => b.innerText).filter(t => /提案/.test(t))`)
    await page.eval(`(async () => {
      const ed = window.__ZJ_EDITORS?.[0]
      if (ed) ed.applyMarkdown(ed.getMarkdown() + '\\n\\n潮水退去时，他在码头数着第七个浪。')
      await new Promise(r => setTimeout(r, 400))
      const btn = [...document.querySelectorAll('button')].find(b => /保存/.test(b.innerText || ''))
      if (btn) btn.click()
      return true
    })()`)
    const toast = await evalUntil(page, `[...document.querySelectorAll('[role="status"],[role="alert"]')].map(x => x.innerText).filter(Boolean).join(' | ')`, (v) => /检查/.test(v || ''), 12000, '自动检查 toast')
    ok('C1 保存后自动检查有可见反馈（不是默默多出提案）', /自动检查完成/.test(toast), toast.replace(/\n/g, ' / '))
    ok('C2 反馈点明落点（可在左侧「提案」查看）', /提案/.test(toast) && /查看/.test(toast), toast.replace(/\n/g, ' / '))
    const badge = await evalUntil(page, `[...document.querySelectorAll('button')].map(b => b.innerText).filter(t => /提案/.test(t))`, (v) => Array.isArray(v) && v.some((t) => /待确认提案/.test(t)), 6000, '导航提案角标')
    ok('C3 左侧提案入口出现待确认角标（计数可点入）', badge.some((t) => /待确认提案/.test(t)), `before=${JSON.stringify(before)} after=${JSON.stringify(badge)}`)
    await shot(page, `check-auto-toast-${HM}.png`)
  } catch (e) {
    console.error('FATAL C: ' + e.message); fail++
  } finally {
    try { await fetch(CDP + '/json/close/' + tab.id) } catch {}
  }
}

// ── D：窄窗 + 深色（抽屉头不挤、菜单可读） ──
{
  const { tab, page } = await boot('demo-aseya', { selectFirst: true })
  try {
    await page.cmd('Emulation.setDeviceMetricsOverride', { width: 1000, height: 760, deviceScaleFactor: 1, mobile: false })
    await sleep(800)
    await page.eval(openDrawer)
    await sleep(1000)
    const head = await page.eval(`(() => {
      const d = document.querySelector('[role="dialog"][aria-label="提案"]')
      const h = d?.querySelector('.h-12')
      const b = document.querySelector('[data-testid="audit-settings"]')
      const br = b?.getBoundingClientRect(); const dr = d?.getBoundingClientRect()
      return { open: !!d, sw: h?.scrollWidth, cw: h?.clientWidth, inside: br && dr ? br.right <= dr.right + 1 : null }
    })()`)
    ok('D1 窄窗 1000 抽屉头零溢出、检查按钮在抽屉内', head.open && head.sw <= head.cw + 1 && head.inside === true, JSON.stringify(head))
    // 深色：给根节点加 dark（tokens 双主题同源）
    const lightBg = (await (async () => { await page.eval(openMenu); await sleep(700); return page.eval(menuBg) })())?.bg
    await page.eval(`document.documentElement.classList.add('dark')`)
    await sleep(400)
    const darkBg = await page.eval(menuBg)
    const lum = (rgb) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb || ''); if (!m) return null; return (0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) / 255 }
    ok('D2 深色主题下菜单背景随 tokens 变暗（非固定浅底）', !!darkBg && lum(darkBg.bg) != null && lum(darkBg.bg) < 0.4 && darkBg.bg !== lightBg, `light=${lightBg} dark=${darkBg?.bg}`)
    ok('D3 深色下菜单文字为浅色（对比可读）', (lum(darkBg?.color) ?? 0) > 0.5, `color=${darkBg?.color}`)
    await shot(page, `check-auto-menu-dark-${HM}.png`)
    await page.eval(`document.documentElement.classList.remove('dark')`)
    ok('D4 全程零 JS 异常', page.errors.length === 0, page.errors.slice(0, 2).join(' / '))
  } catch (e) {
    console.error('FATAL D: ' + e.message); fail++
  } finally {
    try { await fetch(CDP + '/json/close/' + tab.id) } catch {}
  }
}

console.log('RESULT ' + (fail ? fail + ' FAIL' : 'ALL OK'))
process.exit(fail ? 1 : 0)