// 织卷无头冒烟 · Toast 进出场动效（V-08 遗留收口：通知进场 150ms 淡入+8px 微滑、退场镜像、reduced-motion 全关）
// 用法：node scripts/toast-motion-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs（或 node scripts/serve-renderer.mjs 8123）；CDP 127.0.0.1:9224
// 验收点：① ToastCard 进场 computed animationName=enter / 0.15s / ease；② 点关闭 → data-leaving + animationName=exit；
//         ③ 150ms 后 DOM 移除；④ 自动消失路径同样先 leaving 后移除；⑤ reduced-motion 下 animationName=none；⑥ 无 JS 异常。
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

async function evalUntil(page, expr, pred, timeoutMs = 15000, label = expr) {
  const t0 = Date.now()
  for (;;) {
    try {
      const v = await page.eval(expr)
      if (pred(v)) return v
    } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(120)
  }
}

const ok = (cond, msg) => {
  if (!cond) throw new Error('FAIL: ' + msg)
  console.log('  ✓ ' + msg)
}

const animOf = (page, sel) =>
  page.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)})
    if (!el) return null
    const cs = getComputedStyle(el)
    return { name: cs.animationName, dur: cs.animationDuration, ease: cs.animationTimingFunction }
  })()`)

async function main() {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, `typeof window.__ZJ_TEST !== 'undefined'`, (v) => v === true, 20000, 'Home devShim 就绪')

  // ── ① 进场：直发 toast → 卡片进场动画 enter/0.15s/ease ──
  await page.eval(`window.__ZJ_TOAST.add({ kind: 'success', title: '动画验收·进场', description: '150ms 淡入 + 8px 微滑' })`)
  await evalUntil(page, `!!document.querySelector('.zj-toast')`, (v) => v === true, 5000, 'toast 出现')
  const inAnim = await animOf(page, '.zj-toast')
  ok(inAnim && inAnim.name === 'enter', `进场 animationName=enter（${inAnim?.name}）`)
  ok(inAnim && inAnim.dur === '0.15s', `进场 duration=0.15s（${inAnim?.dur}）`)
  ok(inAnim && inAnim.ease === 'ease', `进场 timing=ease（${inAnim?.ease}）`)

  // 截图：进场完成后的显示态（改动处实际界面图）
  await sleep(350)
  const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
  const { writeFileSync } = await import('node:fs')
  const hhmm = new Date().toTimeString().slice(0, 5).replace(':', '')
  writeFileSync(process.env.HOME + '/Pictures/zhijuan/toast-motion-' + hhmm + '.png', Buffer.from(shot.data, 'base64'))
  console.log('SHOT ~/Pictures/zhijuan/toast-motion-' + hhmm + '.png')

  // ── ② 退场：真实点关闭按钮 → data-leaving + exit 动画 → 150ms 后 DOM 移除 ──
  await page.eval(`document.querySelector('.zj-toast button').click()`)
  await evalUntil(page, `!!document.querySelector('.zj-toast[data-leaving]')`, (v) => v === true, 2000, '进入退场态')
  const outAnim = await animOf(page, '.zj-toast')
  ok(outAnim && outAnim.name === 'exit', `退场 animationName=exit（${outAnim?.name}）`)
  ok(outAnim && outAnim.dur === '0.15s', `退场 duration=0.15s（${outAnim?.dur}）`)
  await evalUntil(page, `document.querySelectorAll('.zj-toast').length === 0`, (v) => v === true, 2000, '退场后 DOM 移除')

  // ── ③ 自动消失路径：短时长 → 先 leaving 后移除 ──
  await page.eval(`window.__ZJ_TOAST.add({ kind: 'info', title: '自动消失', duration: 600 })`)
  await evalUntil(page, `!!document.querySelector('.zj-toast[data-leaving]')`, (v) => v === true, 3000, '自动消失先 leaving')
  await evalUntil(page, `document.querySelectorAll('.zj-toast').length === 0`, (v) => v === true, 3000, '自动消失后移除')

  // ── ④ reduced-motion：动画全关（tokens.css [class*=animate-*] 覆盖） ──
  await page.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await sleep(150)
  await page.eval(`window.__ZJ_TOAST.add({ kind: 'warning', title: '弱动效' })`)
  await evalUntil(page, `!!document.querySelector('.zj-toast')`, (v) => v === true, 5000, 'reduced 下 toast 出现')
  const rAnim = await animOf(page, '.zj-toast')
  ok(rAnim && rAnim.name === 'none', `reduced-motion：animationName=none（${rAnim?.name}）`)
  await page.cmd('Emulation.setEmulatedMedia', { features: [] })
  await page.eval(`window.__ZJ_TOAST.clear()`)

  // ── ⑤ 无 JS 异常 ──
  const errs = page.errors.filter((e) => !/ResizeObserver/.test(e) && !/Download the React DevTools/.test(e))
  ok(errs.length === 0, '无 JS 异常' + (errs.length ? '：' + errs.slice(0, 2).join(' | ') : ''))

  page.close()
  console.log('\nTOAST-MOTION SMOKE PASS（进场 exit 0.15s ease / 退场 exit 0.15s / leaving 后移除 / reduced-motion 全关）')
}

main().catch((e) => {
  console.error('\nTOAST-MOTION SMOKE FAIL:', e.message)
  process.exit(1)
})
