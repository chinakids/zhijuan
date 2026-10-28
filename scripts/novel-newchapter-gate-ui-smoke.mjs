// 织卷无头冒烟 · 正文页「新建章节」弹窗门控（2026-10-28 主人反馈）
// 有章节：进入正文页 / 切走再回来，均不得自动弹「新建章节」
// 空章节（?zj-empty=chapters）：进入正文页应弹一次
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
const dialogOpen = `[...document.querySelectorAll('[role="dialog"]')].some(d => (d.innerText||'').includes('新建章节'))`

// ① 有章节的项目
const t1 = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
const p1 = await attach(t1.webSocketDebuggerUrl)
try {
  await evalUntil(p1, `document.body.innerText.includes('正文创作')`, (v) => v === true, 20000, 'novel 就绪')
  await sleep(1500)
  ok('有章节进入正文页不弹新建章节', (await p1.eval(dialogOpen)) === false)
  // 切到资料库再切回（模拟点「正文创作」）
  await p1.eval(`(location.hash = '#/project/demo-aseya/library', 1)`)
  await sleep(1000)
  await p1.eval(`(location.hash = '#/project/demo-aseya/novel', 1)`)
  await sleep(1500)
  ok('切走再回正文页不弹新建章节', (await p1.eval(dialogOpen)) === false)
} catch (e) { console.error('FATAL p1', e.message); fail++ } finally { try { await fetch(CDP + '/json/close/' + t1.id) } catch {} }

// ② 空章节项目（devShim 注入 chapters 为空）
const t2 = await openTab(BASE + '/?zj-empty=chapters&cb=' + Date.now() + '#/project/demo-aseya/novel')
const p2 = await attach(t2.webSocketDebuggerUrl)
try {
  await evalUntil(p2, `document.body.innerText.includes('正文创作')`, (v) => v === true, 20000, '空项目 novel 就绪')
  await evalUntil(p2, dialogOpen, (v) => v === true, 8000, '空章节自动弹建章').catch(() => {})
  ok('空章节进入正文页自动弹新建章节', (await p2.eval(dialogOpen)) === true)
} catch (e) { console.error('FATAL p2', e.message); fail++ } finally { try { await fetch(CDP + '/json/close/' + t2.id) } catch {} }

console.log('RESULT ' + (fail ? fail + ' FAIL' : 'ALL OK'))
process.exit(fail ? 1 : 0)