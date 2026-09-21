// 织卷无头走查 · 时间线页加载态（四态存量核对收口，2026-09-21 11:15 体验层轮）
// 断言：loading 期页头（标题+同步记录按钮）常驻不闪失 / 完成后正常 / 切项目不闪旧数据 / 错误态回归
// 用法：node scripts/timeline-loading-ui-smoke.mjs
// 前置：npm run build；out/renderer 由本机供给；无头 Chrome CDP 127.0.0.1:9224
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
async function evalUntil(page, expr, pred, timeoutMs = 20000, label = expr) {
  const t0 = Date.now()
  for (;;) {
    try {
      const v = await page.eval(expr)
      if (pred(v)) return v
    } catch { /* 重试 */ }
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(200)
  }
}

// 页面常态快照
const snapExpr = `(() => ({
  title: !!document.querySelector('h2'),
  syncBtn: !!document.querySelector('[data-testid="sync-log-open"]'),
  spinner: document.body.innerText.includes('正在读取项目时间线'),
  errCard: document.body.innerText.includes('读取时间线失败'),
  cards: document.querySelectorAll('section[aria-label^="时间线："] li').length
}))()`

let fail = 0
const check = (name, cond, extra = '') => {
  const ok = !!cond
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' | ' + extra : ''))
  if (!ok) fail++
}

// ---------- A. loading 期页头常驻（zj-delay=1500） ----------
{
  const url = BASE + '/?zj-delay=listSlices:1500&cb=loadA#/project/demo-aseya/timeline'
  const tab = await openTab(url)
  const page = await attach(tab.webSocketDebuggerUrl)
  await sleep(450)
  const s1 = await page.eval(snapExpr)
  check('A1 loading: 页头标题常驻', s1.title, JSON.stringify(s1))
  check('A2 loading: 同步记录按钮常驻', s1.syncBtn)
  check('A3 loading: spinner 显示', s1.spinner)
  check('A4 loading: 无卡片（未就绪不闪内容）', s1.cards === 0)
  const s2 = await evalUntil(page, snapExpr, (s) => s.cards > 0, 15000, 'loaded')
  check('A5 loaded: 标题仍常驻', s2.title, JSON.stringify(s2))
  check('A6 loaded: 同步记录仍常驻', s2.syncBtn)
  check('A7 loaded: spinner 消失', !s2.spinner)
  check('A8 loaded: 卡片出现', s2.cards > 0)
  check('A9 零 JS 异常', page.errors.length === 0, page.errors.slice(0, 3).join(' ;; '))
  page.close()
}

// ---------- B. 切项目不闪旧数据（demo-aseya → demo-order） ----------
{
  const url = BASE + '/?zj-delay=listSlices:1200&cb=loadB#/project/demo-aseya/timeline'
  const tab = await openTab(url)
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, snapExpr, (s) => s.cards > 0, 15000, 'aseya loaded')
  const aseyaCards = (await page.eval(snapExpr)).cards
  // 切到另一项目（hash 变化）：加载期不得出现旧项目卡片
  await page.eval(`location.hash = '#/project/demo-order/timeline'`)
  await sleep(400)
  const s3 = await page.eval(snapExpr)
  check('B1 切项目 loading: 旧项目卡片不闪现', s3.cards === 0, JSON.stringify(s3))
  check('B2 切项目 loading: 页头常驻', s3.title && s3.syncBtn)
  check('B3 切项目 loading: spinner 显示', s3.spinner)
  await evalUntil(page, snapExpr, (s) => s.cards > 0, 15000, 'order loaded')
  const s4 = await page.eval(snapExpr)
  check('B4 切项目完成: 新项目卡片加载', s4.cards > 0, JSON.stringify({ aseyaCards, ...s4 }))
  check('B5 切项目零 JS 异常', page.errors.length === 0, page.errors.slice(0, 3).join(' ;; '))
  page.close()
}

// ---------- C. 错误态回归（zj-fail-x=listSlices） ----------
{
  const url = BASE + '/?zj-fail-x=listSlices&cb=loadC#/project/demo-aseya/timeline'
  const tab = await openTab(url)
  const page = await attach(tab.webSocketDebuggerUrl)
  const s5 = await evalUntil(page, snapExpr, (s) => s.errCard, 10000, 'err card')
  check('C1 错误卡出现', s5.errCard, JSON.stringify(s5))
  check('C2 错误态页头常驻', s5.title && s5.syncBtn)
  check('C3 零 JS 异常', page.errors.length === 0, page.errors.slice(0, 3).join(' ;; '))
  page.close()
}

console.log('---')
console.log(fail === 0 ? 'ALL PASS' : 'FAILED: ' + fail)
process.exit(fail === 0 ? 0 : 1)
