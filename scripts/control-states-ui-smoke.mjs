// 织卷无头冒烟 · 通用控件状态体检（Button 四态 / Select / Textarea 焦点与禁用口径）
// 用法：node scripts/control-states-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；本机专用无头 Chrome CDP 127.0.0.1:9224
// 依据：Apple HIG Buttons「Always include a press state for a custom button.
//       Without a press state, a button can feel unresponsive」+ ui-ux-pro-max
//       Stable Interaction States（press 用 color/opacity/elevation，不动布局）
//       + State contrast parity（两主题均可辨）+ Disabled state clarity。
// 验收点：① Button 六 variant rest/hover/active 三态（真鼠标 CDP Input）；
//         ② disabled=opacity .5 + pointer-events none + hover 不响应；
//         ③ Select disabled cursor=not-allowed；④ Textarea 焦点环与 Input 同口径（Tab 真聚焦）；
//         ⑤ dark 主题复测关键态；⑥ 无 JS 异常；⑦ ~/Pictures/zhijuan/ 截图。
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

const CLAIM = `inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0`
// 探针注入：与 src/renderer/src/components/ui/button.tsx 同源字符串（改组件须同步本脚本）
const INJECT = `(() => {
  const CLAIM = ${JSON.stringify(CLAIM)}
  const wrap = document.createElement('div')
  wrap.id = 'probe-panel'
  wrap.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483000;display:flex;flex-direction:column;gap:10px;padding:20px;background:var(--paper)'
  document.body.appendChild(wrap)
  const mk = (cls, txt, disabled) => {
    const b = document.createElement('button')
    b.className = cls; b.textContent = txt; b.setAttribute('data-v', txt)
    if (disabled) b.disabled = true
    wrap.appendChild(b); return b
  }
  const variants = {
    default: CLAIM + ' bg-accent text-accent-ink hover:opacity-90 active:opacity-80 shadow-sm',
    outline: CLAIM + ' border border-hair-strong bg-surface text-ink hover:bg-surface-2 active:bg-well',
    ghost: CLAIM + ' text-ink-2 hover:bg-well hover:text-ink active:bg-well active:text-ink',
    secondary: CLAIM + ' bg-well text-ink hover:brightness-95 active:brightness-90',
    destructive: CLAIM + ' bg-danger text-white hover:opacity-90 active:opacity-80',
    link: CLAIM + ' text-accent underline-offset-4 hover:underline active:text-ink-2'
  }
  for (const [name, cls] of Object.entries(variants)) {
    mk(cls, name + '-en', false); mk(cls, name + '-dis', true)
  }
  // Switch 三态
  const swBase = 'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 data-[state=checked]:bg-accent data-[state=unchecked]:bg-hair-strong disabled:cursor-not-allowed disabled:opacity-50'
  const mkSw = (state, disabled, txt) => {
    const s = document.createElement('button')
    s.setAttribute('role', 'switch'); s.setAttribute('data-state', state)
    s.className = swBase; if (disabled) s.disabled = true
    const th = document.createElement('span')
    th.className = 'pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0 dark:bg-surface'
    th.setAttribute('data-state', state)
    s.appendChild(th); s.setAttribute('data-v', txt)
    wrap.appendChild(s); return s
  }
  mkSw('unchecked', false, 'switch-u'); mkSw('checked', false, 'switch-c'); mkSw('unchecked', true, 'switch-d')
  // Select trigger
  const sel = document.createElement('button')
  sel.className = 'flex h-9 w-full items-center justify-between whitespace-nowrap rounded-lg border border-hair-strong bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/60 disabled:opacity-50 disabled:cursor-not-allowed'
  sel.textContent = '选择…'; sel.setAttribute('data-v', 'select'); wrap.appendChild(sel)
  const seld = sel.cloneNode(true); seld.disabled = true; seld.setAttribute('data-v', 'select-dis'); wrap.appendChild(seld)
  // Input / Textarea（同口径验证）
  const inp = document.createElement('input')
  inp.className = 'flex h-9 w-full rounded-lg border border-hair-strong bg-surface px-3 py-1 text-sm text-ink transition-colors placeholder:text-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50'
  inp.placeholder = '输入…'; inp.setAttribute('data-v', 'input'); wrap.appendChild(inp)
  const ta = document.createElement('textarea')
  ta.className = 'flex min-h-[60px] w-full rounded-lg border border-hair-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60'
  ta.placeholder = '多行…'; ta.setAttribute('data-v', 'textarea'); wrap.appendChild(ta)
  return 'OK'
})()`

const STYLES = `(() => {
  const g = (v) => {
    const el = document.querySelector('[data-v="' + v + '"]')
    const cs = getComputedStyle(el)
    return { opacity: cs.opacity, bg: cs.backgroundColor, color: cs.color, pe: cs.pointerEvents, cursor: cs.cursor, shadow: cs.boxShadow }
  }
  return { d: g('default-en'), o: g('outline-en'), gh: g('ghost-en'), se: g('secondary-en'), de: g('destructive-en'), li: g('link-en') }
})()`

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/')
const page = await attach(tab.webSocketDebuggerUrl)
await evalUntil(page, `document.querySelector('#root') ? true : false`, (v) => v, 15000, 'root')
await sleep(1000)
await page.eval(INJECT)

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

async function rect(v) {
  return page.eval(`(() => { const r = document.querySelector('[data-v="${v}"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height } })()`)
}
const MOUSE_OFF = { x: 2, y: 2 }

// —— ① Button 六 variant 三态 ——
for (const [v, name] of [['default-en', 'default'], ['outline-en', 'outline'], ['ghost-en', 'ghost'], ['secondary-en', 'secondary'], ['destructive-en', 'destructive'], ['link-en', 'link']]) {
  const r = await rect(v)
  await page.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: MOUSE_OFF.x, y: MOUSE_OFF.y })
  await sleep(250)
  const rest = await page.eval(`(() => { const cs = getComputedStyle(document.querySelector('[data-v="${v}"]')); return { opacity: cs.opacity, bg: cs.backgroundColor, color: cs.color, filter: cs.filter, deco: cs.textDecorationLine } })()`)
  await page.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y })
  await sleep(250)
  const hover = await page.eval(`(() => { const cs = getComputedStyle(document.querySelector('[data-v="${v}"]')); return { opacity: cs.opacity, bg: cs.backgroundColor, color: cs.color, filter: cs.filter, deco: cs.textDecorationLine } })()`)
  await page.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 })
  await sleep(250)
  const active = await page.eval(`(() => { const cs = getComputedStyle(document.querySelector('[data-v="${v}"]')); return { opacity: cs.opacity, bg: cs.backgroundColor, color: cs.color, filter: cs.filter, deco: cs.textDecorationLine } })()`)
  await page.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 })
  await sleep(80)
  await page.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: MOUSE_OFF.x, y: MOUSE_OFF.y })
  await sleep(250)
  const rest2 = await page.eval(`(() => { const cs = getComputedStyle(document.querySelector('[data-v="${v}"]')); return { opacity: cs.opacity, bg: cs.backgroundColor, color: cs.color, filter: cs.filter, deco: cs.textDecorationLine } })()`)
  console.log(name, 'rest:', JSON.stringify(rest), 'hover:', JSON.stringify(hover), 'active:', JSON.stringify(active))
  ok(name + ' rest→hover 有反馈', JSON.stringify(rest) !== JSON.stringify(hover), JSON.stringify(hover))
  // ghost 低强调按钮：press=hover 同款高亮（macOS toolbar 惯例），press 语义=rest→active 有变化；
  // 其余 variant 要求 hover→active 进一步加深（真实 press state）
  const pressOK = name === 'ghost'
    ? JSON.stringify(rest) !== JSON.stringify(active)
    : JSON.stringify(hover) !== JSON.stringify(active)
  ok(name + ' press state（按下有反馈）', pressOK, JSON.stringify(active))
  ok(name + ' 移开后回 rest', JSON.stringify(rest2) === JSON.stringify(rest), JSON.stringify(rest2))
}

// default 三态数值分层（HIG: press 反馈明确可辨）
const rD = await rect('default-en')
await page.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: MOUSE_OFF.x, y: MOUSE_OFF.y })
await sleep(250)
const dRest = await page.eval(`parseFloat(getComputedStyle(document.querySelector('[data-v="default-en"]')).opacity)`)
await page.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rD.x, y: rD.y })
await sleep(250)
const dHover = await page.eval(`parseFloat(getComputedStyle(document.querySelector('[data-v="default-en"]')).opacity)`)
await page.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: rD.x, y: rD.y, button: 'left', clickCount: 1 })
await sleep(250)
const dActive = await page.eval(`parseFloat(getComputedStyle(document.querySelector('[data-v="default-en"]')).opacity)`)
await page.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rD.x, y: rD.y, button: 'left', clickCount: 1 })
ok('default 三档分层 1.0→0.9→0.8', dRest === 1 && dHover === 0.9 && dActive === 0.8, `${dRest}/${dHover}/${dActive}`)

// —— ② disabled：opacity .5 + pe none + hover 不响应 ——
const dDis = await page.eval(`(() => { const el = document.querySelector('[data-v="default-dis"]'); const cs = getComputedStyle(el); return { opacity: cs.opacity, pe: cs.pointerEvents, cursor: cs.cursor } })()`)
ok('disabled=opacity 0.5 + pointer-events none', dDis.opacity === '0.5' && dDis.pe === 'none', JSON.stringify(dDis))
const rDis = await rect('default-dis')
await page.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rDis.x, y: rDis.y })
await sleep(250)
const dDis2 = await page.eval(`parseFloat(getComputedStyle(document.querySelector('[data-v="default-dis"]')).opacity)`)
ok('disabled hover 不响应（仍 0.5）', dDis2 === 0.5, String(dDis2))

// —— ③ Select disabled cursor=not-allowed ——
const selDis = await page.eval(`(() => { const el = document.querySelector('[data-v="select-dis"]'); return { cursor: getComputedStyle(el).cursor, opacity: getComputedStyle(el).opacity } })()`)
ok('Select disabled cursor=not-allowed + opacity .5', selDis.cursor === 'not-allowed' && selDis.opacity === '0.5', JSON.stringify(selDis))
const selEn = await page.eval(`getComputedStyle(document.querySelector('[data-v="select"]')).cursor`)
ok('Select enabled cursor=pointer', selEn === 'pointer', selEn)

// —— ④ Textarea 焦点环与 Input 同口径（Tab 真聚焦） ——
const taCls = await page.eval(`document.querySelector('[data-v="textarea"]').className`)
ok('Textarea 类含 ring-2/ring-accent/60（与 Input 同口径）', /ring-2/.test(taCls) && /ring-accent\/60/.test(taCls) && /border-hair-strong/.test(taCls), taCls)
// 真实 Tab：焦点放 input（textarea 前一个注入元素），发 Tab → textarea 获得 focus-visible
await page.eval(`document.querySelector('[data-v="input"]').focus()`)
await page.cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 48 })
await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 48 })
await sleep(300)
const taF = await page.eval(`(() => { const el = document.activeElement; if (!el || el.getAttribute('data-v') !== 'textarea') return { focused: false, tag: el && el.tagName }; const cs = getComputedStyle(el); return { focused: true, fv: el.matches(':focus-visible'), outline: cs.outlineStyle, shadow: cs.boxShadow } })()`)
console.log('textarea focus:', JSON.stringify(taF))
ok('Textarea 键盘 Tab 聚焦', taF.focused === true, JSON.stringify(taF))
// Tailwind v4 ring 用 oklab 渲染 accent/60（非 rgb），断言 2px ring + 0.6 透明度即可
ok('Textarea 焦点环 = ring 2px accent/60', taF.fv && /0px 0px 0px 2px/.test(taF.shadow) && /\/ 0\.6/.test(taF.shadow), taF.shadow)

// —— ⑤ dark 复测（state contrast parity） ——
await page.eval(`document.documentElement.classList.add('dark')`)
await sleep(300)
const rDark = await rect('default-en')
await page.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: MOUSE_OFF.x, y: MOUSE_OFF.y })
await sleep(250)
await page.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rDark.x, y: rDark.y })
await sleep(250)
await page.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: rDark.x, y: rDark.y, button: 'left', clickCount: 1 })
await sleep(250)
const darkActive = await page.eval(`(() => { const cs = getComputedStyle(document.querySelector('[data-v="default-en"]')); return { opacity: cs.opacity, bg: cs.backgroundColor } })()`)
await page.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rDark.x, y: rDark.y, button: 'left', clickCount: 1 })
ok('dark default active opacity=0.8（state parity）', darkActive.opacity === '0.8', JSON.stringify(darkActive))
const darkDis = await page.eval(`getComputedStyle(document.querySelector('[data-v="outline-dis"]')).opacity`)
ok('dark disabled outline opacity=0.5', darkDis === '0.5', darkDis)
await page.eval(`document.documentElement.classList.remove('dark')`)
await sleep(200)

// —— ⑦ 截图（真实设置页：有真实 Button/Switch/Select/Input/Textarea 控件） ——
import os from 'node:os'
import { writeFileSync, mkdirSync } from 'node:fs'
const outDir = os.homedir() + '/Pictures/zhijuan'
mkdirSync(outDir, { recursive: true })
let shotOk = false
try {
  await page.cmd('Page.navigate', { url: BASE + '/#/project/demo-aseya/settings' })
  await sleep(3500)
  const hasSettings = await page.eval(`document.body.innerText.includes('设置') || document.body.innerText.includes('工作区')`)
  if (hasSettings) {
    const shot1 = await page.cmd('Page.captureScreenshot', { format: 'png' })
    writeFileSync(outDir + '/control-states-settings.png', Buffer.from(shot1.data, 'base64'))
    await page.eval(`document.documentElement.classList.add('dark')`)
    await sleep(400)
    const shot2 = await page.cmd('Page.captureScreenshot', { format: 'png' })
    writeFileSync(outDir + '/control-states-settings-dark.png', Buffer.from(shot2.data, 'base64'))
    await page.eval(`document.documentElement.classList.remove('dark')`)
    shotOk = true
  }
} catch (e) { console.log('screenshot warn:', e.message) }
ok('设置页截图存档（失败不阻断断言）', shotOk, shotOk ? '2 张' : 'warn')

if (page.errors.length) { console.log('JS ERRORS:', page.errors.slice(0, 5)); fails++ }
console.log(fails === 0 ? 'ALL PASS' : ('FAILS: ' + fails))
await page.close()
process.exit(fails === 0 ? 0 : 1)
