// 织卷无头冒烟 · Toast 全局通知 a11y 走查（2026-09-22 体验层）
// 用法：node scripts/toast-a11y-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；CDP 9224
// 验收点：① 常驻双 live region（role=status + role=alert，初始即存在）；
//         ② 卡片不带 role（与文本同帧创建的 role 会被读屏漏播），success 落 status 容器、error 落 alert 容器（assertive 分流）；
//         ③ focus 暂停（WCAG 2.2.1：Tab 进卡片倒计时暂停，blur 恢复）；
//         ④ 窄窗 1000/800 无横向溢出；⑤ dark 语义色；⑥ 常驻 action × 4 占满后新 toast 挤掉最旧；⑦ 无 JS 异常。
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
  const cmd = (method, params = {}) => new Promise((res, rej) => {
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
    try { const v = await page.eval(expr); if (pred(v)) return v } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(200)
  }
}

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'OK ' : 'NG ') + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/')
const page = await attach(tab.webSocketDebuggerUrl)
try {
  await evalUntil(page, `typeof window.__ZJ_TOAST !== 'undefined'`, (v) => v === true, 20000, 'devShim 就绪')

  // ── ① 常驻双 live region（初始）──
  const init = await page.eval(`(() => ({
    status: !!document.querySelector('[role="status"][aria-live="polite"]'),
    alert: !!document.querySelector('[role="alert"][aria-live="assertive"]'),
    cards: document.querySelectorAll('.zj-toast').length
  }))()`)
  ok('① 常驻 role=status（polite）容器存在', init.status === true)
  ok('① 常驻 role=alert（assertive）容器存在', init.alert === true)
  ok('① 初始无 toast 卡片', init.cards === 0)

  // ── ② 卡片无 role + 按 kind 落容器 ──
  await page.eval(`window.__ZJ_TOAST.add({ kind: 'success', title: 'S-ok' })`)
  await page.eval(`window.__ZJ_TOAST.add({ kind: 'error', title: 'E-fail' })`)
  await evalUntil(page, `document.querySelectorAll('.zj-toast').length === 2`, (v) => v === true, 5000, '两条出现')
  const place = await page.eval(`(() => {
    const card = (txt) => [...document.querySelectorAll('.zj-toast')].find((t) => t.innerText.includes(txt))
    const inRegion = (el, sel) => { let p = el && el.parentElement; while (p && p !== document.body) { if (p.matches(sel)) return true; p = p.parentElement } return false }
    const sc = card('S-ok'), ec = card('E-fail')
    return { sRole: sc && sc.getAttribute('role'), eRole: ec && ec.getAttribute('role'), sInStatus: inRegion(sc, '[role="status"]'), eInAlert: inRegion(ec, '[role="alert"]') }
  })()`)
  ok('② 卡片不带 role（live region 由常驻容器承担）', place.sRole === null && place.eRole === null, JSON.stringify(place))
  ok('② success 落在 polite 容器', place.sInStatus === true)
  ok('② error 落在 assertive 容器', place.eInAlert === true)
  const iconHidden = await page.eval(`(() => { const svg = [...document.querySelectorAll('.zj-toast')][0].querySelector('svg'); return svg ? svg.getAttribute('aria-hidden') : 'NOSVG' })()`)
  ok('② 图标 aria-hidden=true', iconHidden === 'true', 'aria-hidden=' + iconHidden)
  await page.eval(`window.__ZJ_TOAST.clear()`)
  await sleep(400)

  // ── ③ focus 暂停（2.2.1）──
  await page.eval(`window.__ZJ_TOAST.add({ kind: 'info', title: 'F-pause', duration: 1200 })`)
  await evalUntil(page, `!!document.querySelector('.zj-toast')`, (v) => v === true, 5000, '出现')
  await page.eval(`document.querySelector('.zj-toast button[aria-label="关闭通知"]').focus()`)
  await sleep(1700)
  const still = await page.eval(`document.querySelectorAll('.zj-toast').length`)
  ok('③ focus 内计时暂停（1.7s > 1.2s 时长仍在）', still === 1, 'count=' + still)
  await page.eval(`document.activeElement && document.activeElement.blur()`)
  await sleep(1800)
  const gone = await page.eval(`document.querySelectorAll('.zj-toast').length`)
  ok('③ blur 后恢复计时并移除', gone === 0, 'count=' + gone)

  // ── ④ 窄窗 1000 / 800 无横向溢出 ──
  const narrow = async (w) => {
    await page.cmd('Emulation.setDeviceMetricsOverride', { width: w, height: 700, deviceScaleFactor: 1, mobile: false })
    await sleep(200)
    await page.eval(`window.__ZJ_TOAST.add({ kind: 'warning', title: '窄窗压力测试标题比较长一些看看会不会换行', description: '这是一段比较长的描述文本，用于验证窄窗口下 toast 卡片是否会横向溢出容器或者挤压换行异常。' })`)
    await sleep(150)
    const r = await page.eval(`(() => {
      const t = document.querySelector('.zj-toast'); if (!t) return null
      const holder = t.parentElement
      return { ovx: holder.scrollWidth > holder.clientWidth + 1, w: t.scrollWidth, cw: t.clientWidth }
    })()`)
    ok('④ 窄窗 ' + w + ' 无横向溢出', r && !r.ovx, JSON.stringify(r))
    await page.eval(`window.__ZJ_TOAST.clear()`)
    await sleep(300)
  }
  await narrow(1000)
  await narrow(800)
  await page.cmd('Emulation.clearDeviceMetricsOverride')
  await sleep(200)

  // ── ⑤ dark 语义色 ──
  await page.eval(`document.documentElement.classList.add('dark')`)
  await sleep(150)
  await page.eval(`window.__ZJ_TOAST.add({ kind: 'success', title: 'D-dark' })`)
  await evalUntil(page, `!!document.querySelector('.zj-toast')`, (v) => v === true, 5000, 'dark toast')
  const dark = await page.eval(`getComputedStyle(document.querySelector('.zj-toast')).backgroundColor`)
  ok('⑤ dark 背景非纯白', dark !== 'rgb(255, 255, 255)', dark)
  await page.eval(`document.documentElement.classList.remove('dark')`)
  await page.eval(`window.__ZJ_TOAST.clear()`)
  await sleep(300)

  // ── ⑥ 常驻 action × 4 占满后新 toast 挤掉最旧 ──
  await page.eval(`(() => { for (let i = 1; i <= 4; i++) window.__ZJ_TOAST.add({ kind: 'error', title: 'A' + i, action: { label: '重试', onClick: () => {} } }); return 1 })()`)
  await sleep(150)
  await page.eval(`window.__ZJ_TOAST.add({ kind: 'info', title: '挤入' })`)
  await sleep(600)
  const mix = await page.eval(`[...document.querySelectorAll('.zj-toast')].map((t) => t.innerText.split('\\n')[0])`)
  ok('⑥ 4 常驻 action 占满，第 5 条挤掉最旧 A1', !mix.includes('A1') && mix.includes('挤入'), JSON.stringify(mix))
  await page.eval(`window.__ZJ_TOAST.clear()`)
  await sleep(300)

  // ── ⑦ 无 JS 异常 ──
  const errs = page.errors.filter((e) => !/ResizeObserver/.test(e) && !/Download the React DevTools/.test(e))
  ok('⑦ 无 JS 异常', errs.length === 0, errs.slice(0, 3).join(' ;; '))
} catch (e) {
  console.error('FATAL ' + e.message)
  fails++
} finally {
  page.close()
  console.log(fails === 0 ? 'SMOKE PASS' : 'SMOKE FAIL (' + fails + ')')
  process.exit(fails === 0 ? 0 : 1)
}
