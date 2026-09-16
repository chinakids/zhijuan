// 织卷无头冒烟 · 正文编辑器工具栏按压态 + More 触发器打开态（HIG Toolbars/Buttons）
// 用法：node scripts/toolbar-press-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；本机专用无头 Chrome CDP 127.0.0.1:9224
// 依据：Apple HIG Toolbars（2025-12-16 版）「系统为符号控件定义 hover 与 selection 态」+
//       HIG Buttons「Always include a press state for a custom button」+「菜单打开=触发器保持选中」惯例；
//       ui-ux-pro-max Stable Interaction States（press 走颜色通道、无 transform；disabled 不响应）。
// 走查面：① 结构=3 组/12 按钮/2 sep/无边框/24px/radius 6/icon 16px；
//        ② 可达性=全按钮 title+aria-label；撤销 disabled 置灰；激活态 aria-pressed（选中标题时 h1）；
//        ③ press 态=真鼠标 rest→hover→active 三态可辨、active≠hover、松开回 rest；disabled 按下无反馈；
//        ④ More 触发器打开态=窄窗 800 出现 More，真鼠标点击后 data-state=open 且高亮保持，Esc 关闭恢复；
//        ⑤ dark parity；⑥ 无 JS 异常；⑦ ~/Pictures/zhijuan/ 截图。
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
          if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 600))
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
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT: ' + label)
    await sleep(300)
  }
}

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

const SELECT_CHAPTER = `(async () => {
  const pick = () => [...document.querySelectorAll('button')].find((b) => /第.{1,6}章/.test(b.innerText))
  if (!pick()) {
    const tg = document.querySelector('[data-testid="chapter-toggle"]')
    if (tg) { tg.click(); await new Promise((r) => setTimeout(r, 600)) }
  }
  const cand = pick()
  if (!cand) return 'no candidate'
  cand.click()
  await new Promise((r) => setTimeout(r, 2500))
  return document.querySelector('.zj-md-toolbar') ? 'ok' : 'no toolbar'
})()`
const TOOL_GEOM = `document.querySelector('.zj-md-toolbar button[title="加粗"]')`
const box = async (page, sel) => {
  return page.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height } })()`)
}
const st = (page, sel) =>
  page.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const cs = getComputedStyle(el); return { bg: cs.backgroundColor, color: cs.color, border: cs.borderTopWidth + ' ' + cs.borderTopStyle, shadow: cs.boxShadow, w: el.offsetWidth, h: el.offsetHeight, radius: cs.borderRadius, disabled: el.disabled, title: el.title, aria: el.getAttribute('aria-label'), pressed: el.getAttribute('aria-pressed'), ds: el.getAttribute('data-state') } })()`)
const MOUSE_OFF = { x: 2, y: 2 }
const mouse = (page, type, x, y, extra = {}) =>
  page.cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra })

// ────────────── Tab P：宽窗 press 态 + 矩阵走查 ──────────────
const tabP = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
const page = await attach(tabP.webSocketDebuggerUrl)
await evalUntil(page, `document.querySelector('#root') ? true : false`, (v) => v, 15000, 'root')
await sleep(800)
const sel = await page.eval(SELECT_CHAPTER)
ok('选章后编辑器与工具栏挂载', sel === 'ok', sel)

const struct = await page.eval(`(() => {
  const tb = document.querySelector('.zj-md-toolbar'); if (!tb) return null
  const vis = [...tb.querySelectorAll('button')].filter((b) => !b.closest('[data-zj-tb-measure]'))
  const seps = [...tb.querySelectorAll('.sep')].filter((s) => !s.closest('[data-zj-tb-measure]'))
  const icon = tb.querySelector('button:nth-child(1) svg')
  return { btnCount: vis.length, sepCount: seps.length, more: vis.some((b) => b.title === '更多格式'), iconW: icon ? icon.getBoundingClientRect().width : 0 }
})()`)
ok('工具栏结构=12 按钮/3 组 2 sep/宽窗无 More（默认不溢出）', struct && struct.btnCount === 12 && struct.sepCount === 2 && !struct.more, JSON.stringify(struct))
ok('图标 16px（HIG 符号优先/适中）', struct && struct.iconW === 16, String(struct && struct.iconW))

const b = await st(page, '.zj-md-toolbar button[title="加粗"]')
ok('按钮无边框+24px+r6（macOS toolbar 无 bezel）', b && b.border === '0px solid' && b.shadow === 'none' && b.w === 24 && b.h === 24 && b.radius === '6px', JSON.stringify(b))
ok('按钮 title+aria-label 齐全（可发现性）', b && b.title === '加粗' && b.aria === '加粗', JSON.stringify(b))

const d = await st(page, '.zj-md-toolbar button[title="撤销"]')
ok('撤销初始 disabled（历史深度置灰）', d && d.disabled === true, JSON.stringify(d))

// 真鼠标三态（加粗）
const rB = await box(page, '.zj-md-toolbar button[title="加粗"]')
await mouse(page, 'mouseMoved', MOUSE_OFF.x, MOUSE_OFF.y); await sleep(250)
const rest = await st(page, '.zj-md-toolbar button[title="加粗"]')
await mouse(page, 'mouseMoved', rB.x, rB.y); await sleep(250)
const hover = await st(page, '.zj-md-toolbar button[title="加粗"]')
await mouse(page, 'mousePressed', rB.x, rB.y); await sleep(250)
const active = await st(page, '.zj-md-toolbar button[title="加粗"]')
await mouse(page, 'mouseReleased', rB.x, rB.y); await sleep(80)
await mouse(page, 'mouseMoved', MOUSE_OFF.x, MOUSE_OFF.y); await sleep(250)
const rest2 = await st(page, '.zj-md-toolbar button[title="加粗"]')
console.log('bold rest/hover/active/rest2:', rest.bg, '/', hover.bg, '/', active.bg, '/', rest2.bg)
ok('rest→hover 有反馈', rest.bg !== hover.bg, `${rest.bg} → ${hover.bg}`)
ok('press 态存在（hover→active 加深，可辨）', hover.bg !== active.bg, `${hover.bg} → ${active.bg}`)
// 释放后：不再显示按压色（无 :active 残留）；若点击触发格式 toggle → 按钮进激活态（accent-soft，HIG selection 态）
ok('释放后无按压残留', rest2.bg !== active.bg, rest2.bg)
ok('点击后按钮与编辑器状态联动（激活态=accent-soft）', rest2.pressed === 'true' && rest2.bg === 'rgb(227, 240, 238)', JSON.stringify({ pressed: rest2.pressed, bg: rest2.bg }))

// disabled 按下无按压反馈（撤销置灰）
const rD = await box(page, '.zj-md-toolbar button[title="撤销"]')
await mouse(page, 'mouseMoved', rD.x, rD.y); await sleep(250)
const dHover = await st(page, '.zj-md-toolbar button[title="撤销"]')
await mouse(page, 'mousePressed', rD.x, rD.y); await sleep(200)
const dActive = await st(page, '.zj-md-toolbar button[title="撤销"]')
await mouse(page, 'mouseReleased', rD.x, rD.y); await sleep(80)
ok('disabled 按下无按压反馈（不响应）', dHover.bg === dActive.bg, `${dHover.bg} → ${dActive.bg}`)

// dark parity
await page.eval(`document.documentElement.classList.add('dark')`); await sleep(300)
await mouse(page, 'mouseMoved', MOUSE_OFF.x, MOUSE_OFF.y); await sleep(250)
const dBg = await page.eval(`getComputedStyle(document.querySelector('.zj-md-toolbar')).backgroundColor`)
const darkRest = await st(page, '.zj-md-toolbar button[title="加粗"]')
await mouse(page, 'mouseMoved', rB.x, rB.y); await sleep(250)
const darkHover = await st(page, '.zj-md-toolbar button[title="加粗"]')
await mouse(page, 'mousePressed', rB.x, rB.y); await sleep(250)
const darkActive = await st(page, '.zj-md-toolbar button[title="加粗"]')
await mouse(page, 'mouseReleased', rB.x, rB.y); await sleep(80)
ok('dark press 态可辨（state parity）', darkHover.bg !== darkActive.bg && darkActive.bg !== 'rgba(0, 0, 0, 0)', `${darkHover.bg} → ${darkActive.bg}`)
ok('dark 工具栏背景=surface-2', dBg === 'rgb(32, 31, 29)', dBg)
await page.eval(`document.documentElement.classList.remove('dark')`); await sleep(200)

// 截图（工具栏 light）
import os from 'node:os'
import { writeFileSync, mkdirSync } from 'node:fs'
const outDir = os.homedir() + '/Pictures/zhijuan'
mkdirSync(outDir, { recursive: true })
const HHMM = new Date().toTimeString().slice(0, 5).replace(':', '')
try {
  const shot1 = await page.cmd('Page.captureScreenshot', { format: 'png' })
  writeFileSync(outDir + '/toolbar-press-' + HHMM + '.png', Buffer.from(shot1.data, 'base64'))
  console.log('screenshot saved:', outDir + '/toolbar-press-' + HHMM + '.png')
} catch (e) { console.log('screenshot warn:', e.message) }

// ────────────── Tab M：窄窗 800 More 打开态 ──────────────
const tabM = await openTab('about:blank')
const pageM = await attach(tabM.webSocketDebuggerUrl)
await pageM.cmd('Emulation.setDeviceMetricsOverride', { width: 800, height: 700, deviceScaleFactor: 1, mobile: false })
await pageM.cmd('Page.enable')
await pageM.cmd('Page.navigate', { url: BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel' })
await evalUntil(pageM, `document.querySelector('#root') ? true : false`, (v) => v, 15000, 'rootM')
await sleep(800)
const selM2 = await pageM.eval(SELECT_CHAPTER)
ok('窄窗选章挂载', selM2 === 'ok', selM2)
const mMore = await pageM.eval(`document.querySelector('.zj-md-toolbar button[title="更多格式"]') ? true : false`)
ok('窄窗 800 出现 More（溢出菜单收纳低频）', mMore === true, String(mMore))
const rM = await box(pageM, '.zj-md-toolbar button[title="更多格式"]')
await mouse(pageM, 'mouseMoved', rM.x, rM.y); await sleep(200)
await mouse(pageM, 'mousePressed', rM.x, rM.y); await sleep(150)
await mouse(pageM, 'mouseReleased', rM.x, rM.y); await sleep(400)
const openState = await st(pageM, '.zj-md-toolbar button[title="更多格式"]')
const items = await pageM.eval(`[...document.querySelectorAll('[role="menuitem"]')].map((it) => it.innerText.trim().slice(0, 12))`)
ok('More 打开后触发器 data-state=open 且高亮保持（菜单打开=保持选中）', openState.ds === 'open' && openState.bg === 'rgb(241, 238, 231)', JSON.stringify(openState))
ok('More 菜单项=icon+文案且与隐藏集一致', items.length === 5 && items.includes('斜体') && items.includes('有序列表'), JSON.stringify(items))
const shotM = await pageM.cmd('Page.captureScreenshot', { format: 'png' })
writeFileSync(outDir + '/toolbar-more-open-' + HHMM + '.png', Buffer.from(shotM.data, 'base64'))
// Esc 关闭
await pageM.cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
await pageM.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
await sleep(600)
const closedState = await st(pageM, '.zj-md-toolbar button[title="更多格式"]')
// Radix 关闭动画期 data-state=closed（过渡态）后移除；只要不再是 open 即菜单已关
ok('Esc 关闭后触发器解除 open 态', closedState.ds !== 'open', JSON.stringify(closedState))
// 鼠标移开后：触发器的 well 高亮应消失（证明高亮来自 hover 而非 open 残留）
await mouse(pageM, 'mouseMoved', MOUSE_OFF.x, MOUSE_OFF.y); await sleep(300)
const awayState = await st(pageM, '.zj-md-toolbar button[title="更多格式"]')
ok('菜单关闭且移开鼠标后触发器回 rest（高亮=hover 非 open 残留）', awayState.bg === 'rgba(0, 0, 0, 0)', JSON.stringify(awayState))

if (page.errors.length || pageM.errors.length) { console.log('JS ERRORS:', [...page.errors, ...pageM.errors].slice(0, 5)); fails++ }
console.log(fails === 0 ? 'ALL PASS' : ('FAILS: ' + fails))
await page.close(); await pageM.close()
process.exit(fails === 0 ? 0 : 1)
