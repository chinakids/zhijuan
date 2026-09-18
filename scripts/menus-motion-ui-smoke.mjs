// 织卷无头冒烟 · 菜单进场动画 & reduced-motion 覆盖面 & 提案按钮图标尺寸（体验层 2026-09-19 02:15 轮）
// 用法：node scripts/menus-motion-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs；本机专用无头 Chrome CDP 127.0.0.1:9224
// 背景：V-04/V-08 剩余项核对——09-12 后新增 UI 的漂移检查。本脚本覆盖三个实缺修复：
//   ① DropdownMenuContent 进场动画（100ms 纯淡入，动效分层.md 通道 A 高频浮层口径）；
//   ② prefers-reduced-motion 下：菜单/开关/chevron 过渡关闭（motion-reduce:transition-none）；
//   ③ ProposalDrawer「扫描批注」紧凑按钮图标由 16px 死代码归位到容器 12px（[&_svg]:size-3）。
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
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
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
      await cmd('Page.enable')
      res({
        cmd,
        errors,
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
    } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(300)
  }
}
const bodyHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
const clickBtn = (text, exact = true) => `(() => {
  const els = [...document.querySelectorAll('button')]
  const el = els.find((b) => ${exact ? `(b.innerText || '').trim() === ${JSON.stringify(text)}` : `(b.innerText || '').includes(${JSON.stringify(text)})`})
  if (!el) return false
  el.click()
  return true
})()`
// Radix DropdownMenu 程序化开启必须 pointerdown+pointerup+click 三连（trigger 监听 pointer 事件）
const openMenuByTitle = (title) => `(() => {
  const el = [...document.querySelectorAll('button')].find((b) => b.title === ${JSON.stringify(title)} || b.getAttribute('aria-label') === ${JSON.stringify(title)})
  if (!el) return false
  const r = el.getBoundingClientRect()
  for (const type of ['pointerdown', 'pointerup', 'click']) {
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'mouse', clientX: r.x + 4, clientY: r.y + 4, button: 0 }))
  }
  return true
})()`

let pass = 0
let fail = 0
function ok(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log('PASS ' + name)
  } else {
    fail++
    console.log('FAIL ' + name + (extra ? ' | ' + extra : ''))
  }
}

// ============ ① 菜单进场动画 + reduced-motion ============
const tab = await openTab(BASE + '/#/?cb=menus-motion')
const page = await attach(tab.webSocketDebuggerUrl)
await evalUntil(page, bodyHas('新建项目'), Boolean, 20000, '首页加载')
ok('首页加载（含新建项目入口）', true)

await page.eval(openMenuByTitle('更多操作'))
await evalUntil(page, `document.querySelectorAll('[role="menu"]').length`, (v) => Number(v) > 0, 10000, '菜单出现')
const menuAnim = await page.eval(`(() => {
  const m = document.querySelector('[role="menu"]')
  if (!m) return null
  const cs = getComputedStyle(m)
  return { name: cs.animationName, dur: cs.animationDuration }
})()`)
ok('菜单 animationName=enter', menuAnim && menuAnim.name === 'enter', JSON.stringify(menuAnim))
ok('菜单 duration=0.1s（高频浮层口径）', menuAnim && menuAnim.dur === '0.1s', JSON.stringify(menuAnim))

// reduced-motion 下菜单动画关闭（tokens.css [class*='animate-in'] 覆盖；Radix data-state 变体也在 class 里）
await page.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
await sleep(200)
const menuRed = await page.eval(`(() => {
  const m = document.querySelector('[role="menu"]')
  if (!m) return null
  return getComputedStyle(m).animationName
})()`)
ok('reduced-motion：菜单 animationName=none', menuRed === 'none', String(menuRed))
await page.cmd('Emulation.setEmulatedMedia', { features: [] })

// ============ ② 提案抽屉「扫描批注」按钮图标 ============
await page.eval(`(() => { location.hash = '#/project/demo-aseya/settings'; return 1 })()`)
await evalUntil(page, bodyHas('外观与数据'), Boolean, 20000, '设置页加载')
await page.eval(clickBtn('外观与数据', false))
await evalUntil(page, bodyHas('批注定时优化'), Boolean, 10000, '外观节批注开关')
const sw1 = await page.eval(`(() => {
  const rows = [...document.querySelectorAll('div')].filter((d) => d.textContent && d.textContent.includes('批注定时优化') && d.querySelector('button[role="switch"]'))
  const row = rows[rows.length - 1]
  const s = row && row.querySelector('button[role="switch"]')
  if (!s) return 'NO_SWITCH'
  if (s.getAttribute('aria-checked') !== 'true') s.click()
  return 'OK'
})()`)
ok('设置页存在「批注定时优化」开关', sw1 === 'OK', String(sw1))

// 正常态 vs reduced-motion 下开关 thumb 过渡（motion-reduce:transition-none → transition-property:none；duration 值仍 0.15s 属正常，属性清单为 none 即无过渡）
const thumbNormal = await page.eval(`(() => {
  const s = document.querySelector('button[role="switch"]')
  const t = s && s.querySelector('span[data-state]')
  if (!t) return 'NO_THUMB'
  return getComputedStyle(t).transitionProperty
})()`)
ok('正常态：开关 thumb 有 transform 过渡', (thumbNormal || '').includes('transform'), String(thumbNormal))
await page.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
await sleep(200)
const thumbRed = await page.eval(`(() => {
  const s = document.querySelector('button[role="switch"]')
  const t = s && s.querySelector('span[data-state]')
  if (!t) return 'NO_THUMB'
  return getComputedStyle(t).transitionProperty
})()`)
ok('reduced-motion：开关 thumb transitionProperty=none', thumbRed === 'none', String(thumbRed))
await page.cmd('Emulation.setEmulatedMedia', { features: [] })
await page.eval(clickBtn('保存设置'))
await sleep(600)

// 回正文等自动首扫生成批注提案 → 顶栏入口 → 抽屉
await page.eval(`(() => { location.hash = '#/project/demo-aseya/novel'; return 1 })()`)
await evalUntil(page, bodyHas('第1章'), Boolean, 20000, '正文载入')
await evalUntil(
  page,
  `window.zhijuan.listProposals('demo-aseya').then((ps) => ps.filter((p) => p.source === 'annotation-sync').length)`,
  (v) => Number(v) >= 2,
  30000,
  '自动扫描生成批注提案'
)
await evalUntil(page, bodyHas('待确认提案'), Boolean, 10000, '待确认提案入口')
await page.eval(clickBtn('待确认提案', false))
await evalUntil(page, bodyHas('扫描批注'), Boolean, 10000, '抽屉扫描按钮')
const iconW = await page.eval(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').includes('扫描批注'))
  const svg = b && b.querySelector('svg')
  if (!svg) return -1
  return Math.round(svg.getBoundingClientRect().width * 10) / 10
})()`)
ok('「扫描批注」图标=12px（紧凑按钮 [&_svg]:size-3）', iconW === 12, 'w=' + iconW)

// ============ 截图（供主人确认） ============
try {
  const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
  if (shot && shot.data) {
    const fs = await import('node:fs')
    const d = new Date()
    const hhmm = String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0')
    fs.mkdirSync(process.env.HOME + '/Pictures/zhijuan', { recursive: true })
    fs.writeFileSync(process.env.HOME + '/Pictures/zhijuan/proposal-icon-' + hhmm + '.png', Buffer.from(shot.data, 'base64'))
    console.log('SHOT proposal-icon-' + hhmm + '.png')
  }
} catch (e) {
  console.log('SHOT_SKIP ' + e.message)
}
try {
  await page.eval(`(() => { location.hash = '#/'; return 1 })()`)
  await evalUntil(page, bodyHas('新建项目'), Boolean, 20000, '回首页')
  await page.eval(openMenuByTitle('更多操作'))
  await evalUntil(page, `document.querySelectorAll('[role="menu"]').length`, (v) => Number(v) > 0, 10000, '菜单再现')
  const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
  if (shot && shot.data) {
    const fs = await import('node:fs')
    const d = new Date()
    const hhmm = String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0')
    fs.mkdirSync(process.env.HOME + '/Pictures/zhijuan', { recursive: true })
    fs.writeFileSync(process.env.HOME + '/Pictures/zhijuan/menu-open-' + hhmm + '.png', Buffer.from(shot.data, 'base64'))
    console.log('SHOT menu-open-' + hhmm + '.png')
  }
} catch (e) {
  console.log('SHOT_SKIP ' + e.message)
}

console.log('JS_ERRORS=' + JSON.stringify(page.errors))
if (page.errors.length) fail += page.errors.length
console.log((fail === 0 ? 'ALL_PASS ' : 'FAILED ') + pass + '/' + (pass + fail))
process.exit(fail === 0 ? 0 : 1)
