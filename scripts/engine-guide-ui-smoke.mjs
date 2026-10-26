// 织卷无头冒烟 · 首启引擎配置引导（?zj-engineoff 注入离线态）
// 链路：离线首页→横幅「写作引擎未就绪」→点「去配置写作引擎」→跳 #/settings 且 pane=engine
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

const tab = await openTab(BASE + '/?zj-engineoff&cb=' + Date.now())
const page = await attach(tab.webSocketDebuggerUrl)
try {
  await evalUntil(page, `typeof window.zhijuan?.setSettings === 'function'`, (v) => v === true, 20000, 'zhijuan 就绪')
  // 首页横幅出现
  await evalUntil(page, `!!document.querySelector('[data-testid="engine-guide-banner"]')`, (v) => v === true, 15000, '引擎引导横幅')
  const t = await page.eval(`document.querySelector('[data-testid="engine-guide-banner"]')?.innerText || ''`)
  ok('首页显示引擎引导横幅', t.includes('写作引擎未就绪'), t.slice(0, 30))
  // 点击去配置 → 跳全局设置 engine pane
  await page.eval(`(() => { const b = [...document.querySelectorAll('[data-testid="engine-guide-banner"] button')][0]; if (b) { b.click(); return true } return false })()`)
  await sleep(1200)
  const hash = await page.eval(`location.hash`)
  const pane = await page.eval(`document.querySelector('[data-testid="llm-check"]') ? 'engine' : 'other'`)
  ok('去配置跳转设置页(engine区)', hash.includes('/settings') && pane === 'engine', hash + ' pane=' + pane)
} catch (e) {
  console.error('FATAL', e.message)
  fail++
} finally {
  try { await fetch(CDP + '/json/close/' + tab.id) } catch {}
}
console.log('RESULT ' + (fail ? fail + ' FAIL' : 'ALL OK'))
process.exit(fail ? 1 : 0)
