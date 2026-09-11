// 织卷无头冒烟 · 动效基线（V-08：覆盖层统一 150ms ease 进场 / 高频浮层 100ms 淡入 / 尊重 prefers-reduced-motion）
// 用法：node scripts/motion-polish-ui-smoke.mjs
// 前置：npm run build；/tmp/spa_server.py（或 python -m http.server 8123 --directory out/renderer）；CDP 127.0.0.1:9224
// 验收点：① 本章小环抽屉：overlay/panel 计算 animationName=enter、duration=0.15s、timing=ease；
//         ② 新建项目 Dialog（Radix）：content 动画 enter/0.15s，数据态类生效；
//         ③ @ 浮层：animation-duration=0.1s（高频交互 100ms 淡入）；
//         ④ Emulation.setEmulatedMedia(prefers-reduced-motion=reduce) 后：抽屉/Dialog 动画被关（animationName=none）；
//         ⑤ 全程无 JS 异常。
const CDP = 'http://127.0.0.1:9224'
const BASE = 'http://localhost:8123'
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

async function evalUntil(page, expr, pred, timeoutMs = 15000, label = expr) {
  const t0 = Date.now()
  for (;;) {
    try {
      const v = await page.eval(expr)
      if (pred(v)) return v
    } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(250)
  }
}

const ok = (cond, msg) => {
  if (!cond) throw new Error('FAIL: ' + msg)
  console.log('  ✓ ' + msg)
}

async function typeText(page, text) {
  for (const ch of text) {
    await page.eval(`(() => {
      const ta = document.querySelector('textarea')
      if (!ta) return 'NO_TA'
      ta.focus()
      const proto = Object.getPrototypeOf(ta)
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
      setter.call(ta, ta.value + ${JSON.stringify(ch)})
      const pos = ta.value.length
      ta.setSelectionRange(pos, pos)
      const ev = new Event('input', { bubbles: true })
      ev.isComposing = false
      ta.dispatchEvent(ev)
      ta.dispatchEvent(new Event('change', { bubbles: true }))
      return ta.value
    })()`)
    await sleep(80)
  }
  return 'OK'
}

const animOf = (page, sel) =>
  page.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)})
    if (!el) return null
    const cs = getComputedStyle(el)
    return { name: cs.animationName, dur: cs.animationDuration, ease: cs.animationTimingFunction }
  })()`)

async function main() {
  // ── Tab 1：Novel 页 → 本章小环抽屉 ──
  const tab1 = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
  const page = await attach(tab1.webSocketDebuggerUrl)
  await evalUntil(page, `document.body.innerText.includes('正文创作') || document.body.innerText.includes('第01章')`, (v) => v === true, 20000, 'Novel 就绪')
  await evalUntil(page, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.includes('雾港')); if (!b) return false; b.click(); return true })()`, (v) => v === true, 10000, '选章')
  await sleep(400)

  await evalUntil(page, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.title && x.title.startsWith('本章小环')); if (!b) return false; b.click(); return true })()`, (v) => v === true, 5000, '打开小环')
  await evalUntil(page, `!!document.querySelector('[class*="bg-black"]')`, (v) => v === true, 5000, '抽屉遮罩出现')

  // ① 抽屉 overlay + panel 动画
  const overlayAnim = await animOf(page, '[class*="bg-black"]')
  ok(overlayAnim && overlayAnim.name === 'enter', `抽屉遮罩 animationName=enter（${overlayAnim?.name}）`)
  ok(overlayAnim && overlayAnim.dur === '0.15s', `抽屉遮罩 duration=0.15s（${overlayAnim?.dur}）`)
  const panelSel = '[class*="slide-in-from-right-3"]'
  const panelAnim = await animOf(page, panelSel)
  ok(panelAnim && panelAnim.name === 'enter' && panelAnim.ease === 'ease', `抽屉面板 animationName=enter/ease（${panelAnim?.name}/${panelAnim?.ease}）`)
  ok(panelAnim && panelAnim.dur === '0.15s', `抽屉面板 duration=0.15s（${panelAnim?.dur}）`)

  // 关闭抽屉（遮罩点击）
  await page.eval(`(() => { const o = [...document.querySelectorAll('[class*="bg-black"]')][0]; if (!o) return 'NO'; o.click(); return 'OK' })()`)
  await sleep(350)

  // ④ reduced-motion 仿真：关掉进场动画
  await page.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await sleep(120)
  await evalUntil(page, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.title && x.title.startsWith('本章小环')); if (!b) return false; b.click(); return true })()`, (v) => v === true, 5000, 'reduced 下重开小环')
  await evalUntil(page, `!!document.querySelector('[class*="bg-black"]')`, (v) => v === true, 5000, 'reduced 下抽屉出现')
  const rOverlay = await animOf(page, '[class*="bg-black"]')
  const rPanel = await animOf(page, panelSel)
  ok(rOverlay && rOverlay.name === 'none', `reduced-motion：抽屉遮罩 animationName=none（${rOverlay?.name}）`)
  ok(rPanel && rPanel.name === 'none', `reduced-motion：抽屉面板 animationName=none（${rPanel?.name}）`)
  await page.cmd('Emulation.setEmulatedMedia', { features: [] })
  await page.eval(`(() => { const o = [...document.querySelectorAll('[class*="bg-black"]')][0]; if (o) o.click(); return 1 })()`)
  await sleep(300)

  // ③ @ 浮层 100ms 淡入
  await typeText(page, '@')
  await evalUntil(page, `!!document.querySelector('.zj-at-menu')`, (v) => v === true, 8000, '@ 浮层出现')
  const menuAnim = await animOf(page, '.zj-at-menu')
  ok(menuAnim && menuAnim.dur === '0.1s', `@ 浮层 duration=0.1s（${menuAnim?.dur}）`)
  ok(menuAnim && menuAnim.name === 'enter', `@ 浮层 animationName=enter（${menuAnim?.name}）`)
  await page.eval(`(() => { const ta = document.querySelector('textarea'); if (ta) { ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true })) } return 1 })()`)
  page.close()

  // ── Tab 2：Home → 新建项目 Dialog（Radix） ──
  const tab2 = await openTab(BASE + '/?cb=' + Date.now() + '#/')
  const p2 = await attach(tab2.webSocketDebuggerUrl)
  await evalUntil(p2, `typeof window.__ZJ_TEST !== 'undefined'`, (v) => v === true, 20000, 'Home devShim 就绪')
  await evalUntil(p2, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === '新建项目'); if (!b) return false; b.click(); return true })()`, (v) => v === true, 8000, '打开新建项目 Dialog')
  await evalUntil(p2, `!!document.querySelector('[data-state="open"][class*="zoom-in"]') || [...document.querySelectorAll('div')].some((d) => d.getAttribute('data-state') === 'open' && d.className.includes('zoom-in'))`, (v) => v === true, 8000, 'DialogContent 出现')

  // ② Dialog content 动画
  const dlgAnim = await animOf(p2, '[data-state="open"][class*="zoom-in"]')
  ok(dlgAnim && dlgAnim.name === 'enter', `DialogContent animationName=enter（${dlgAnim?.name}）`)
  ok(dlgAnim && dlgAnim.dur === '0.15s', `DialogContent duration=0.15s（${dlgAnim?.dur}）`)

  // ④ reduced-motion 下 Dialog 动画关
  await p2.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await sleep(120)
  // Dialog 处于 open 状态时元素不变，直接重读计算样式即可验证媒体切换生效：
  const dlgReduced = await animOf(p2, '[data-state="open"][class*="zoom-in"]')
  // Dialog 处于 open 状态时 state 不变，元素是原有元素——直接读即可：
  ok(dlgReduced && dlgReduced.name === 'none', `reduced-motion：DialogContent animationName=none（${dlgReduced?.name}）`)
  await p2.cmd('Emulation.setEmulatedMedia', { features: [] })

  await sleep(200)
  ok(p2.errors.length === 0, 'Tab2 无 JS 异常' + (p2.errors.length ? '：' + p2.errors.slice(0, 2).join(' | ') : ''))
  ok(page.errors.length === 0, 'Tab1 无 JS 异常' + (page.errors.length ? '：' + page.errors.slice(0, 2).join(' | ') : ''))
  p2.close()

  console.log('\nMOTION-POLISH SMOKE PASS（覆盖层 150ms / 高频浮层 100ms / reduced-motion 全关）')
}

main().catch((e) => {
  console.error('\nMOTION-POLISH SMOKE FAIL:', e.message)
  process.exit(1)
})
