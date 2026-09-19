// 织卷无头冒烟 · Home 页 HIG 走查基线（体验层 2026-09-19 08:15 轮）
// 验收点：① 卡片结构/aria（role=button+tabIndex+aria-label）；② 截断文本 title 全量（书名/简介/最近行/统计行）；
//         ③ Tab 序（搜索→导入→新建→卡片「更多操作」交替，无无关可聚焦项混入）；④ 卡片焦点环 2px accent（bringToFront 后）；
//         ⑤ hover 上浮（translate -y）与 press 按压变暗（active:brightness-95，颜色通道无位移）；
//         ⑥ 空态（?zj-empty=projects「还没有项目」）与错误态（?zj-fail-x=listProjects「读取项目库失败」+重试）；
//         ⑦ 1000×700 窄窗零横向溢出、工具条双按钮可点、网格 2 列；⑧ 全程零 JS 异常。
// 坑：devShim 参数在 location.search → URL 必须 ?zj-empty=.. #/（放 # 后无效）；无头页签 document.hasFocus()=false
//     → :focus-visible 不匹配，须 Page.bringToFront 后再断言焦点环。
import { writeFileSync, mkdirSync } from 'node:fs'

const CDP = 'http://127.0.0.1:9224'
const SPA = process.env.ZJ_SMOKE_BASE || 'http://127.0.0.1:8899'
let fail = 0
const ok = (cond, msg) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + msg)
  if (!cond) fail++
}

function makePage(url) {
  return new Promise(async (res2) => {
    const r = await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })
    const target = await r.json()
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    let seq = 0
    const pending = new Map()
    const errors = []
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m)
        pending.delete(m.id)
      } else if (m.method === 'Runtime.exceptionThrown') {
        errors.push('exc: ' + (m.params?.exceptionDetails?.exception?.description || '?'))
      } else if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
        errors.push('console: ' + (m.params?.args?.map((a) => a.value ?? a.description ?? '?').join(' ') || ''))
      }
    }
    function cmd(method, params = {}) {
      return new Promise((res3, rej) => {
        const id = ++seq
        pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res3(m.result)))
        ws.send(JSON.stringify({ id, method, params }))
      })
    }
    await new Promise((r) => (ws.onopen = r))
    await cmd('Runtime.enable')
    await cmd('Page.enable')
    await cmd('Page.navigate', { url })
    res2({ ws, cmd, errors })
  })
}
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
async function evalUntil(page, expr, timeout = 25000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const v = await evalJs(page, expr)
    if (v) return v
    await sleep(500)
  }
  throw new Error('timeout: ' + expr)
}
async function evalJs(page, expr) {
  const r = await page.cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error('eval ex: ' + JSON.stringify(r.exceptionDetails))
  return r.result?.value
}

// ---------- 主场景：首页全量走查 ----------
const P = await makePage(`${SPA}/#/?cb=${Date.now()}`)
await evalUntil(P, `document.querySelectorAll('[role="button"][aria-label^="打开项目"]').length > 0`)
console.log('== ① 卡片结构/aria ==')
const structure = await evalJs(P, `(() => {
  const c = document.querySelector('[role="button"][aria-label^="打开项目"]')
  return {
    role: c.getAttribute('role'), tab: c.getAttribute('tabindex'),
    aria: c.getAttribute('aria-label'), stats: !!c.querySelector('[data-testid="zj-card-stats"]')
  }
})()`)
ok(structure.role === 'button', `① 卡片 role=button (${structure.role})`)
ok(structure.tab === '0', `① 卡片 tabIndex=0 (${structure.tab})`)
ok(structure.aria.startsWith('打开项目 '), `① aria-label=打开项目 X (${structure.aria})`)
ok(structure.stats, `① 统计行 zj-card-stats 存在`)
console.log('== ② 截断文本 title 全量 ==')
const titles = await evalJs(P, `(() => {
  const c = document.querySelector('[role="button"][aria-label^="打开项目"]')
  const h2 = c.querySelector('h2'); const stats = c.querySelector('[data-testid="zj-card-stats"]')
  const desc = c.querySelector('.border-t p.truncate')
  const meta = c.querySelector('.border-t p.mt-1')
  return {
    nameTitle: h2.getAttribute('title'), nameText: h2.textContent,
    statsTitle: stats.getAttribute('title'),
    descTitle: desc?.getAttribute('title') ?? null, descText: desc?.textContent ?? '?',
    metaTitle: meta?.getAttribute('title') ?? null, metaText: meta?.textContent ?? '?'
  }
})()`)
ok(titles.nameTitle === titles.nameText, `② 书名 title=全量 («${titles.nameTitle}»)`)
ok(!!titles.statsTitle && titles.statsTitle.includes('章'), `② 统计行 title=全量 («${titles.statsTitle}»)`)
ok(titles.descTitle === titles.descText, `② 简介 title=全量 («${titles.descTitle}»)`)
ok(titles.metaTitle === titles.metaText, `② 最近行 title=全量 («${titles.metaTitle}»)`)
console.log('== ③ Tab 序 ==')
const order = await evalJs(P, `(() => {
  const sel = 'input[data-testid="home-search"], button[data-testid="home-import-dir"], button[data-testid="home-new-project"], [role="button"][aria-label^="打开项目"], button[aria-label="更多操作"]'
  return Array.from(document.querySelectorAll(sel)).map((el) => {
    if (el.getAttribute('role') === 'button' && (el.getAttribute('aria-label') || '').startsWith('打开项目')) return 'card'
    return el.dataset?.testid || el.getAttribute('aria-label') || '?'
  })
})()`)
ok(order[0] === 'home-search' && order[1] === 'home-import-dir' && order[2] === 'home-new-project',
  `③ 工具条可聚焦序=搜索→导入→新建 (${order.slice(0, 3).join('→')})`)
const cardCount = await evalJs(P, `document.querySelectorAll('[role="button"][aria-label^="打开项目"]').length`)
ok(order.length === 3 + cardCount * 2, `③ 可聚焦总数=工具条3+卡×2 (${order.length}=3+${cardCount}×2)`)
let altOk = true
for (let i = 3; i < order.length; i += 2) {
  if (order[i] !== 'card' || order[i + 1] !== '更多操作') { altOk = false; break }
}
ok(altOk, `③ 卡片与「更多操作」交替 (${order.slice(3).join(',')})`)
console.log('== ④ 焦点环 ==')
await P.cmd('Page.bringToFront')
await sleep(200)
const fv = await evalJs(P, `(() => {
  const c = document.querySelector('[role="button"][aria-label^="打开项目"]')
  c.focus()
  const s = getComputedStyle(c)
  return { ow: s.outlineWidth, os: s.outlineStyle, oc: s.outlineColor, m: c.matches(':focus-visible') }
})()`)
ok(fv.m && fv.os === 'solid' && parseFloat(fv.ow) >= 2, `④ 卡片焦点环 2px solid (${fv.ow} ${fv.os} · focus-visible=${fv.m})`)
ok(!!fv.oc && fv.oc.includes('0.65'), `④ 焦点环 accent 65% (${fv.oc.slice(0, 60)})`)
await evalJs(P, `document.activeElement && document.activeElement.blur()`)
console.log('== ⑤ hover 上浮 / press 按压 ==')
const rect = await evalJs(P, `(() => { const c = document.querySelector('[role="button"][aria-label^="打开项目"]'); const r = c.getBoundingClientRect(); return { x: r.x + 40, y: r.y + 40 } })()`)
await P.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y })
await sleep(300)
const hover = await evalJs(P, `(() => { const c = document.querySelector('[role="button"][aria-label^="打开项目"]'); return getComputedStyle(c).translate })()`)
const ty = parseFloat((hover.match(/-?\d+(\.\d+)?px$/) || ['0'])[0])
ok(ty < -1, `⑤ hover 上浮 translate-y=${hover} (${ty}px)`)
await P.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
await sleep(120)
const pressed = await evalJs(P, `(() => { const c = document.querySelector('[role="button"][aria-label^="打开项目"]'); return getComputedStyle(c).filter })()`)
const bm = pressed.match(/brightness\(([\d.]+)/)
ok(!!bm && parseFloat(bm[1]) < 1, `⑤ press 按压变暗 filter=${pressed}`)
// 释放点移到卡片外 → 不触发 click/导航
await P.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y + 500, button: 'left', clickCount: 1 })
await sleep(150)
await P.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })
console.log('== ⑦ 窄窗 1000×700 ==')
await P.cmd('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false })
await sleep(500)
const narrow = await evalJs(P, `(() => {
  const grid = document.querySelector('main .grid')
  const cs = grid ? getComputedStyle(grid) : null
  return {
    hasGrid: !!grid, cols: cs ? cs.gridTemplateColumns.split(' ').length : -1,
    overflowX: document.documentElement.scrollWidth > 1000,
    newBtn: !!document.querySelector('[data-testid="home-new-project"]'),
    impBtn: !!document.querySelector('[data-testid="home-import-dir"]'),
    footer: document.body.innerText.includes('当前项目库')
  }
})()`)
ok(narrow.hasGrid && narrow.cols === 2, `⑦ 1000 宽网格 2 列 (${narrow.cols})`)
ok(!narrow.overflowX, `⑦ 1000 宽零横向溢出`)
ok(narrow.newBtn && narrow.impBtn, `⑦ 工具条双按钮在位`)
ok(narrow.footer, `⑦ 底栏「当前项目库」在位`)
ok(P.errors.length === 0, `⑧ 主场景零 JS 异常 (${P.errors.slice(0, 2).join(' ; ')})`)
console.log('== ⑥ 空态 / 错误态 ==')
const PE = await makePage(`${SPA}/?cb=${Date.now()}&zj-empty=projects#/`)
await evalUntil(PE, `!!document.querySelector('[data-testid="empty-projects"]')`, 15000)
const emptyTxt = await evalJs(PE, `document.querySelector('[data-testid="empty-projects"]').innerText`)
ok(emptyTxt.includes('还没有项目') && emptyTxt.includes('新建项目'), `⑥ 空态「还没有项目」+新建项目入口`)
ok(PE.errors.length === 0, `⑥ 空态零 JS 异常`)
const PF = await makePage(`${SPA}/?cb=${Date.now()}&zj-fail-x=listProjects#/`)
await evalUntil(PF, `document.body.innerText.includes('读取项目库失败')`, 15000)
const failTxt = await evalJs(PF, `document.body.innerText.match(/读取项目库失败[\\s\\S]{0,80}/)?.[0] || ''`)
ok(failTxt.includes('重试'), `⑥ 错误态「读取项目库失败」+重试按钮 (${failTxt.replace(/\\n/g, ' ').slice(0, 50)})`)
ok(PF.errors.length === 0, `⑥ 错误态零 JS 异常`)

// ---------- 截图（改动处：卡片 hover/press + title；走查基线） ----------
async function shot(page, name, w, h) {
  await page.cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false })
  await sleep(400)
  const s = await page.cmd('Page.captureScreenshot', { format: 'png' })
  const dir = process.env.HOME + '/Pictures/zhijuan'
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${dir}/${name}.png`, Buffer.from(s.data, 'base64'))
  console.log('SHOT', `${dir}/${name}.png`)
}
await P.cmd('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 2, mobile: false })
await sleep(400)
const r2 = await evalJs(P, `(() => { const c = document.querySelector('[role="button"][aria-label^="打开项目"]'); const r = c.getBoundingClientRect(); return { x: r.x + 40, y: r.y + 40 } })()`)
await P.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r2.x, y: r2.y })
await sleep(300)
const hhmm = new Date().toTimeString().slice(0, 5).replace(':', '')
await shot(P, `home-walkthrough-card-${hhmm}`, 1600, 900)
await P.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })

console.log(fail === 0 ? 'ALL PASS' : `FAIL ${fail}`)
const ids = [P, PE, PF].map((pg) => pg.ws.url.split('/').pop())
for (const id of ids) { try { await fetch(`${CDP}/json/close/${id}`) } catch {} }
process.exit(fail === 0 ? 0 : 1)
