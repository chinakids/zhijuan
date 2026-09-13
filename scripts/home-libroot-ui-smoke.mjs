// 织卷无头冒烟 · 首页项目库可见性（模块设计 §四 A：底栏「当前库根」+「库根路径（可改）」）
// 用法：node scripts/home-libroot-ui-smoke.mjs
// 前置：out/renderer 已 build；python3 scripts/spa_server.py 8123 --directory out/renderer；本机无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 底栏出现「当前项目库：<生效库根>」且路径与 getPaths().documents 动态一致（不硬编）；
//         ② 路径元素 truncate 抗窄窗、按钮 whitespace-nowrap 不换行；
//         ③ 点击「更改库根路径…」→ devShim 模拟选库 → footer 路径更新为新库 → toast「已更改项目库」；
//         ④ 决策链随动：getPaths().documents 已等于新库；
//         ⑤ 全程零 JS 异常。
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const ok = (label) => console.log('OK', label)
const bad = (label, why) => {
  failures++
  console.log('FAIL', label, '::', why)
}

async function openTab(url) {
  const r = await fetch(CDP + '/json/new?' + encodeURIComponent(url), { method: 'PUT' })
  return r.json()
}

function attach(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let seq = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const cmd = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq
      pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
      ws.send(JSON.stringify({ id, method, params }))
    })
  return new Promise((res) => {
    ws.onopen = () =>
      res({
        cmd,
        eval: async (expression) => {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
          return r.result?.value
        },
        close: () => ws.close()
      })
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

// ===================== 主流程 =====================
const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)

try {
  await page.eval(`(() => {
    window.__zjErr = []
    window.addEventListener('error', (e) => window.__zjErr.push(String(e.message || e)))
    window.addEventListener('unhandledrejection', (e) => window.__zjErr.push('REJ:' + String(e.reason)))
  })()`)

  await evalUntil(
    page,
    `!!document.querySelector('[data-testid="home-libroot"]')`,
    (v) => v === true,
    20000,
    '首页底栏就绪'
  )
  ok('① 首页底栏（当前项目库）就绪')

  // ① 路径与 getPaths().documents 动态一致（devShim 返回含 ~ 字面量，不硬编）
  const footerText = await page.eval(`document.querySelector('[data-testid="home-libroot"]').innerText`)
  const doc = await page.eval(`window.zhijuan.getPaths().then(p => p.documents)`)
  if (!footerText.startsWith('当前项目库：')) bad('① footer 前缀', footerText)
  else if (!footerText.endsWith(doc)) bad('① 路径与生效库根一致', `footer=${footerText} doc=${doc}`)
  else ok('① 路径与 getPaths().documents 一致（' + doc + '）')

  // ② 抗窄窗：路径 truncate、按钮 whitespace-nowrap
  const cls = await page.eval(`(() => {
    const p = document.querySelector('[data-testid="home-libroot"]')
    const btn = [...document.querySelectorAll('footer button')].find(b => b.textContent.includes('更改库根路径'))
    return { pCls: p.className, btnCls: btn ? btn.className : '', btnText: btn ? btn.textContent : '' }
  })()`)
  if (!cls.pCls.includes('truncate')) bad('② 路径 truncate', cls.pCls)
  else ok('② 路径 truncate 抗窄窗')
  if (!cls.btnCls.includes('whitespace-nowrap') || !cls.btnText.includes('更改库根路径')) bad('② 按钮不换行', JSON.stringify(cls))
  else ok('② 按钮 whitespace-nowrap（' + cls.btnText + '）')

  // ③ 点击「更改库根路径…」→ devShim 模拟选库 → footer 更新 → toast 出现
  await page.eval(`(() => {
    const btn = [...document.querySelectorAll('footer button')].find(b => b.textContent.includes('更改库根路径'))
    btn.click()
  })()`)
  await evalUntil(
    page,
    `document.querySelector('[data-testid="home-libroot"]').innerText`,
    (v) => v.includes('织卷-dev-项目库'),
    15000,
    'footer 路径已更新为新库'
  )
  ok('③ 点击后 footer 路径更新为 dev 新库')
  const toastSeen = await page.eval(`document.body.innerText.includes('已更改项目库')`)
  if (!toastSeen) bad('③ toast 已更改项目库', '未出现')
  else ok('③ toast「已更改项目库」出现')

  // ④ 决策链随动：getPaths().documents == 新库
  const doc2 = await page.eval(`window.zhijuan.getPaths().then(p => p.documents)`)
  if (!doc2.includes('织卷-dev-项目库')) bad('④ getPaths 随动新库', doc2)
  else ok('④ getPaths().documents 随动（' + doc2 + '）')

  // ⑤ 零 JS 异常
  const errs = await page.eval(`window.__zjErr || []`)
  if (errs.length > 0) bad('⑤ 零 JS 异常', JSON.stringify(errs))
  else ok('⑤ 零 JS 异常')
} catch (e) {
  failures++
  console.log('FAIL 主流程异常 ::', e.message)
}

await fetch(CDP + '/json/close/' + tab.id).catch(() => {})
page.close()

console.log(failures === 0 ? '\nSMOKE PASS (5 项)' : `\nSMOKE FAIL (${failures} failures)`)
process.exit(failures === 0 ? 0 : 1)
