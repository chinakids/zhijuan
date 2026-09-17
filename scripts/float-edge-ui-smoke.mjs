// 织卷无头冒烟 · 编辑器浮层贴边翻转（体验层 2026-09-15：候选 1 划词浮层/批注气泡贴边翻转）
// 用法：node scripts/float-edge-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；本机无头 Chrome CDP 127.0.0.1:9224
// 服务的问题：fixed 浮层此前只有「顶部太近翻下方」单向启发式（阈值 120/140 硬编码）+ 无水平钳制——
//  批注气泡高度随 note 行数变化（示例 150+ 字 note ≈ 190px），锚点 top ∈ [140, 8+10+h) 时旧代码判 above、
//  浮层从视口顶溢出；本轮改 floatingPos 纯函数：垂直按实测尺寸/视口空间双向翻转、双侧不足取大侧钳制、
//  水平中心越界钳回视口（±8px 边距）。
// 验收链路（1100×420 矮视口，先 resize 后交互）：
//   ① 选高亮/选区贴近中部（top≈166）→ 划词浮层出现且完全在视口内
//   ② 划词「批注」→ 150+ 字长 note → 高亮出现（第 3 条）
//   ③ 点高亮 → 气泡出现：完全在视口内 + 翻到下方（below）+ 与锚点间距 ≈10px（旧代码此场景 top≈-24 溢出顶部）
//   ④ Esc 关气泡；再选文核对浮层仍可用 + 截图（气泡 below 态 / 浮层态）
// 说明：水平 X 钳制在现有布局（一级导航 240 + Agent ≥280 常驻）下正文永不贴视口缘，UI 无法自然触发，
//  由 tests/unit/floating-pos.test.ts 7 例纯函数覆盖（右缘/左缘/超宽居中），冒烟只做视口内不越界共性断言。
import { writeFileSync } from 'fs'
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const OUT = process.env.HOME + '/Pictures/zhijuan'
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
async function setSize(page, w, h) {
  await page.cmd('Emulation.clearDeviceMetricsOverride')
  await page.cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false })
  await sleep(600)
}
async function pressKey(page, key, opts = {}) {
  const { code = key, vk = 0, text, modifiers = 0 } = opts
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key, code, text, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers })
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers })
}
const bodyHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
const clickBtn = (text, exact = true) => `(() => {
  const els = [...document.querySelectorAll('button')]
  const el = els.find((b) => ${exact ? `(b.innerText || '').trim() === ${JSON.stringify(text)}` : `(b.innerText || '').includes(${JSON.stringify(text)})`})
  if (!el) return false
  el.click()
  return true
})()`
const VIEW = { w: 1100, h: 660 }

let pass = 0
let fail = 0
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('PASS ' + name) }
  else { fail++; console.log('FAIL ' + name + (extra ? ' | ' + extra : '')) }
}

// —— 准备：开页（demo 项目 novel 直达第1章）→ 先 resize（矮视口）再交互 ——
const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel?ch=' + encodeURIComponent('第01章_雾港.md'))
const page = await attach(tab.webSocketDebuggerUrl)
await setSize(page, VIEW.w, VIEW.h)
await evalUntil(page, bodyHas('第1章'), Boolean, 20000, '正文页载入')
await page.eval(clickBtn('第1章 · 雾港', false))
await evalUntil(page, `!!document.querySelector('.ProseMirror')`, Boolean, 20000, '编辑器挂载')
await sleep(800)
await page.eval(`window.__ZJ_EDITORS?.[0]?.focus?.()`)
await sleep(300)

// —— ① 划词浮层：光标到第 3 段（阿七…）→ Shift+↓ 选择 → 浮层出现且完全在视口内 ——
await page.eval(`window.__ZJ_EDITORS?.[0]?.setCursor?.('阿七')`)
await sleep(250)
await pressKey(page, 'ArrowDown', { code: 'ArrowDown', vk: 40, modifiers: 8 })
await evalUntil(page, `!!document.querySelector('.zj-sel-bubble')`, Boolean, 8000, '浮层出现')
const bub = await page.eval(`(() => {
  const b = document.querySelector('.zj-sel-bubble')
  if (!b) return null
  const r = b.getBoundingClientRect()
  const s = window.getSelection()
  let ar = null
  try {
    if (s && s.rangeCount > 0) { const rr = s.getRangeAt(0).getBoundingClientRect(); ar = { t: rr.top, b: rr.bottom } }
  } catch {}
  return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: window.innerWidth, h: window.innerHeight, sel: (s || '').toString().slice(0, 12), aTop: ar ? Math.round(ar.t) : null }
})()`)
ok('划词浮层出现', !!bub, JSON.stringify(bub))
ok('浮层完全在视口内（未越界，左右上下一律钳制）', !!bub && bub.l >= 0 && bub.r <= bub.w && bub.t >= 0 && bub.b <= bub.h, JSON.stringify(bub))
ok('浮层底距选区顶≈10px（above 间隙恒定）', !!bub && bub.aTop !== null && Math.abs(bub.b - (bub.aTop - 10)) <= 2, JSON.stringify(bub))

// —— ② 划词「批注」→ 长 note（~215 字 → 气泡高 ~215px，锚点 top∈[140, 8+10+h) 即旧启发式 above 分支的 bug 区间）→ 高亮第 3 条 ——
await page.eval(`document.querySelector('.zj-sel-bubble button[aria-label="添加批注"]')?.click()`)
await evalUntil(page, bodyHas('添加批注'), Boolean, 8000, '批注弹层')
const NOTE = '这句太满了，改成克制的收束：船票上的墨迹洇开了一点。她没再问，攥着灯往候船厅深处走，灯罩里的火苗晃了一下，像是替她叹了口气。窗外雨声更密了，港口的灯一盏一盏亮起来，盐味顺着风从门缝渗进来，她又站了一会儿，才把船票收进口袋。长椅上有个人在打瞌睡，广播响过两遍，说的是下一班船还要等到天亮。她在那排旧长椅前站定，把灯放在膝盖上，火苗把她的影子投在墙上，一动不动。'
await page.eval(`(() => {
  const ta = document.querySelector('[role=dialog] textarea, [role=dialog] textarea')
  if (!ta) return 'NO_TA'
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), 'value').set
  setter.call(ta, ${JSON.stringify(NOTE)})
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return 'OK'
})()`)
await page.eval(clickBtn('保存批注'))
await evalUntil(page, `document.querySelectorAll('.zj-anno').length`, (n) => n === 3, 12000, '第 3 条批注高亮')
ok('长 note 批注已写入并高亮（共 3 条）', true, '')
const hl = await page.eval(`(() => {
  const el = document.querySelector('.zj-anno[data-anno-row="3"]')
  if (!el) return null
  const rs = el.getClientRects()
  const r = rs.length ? rs[0] : el.getBoundingClientRect()
  return { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left) }
})()`)
ok('高亮锚点处于旧启发式 above 分支（top≥140，旧代码不会翻下方）', !!hl && hl.t >= 140, JSON.stringify(hl))

// —— ③ 点高亮 → 批注气泡：完全在视口内 + 翻到下方（below）+ 与锚点间距≈10px ——
await page.eval(`document.querySelector('.zj-anno[data-anno-row="3"]').click()`)
await evalUntil(page, `!!document.querySelector('.zj-anno-pop')`, Boolean, 8000, '批注气泡出现')
const pop = await page.eval(`(() => {
  const p = document.querySelector('.zj-anno-pop')
  const hl = document.querySelector('.zj-anno[data-anno-row="3"]')
  if (!p || !hl) return null
  const r = p.getBoundingClientRect()
  const rs = hl.getClientRects()
  const ar = rs.length ? rs[0] : hl.getBoundingClientRect()
  return {
    l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom),
    w: window.innerWidth, h: window.innerHeight,
    aTop: Math.round(ar.top), aBot: Math.round(ar.bottom), ah: Math.round(r.height)
  }
})()`)
ok('批注气泡出现', !!pop, JSON.stringify(pop))
ok('气泡完全在视口内（旧代码此场景 top=锚点top-10-气泡高 <0 溢出顶部）', !!pop && pop.t >= 0 && pop.b <= pop.h && pop.l >= 0 && pop.r <= pop.w, JSON.stringify(pop))
ok('气泡翻到下方（above 空间不足 → below：气泡顶 > 锚点顶且实测证明 above 放不下）', !!pop && pop.t > pop.aTop && pop.ah + 18 > pop.aTop, JSON.stringify(pop))
ok('气泡顶与锚点底间距≈10px（视口足以容纳时的标准间隙）', !!pop && Math.abs(pop.t - pop.aBot - 10) <= 3, 't=' + pop?.t + ' aBot=' + pop?.aBot)
ok('高气泡高度 >150px（场景构造有效）', !!pop && pop.ah > 150, 'h=' + pop?.ah)
// 气泡态截图（below 翻转后）
const stamp0 = new Date().toTimeString().slice(0, 5).replace(':', '')
const shotPop = `${OUT}/float-edge-pop-${stamp0}.png`
try {
  await page.cmd('Page.enable')
  const img0 = await page.cmd('Page.captureScreenshot', { format: 'png' })
  writeFileSync(shotPop, Buffer.from(img0.data, 'base64'))
  console.log('SHOT ' + shotPop)
} catch (e) {
  console.log('SHOT ERR ' + e.message)
}

// —— ④ Esc 关气泡 → 再核对划词浮层仍可用（回归）→ 截图 ——
await pressKey(page, 'Escape', { code: 'Escape', vk: 27 })
await evalUntil(page, `!document.querySelector('.zj-anno-pop')`, Boolean, 5000, 'Esc 关气泡')
await page.eval(`window.__ZJ_EDITORS?.[0]?.focus?.()`)
await sleep(200)
await pressKey(page, 'ArrowDown', { code: 'ArrowDown', vk: 40, modifiers: 8 })
await evalUntil(page, `!!document.querySelector('.zj-sel-bubble')`, Boolean, 8000, '浮层再现回归')
ok('Esc 后划词浮层仍可正常出（零回归）', true, '')
const stamp = new Date().toTimeString().slice(0, 5).replace(':', '')
const shotBub = `${OUT}/float-edge-bubble-${stamp}.png`
try {
  const img1 = await page.cmd('Page.captureScreenshot', { format: 'png' })
  writeFileSync(shotBub, Buffer.from(img1.data, 'base64'))
  console.log('SHOT ' + shotBub)
} catch (e) {
  console.log('SHOT ERR ' + e.message)
}
console.log('---')
console.log(`${pass}/${pass + fail} PASS`)
if (page.errors.length) { fail++; console.log('FAIL 无 JS 异常:', page.errors.slice(0, 3).join(' | ')) }
else console.log('OK 无 JS 异常')
page.close()
process.exit(fail ? 1 : 0)
