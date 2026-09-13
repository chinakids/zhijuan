// 织卷无头冒烟 · 动效基线核对（候选3 HIG Motion 细节核对轮）
// 用法：node scripts/motion-baseline-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123（SPA fallback）；CDP 127.0.0.1:9224
// 本轮修复：① tokens.css 全局交互基线 easing 统一为 Tailwind v4 默认 standard
//   cubic-bezier(0.4,0,0.2,1)（原 ease 与 transition-colors 组件并存=同类 hover 两种曲线）；
//   ② Home 项目卡 duration-200 → 150（与全站基线同口径）+ reduce 下关过渡与 hover 位移
//   （HIG Motion：Make motion optional / Let people cancel motion）。
// 验收点：① 项目卡 computed transition 0.15s + standard 曲线（显式类通道）；
//         ② 裸交互元素（无 Tailwind transition 类）timing 也 = standard（全局块通道，两通道同曲线）；
//         ③ Emulation reduce 后：项目卡 transitionProperty=none（位移类动效全关）；
//         ④ 恢复 no-preference 后项目卡曲线复原；⑤ 全程无 JS 异常。
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

const STANDARD = 'cubic-bezier(0.4, 0, 0.2, 1)'
// computed 多值以 ", " 连接（cubic-bezier 内部也有逗号，不能用 split(',')）
const allEq = (val, want) => {
  let rest = val
  for (;;) {
    const idx = rest.indexOf(want)
    if (idx === -1) return rest.trim() === '' || rest.trim() === ','
    const before = rest.slice(0, idx).trim()
    if (before !== '' && before !== ',') return false
    rest = rest.slice(idx + want.length)
  }
}

async function main() {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, `document.body.innerText.includes('新建项目') || document.body.innerText.includes('我的项目')`, (v) => v === true, 20000, '首页就绪')

  // ① 项目卡（role=button + transition-all duration-150）：时长与曲线（显式类通道）
  const card = await page.eval(`(() => {
    const el = document.querySelector('[role="button"][aria-label^="打开项目"]')
    if (!el) return null
    const cs = getComputedStyle(el)
    return { dur: cs.transitionDuration, timing: cs.transitionTimingFunction, prop: cs.transitionProperty }
  })()`)
  ok(card && allEq(card.dur, '0.15s'), `项目卡 transitionDuration=0.15s（${card?.dur}）`)
  ok(card && allEq(card.timing, STANDARD), `项目卡 timing=standard 曲线（${card?.timing}）`)
  ok(card && card.prop.includes('translate'), `项目卡 transitionProperty 含 translate（hover 位移参与过渡，${card?.prop?.slice(0, 80)}…）`)

  // ①b 真实指针 hover：上浮 -4px（zj-card-lift 承接），且位移走 translate 属性（Tailwind v4）
  const rect = await page.eval(`(() => {
    const el = document.querySelector('[role="button"][aria-label^="打开项目"]')
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })()`)
  await page.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y })
  await sleep(350)
  const hovered = await page.eval(`(() => {
    const el = document.querySelector('[role="button"][aria-label^="打开项目"]')
    const cs = getComputedStyle(el)
    return { translate: cs.translate, prop: cs.transitionProperty }
  })()`)
  ok(hovered && hovered.translate === '0px -4px', `指针 hover 项目卡 translate=-4px 上浮（${hovered?.translate}）`)
  ok(hovered && hovered.prop.includes('translate'), `hover 时过渡属性含 translate（${hovered?.prop?.slice(0, 60)}…）`)
  await page.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })
  await sleep(350)

  // ② 裸交互元素（className 不含 transition-*）：全局块通道同样 standard
  const bare = await page.eval(`(() => {
    const els = [...document.querySelectorAll('button, a, [role="button"]')]
      .filter((el) => !el.disabled && !String(el.className).includes('transition-') && el.offsetParent !== null)
    if (!els.length) return 'NONE'
    const el = els[0]
    const cs = getComputedStyle(el)
    return { tag: el.tagName, text: (el.textContent || '').trim().slice(0, 12), dur: cs.transitionDuration, timing: cs.transitionTimingFunction }
  })()`)
  if (bare === 'NONE') {
    console.log('  ◦ 无裸交互元素可断言（全局块以 CSS 产物核对兜底）')
  } else {
    ok(allEq(bare.dur, '0.15s'), `裸交互元素 ${bare.tag}#${bare.text} duration=0.15s（${bare.dur}）`)
    ok(allEq(bare.timing, STANDARD), `裸交互元素 timing=standard（${bare.timing}）`)
  }
  // ② 组件书写通道（transition-colors）与全局块运行时同曲线（unlayered 覆盖=单一通道）
  const compBtn = await page.eval(`(() => {
    const el = [...document.querySelectorAll('button')].find((b) => String(b.className).includes('transition-colors') && b.offsetParent !== null)
    if (!el) return null
    const cs = getComputedStyle(el)
    return { text: (el.textContent || '').trim().slice(0, 12), dur: cs.transitionDuration, timing: cs.transitionTimingFunction, prop: cs.transitionProperty }
  })()`)
  ok(compBtn && allEq(compBtn.dur, '0.15s') && allEq(compBtn.timing, STANDARD), `transition-colors 按钮 ${compBtn?.text} 运行时 150ms/standard（${compBtn?.dur?.slice(0, 22)}…）`)

  // ③ CSS 产物兜底：build 后 assets CSS 内 :where 块已含 standard 曲线
  const cssHit = await page.eval(`(() => {
    const sheets = [...document.styleSheets]
    let hit = false
    for (const s of sheets) {
      try {
        for (const r of s.cssRules) {
          if (r.conditionText && r.conditionText.includes('no-preference') && r.cssText.includes('cubic-bezier(0.4, 0, 0.2, 1)')) hit = true
        }
      } catch {}
    }
    return hit
  })()`)
  ok(cssHit === true, 'CSS 产物：no-preference 全局块含 standard 曲线（双通道统一）')

  // ③ reduce 模拟：项目卡过渡与位移关闭
  await page.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await sleep(300)
  const cardReduce = await page.eval(`(() => {
    const el = document.querySelector('[role="button"][aria-label^="打开项目"]')
    const cs = getComputedStyle(el)
    return { dur: cs.transitionDuration, prop: cs.transitionProperty }
  })()`)
  ok(cardReduce && allEq(cardReduce.dur, '0s'), `reduce：项目卡 transitionDuration=0s（${cardReduce?.dur}）`)
  ok(cardReduce && cardReduce.prop === 'none', `reduce：项目卡 transitionProperty=none（hover 位移无过渡，${cardReduce?.prop}）`)
  // reduce 下指针 hover 也不位移（HIG Let people cancel motion）
  await page.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y })
  await sleep(250)
  const hoveredReduce = await page.eval(`getComputedStyle(document.querySelector('[role="button"][aria-label^="打开项目"]')).translate`)
  ok(hoveredReduce === 'none', `reduce：指针 hover 项目卡不动（${hoveredReduce}）`)
  await page.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })

  // ④ 恢复 no-preference：曲线复原
  await page.cmd('Emulation.setEmulatedMedia', { features: [] })
  await sleep(300)
  const cardBack = await page.eval(`(() => {
    const el = document.querySelector('[role="button"][aria-label^="打开项目"]')
    const cs = getComputedStyle(el)
    return { dur: cs.transitionDuration, timing: cs.transitionTimingFunction }
  })()`)
  ok(cardBack && allEq(cardBack.dur, '0.15s') && allEq(cardBack.timing, STANDARD), `恢复：项目卡时长/曲线复原（${cardBack?.dur}/${cardBack?.timing}）`)

  // ⑤ 无 JS 异常
  ok(page.errors.length === 0, `全程无 JS 异常（${page.errors.length}）`)

  page.close()
  console.log('\n✅ motion-baseline-ui-smoke 全部通过')
}

main().catch((e) => {
  console.error('\n❌ ' + e.message)
  process.exit(1)
})
