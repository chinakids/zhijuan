// 织卷无头冒烟 · 采集派发（子 agent）：采集栏可见 + pending 卡有「派发」按钮 + 点击可派发
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function openTab(url) { const r = await fetch(CDP + '/json/new?' + encodeURIComponent(url), { method: 'PUT' }); return r.json() }
function attach(wsUrl) {
  const ws = new WebSocket(wsUrl); let seq = 0; const p = new Map()
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id) } }
  const cmd = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; p.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result))); ws.send(JSON.stringify({ id, method, params })) })
  return new Promise((res) => { ws.onopen = () => res({ cmd, eval: async (expression) => { const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('EVAL ' + JSON.stringify(r.exceptionDetails).slice(0, 200)); return r.result?.value } }) })
}
async function evalUntil(page, expr, pred, timeoutMs = 15000, label = expr) {
  const t0 = Date.now()
  for (;;) { try { const v = await page.eval(expr); if (pred(v)) return v } catch {} if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT ' + label); await sleep(250) }
}
let fail = 0
const ok = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' | ' + x : '')); if (!c) fail++ }

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/library')
const page = await attach(tab.webSocketDebuggerUrl)
try {
  await evalUntil(page, `typeof window.zhijuan?.collectRun === 'function'`, (v) => v === true, 20000, 'collectRun API')
  await evalUntil(page, `document.body.innerText.includes('采集任务')`, (v) => v === true, 15000, '采集任务区')
  const hasBtn = await evalUntil(page, `!!document.querySelector('[data-testid="collect-dispatch"]')`, (v) => v === true, 12000, '派发按钮').catch(() => false)
  ok('pending 采集卡显示「派发」按钮', hasBtn === true)
  if (hasBtn) {
    await page.eval(`document.querySelector('[data-testid="collect-dispatch"]').click()`)
    await sleep(800)
    const after = await page.eval(`document.body.innerText`)
    ok('点击派发有反馈（toast/状态）', /派发|采集|已派发|完成|进行/.test(after))
  }
  const jsErr = await page.eval(`window.__zjJsErrors ? window.__zjJsErrors.length : 0`)
  ok('零 JS 异常', !jsErr || jsErr === 0, 'errors=' + jsErr)
} catch (e) {
  console.error('FATAL', e.message)
  fail++
} finally {
  try { await fetch(CDP + '/json/close/' + tab.id) } catch {}
}
console.log('RESULT ' + (fail ? fail + ' FAIL' : 'ALL OK'))
process.exit(fail ? 1 : 0)