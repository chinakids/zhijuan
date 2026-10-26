// 织卷无头冒烟 · 设置页：返回按钮 + 大模型连接检测（F-20261026）
// 链路：进设置(engine)->返回按钮存在->选 DeepSeek->连接检测->显示「未填写 API Key」诊断->返回回首页
// 用法：node scripts/settings-llm-check-ui-smoke.mjs
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

const tab = await openTab(BASE + '/?cb=' + Date.now())
const page = await attach(tab.webSocketDebuggerUrl)
try {
  await evalUntil(page, `typeof window.zhijuan?.setSettings === 'function'`, (v) => v === true, 20000, 'zhijuan 就绪')
  await page.eval(`window.zhijuan.setSettings({ settingsPane: 'engine' }).then(() => (location.hash = '#/project/demo-aseya/settings', 1))`)
  await sleep(1500)
  await evalUntil(page, `document.body.innerText.includes('连接检测')`, (v) => v === true, 15000, '连接检测区出现')

  // ① 返回按钮存在
  const back = await page.eval(`!!document.querySelector('[data-testid="settings-back"]')`)
  ok('设置页含「返回」按钮', back === true)

  // ② 连接检测按钮存在
  const chk = await page.eval(`!!document.querySelector('[data-testid="llm-check"]')`)
  ok('设置页含「连接检测」按钮', chk === true)

  // ③ 选 DeepSeek 服务商
  await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === 'DeepSeek'); if (b) { b.click(); return true } return false })()`)
  await sleep(400)

  // ④ 连接检测（无 key -> 提示未填写 API Key）
  await page.eval(`document.querySelector('[data-testid="llm-check"]').click()`)
  await evalUntil(page, `(() => { const r = document.querySelector('[data-testid="llm-check-result"]'); return r ? r.innerText : '' })()`, (v) => typeof v === 'string' && v.includes('API Key'), 15000, '连接检测诊断结果')
  const res = await page.eval(`document.querySelector('[data-testid="llm-check-result"]')?.innerText || ''`)
  ok('DeepSeek 无 Key 诊断「未填写 API Key」', res.includes('API Key'), res.slice(0, 40))

  // ⑤ 返回按钮回首页
  await page.eval(`document.querySelector('[data-testid="settings-back"]').click()`)
  await sleep(900)
  const backHome = await page.eval(`location.hash`)
  ok('返回按钮跳转首页', /#\/$|#\/?$/.test(backHome) || backHome === '#/', backHome)

  // ⑥ 复制诊断按钮存在
  await page.eval(`window.zhijuan.setSettings({ settingsPane: 'engine' }).then(() => (location.hash = '#/project/demo-aseya/settings', 1))`)
  await sleep(1200)
  await page.eval(`document.querySelector('[data-testid="llm-check"]').click()`)
  await sleep(700)
  const copy = await page.eval(`!!document.querySelector('[data-testid="llm-copy"]')`)
  ok('连接检测结果含「复制诊断」', copy === true)
} catch (e) {
  console.error('FATAL', e.message)
  fail++
} finally {
  try { await fetch(CDP + '/json/close/' + tab.id) } catch {}
}
console.log('RESULT ' + (fail ? fail + ' FAIL' : 'ALL OK'))
process.exit(fail ? 1 : 0)
