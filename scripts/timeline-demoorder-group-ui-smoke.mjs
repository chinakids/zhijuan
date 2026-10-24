// 织卷无头冒烟 · 多时间线视图·demo-order「潮汐的岔路」按线分组（跨线重名 R7 种子）基线锁定
// 覆盖：时间线页按线分组在含「跨线重名切片名 + 双线交错」种子的项目上正确呈现（封版目标① 时间线视图可按线查看）
// 用法：node scripts/timeline-demoorder-group-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；无头 Chrome CDP 127.0.0.1:9224
import { writeFileSync, mkdirSync } from 'node:fs'

const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const OUT = process.env.HOME + '/Pictures/zhijuan'
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const cb = Date.now()
let fails = 0
function ok(name, cond, detail = '') {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + String(detail).slice(0, 160) : ''))
  if (!cond) fails++
}

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
async function evalUntil(page, expr, pred, timeout = 20000, label = '') {
  const t0 = Date.now()
  for (;;) {
    const v = await page.eval(expr)
    if (pred(v)) return v
    if (Date.now() - t0 > timeout) throw new Error('timeout ' + label + ' last=' + JSON.stringify(v).slice(0, 160))
    await sleep(300)
  }
}

const url = BASE + '/?cb=' + cb + '#/project/demo-order/timeline'
const tab = await openTab(url)
const page = await attach(tab.webSocketDebuggerUrl)
try {
  await evalUntil(page, "document.body.innerText.includes('项目时间线')", (v) => v === true, 20000, 'timeline load')
  ok('A 时间线页多线描述与线筛选 chips 出现', (await page.eval("document.body.innerText.includes('按线分组')")) === true)
  const tabs = await page.eval("Array.from(document.querySelectorAll('[role=tab]')).map(x => x.textContent)")
  ok('B 线筛选 chips：全部 + 主线 + 过去线（含章数）', JSON.stringify(tabs) === JSON.stringify(['全部', '主线 · 3', '过去线 · 3']), JSON.stringify(tabs))
  const groups = await page.eval("Array.from(document.querySelectorAll('[data-testid=timeline-line-head]')).map(x => x.textContent)")
  ok('C 线组头：主线/过去线', JSON.stringify(groups) === JSON.stringify(['主线', '过去线']), JSON.stringify(groups))
  const perGroup = await page.eval(
    "Array.from(document.querySelectorAll('section[aria-label^=时间线]')).map(sec => ({ line: sec.getAttribute('aria-label'), heads: Array.from(sec.querySelectorAll('li')).map(li => ((li.textContent.match(/(第\\s*\\d+\\s*章)/)||[])[0] || '')).filter(Boolean) }))"
  )
  ok(
    'D 各线组内按线内时序排列',
    JSON.stringify(perGroup) === JSON.stringify([
      { line: '时间线：主线', heads: ['第1章', '第3章', '第5章'] },
      { line: '时间线：过去线', heads: ['第2章', '第4章', '第6章'] }
    ]),
    JSON.stringify(perGroup)
  )
  const mainHeads = (perGroup.find((g) => g.line === '时间线：主线') || {}).heads || []
  ok('E 跨线重名不串线（主线组不含过去线章）', !mainHeads.includes('第2章') && !mainHeads.includes('第6章'), JSON.stringify(mainHeads))
  const dupSeen = await page.eval("(document.body.innerText.match(/第一幕_潮起/g)||[]).length")
  ok('F 跨线重名切片名分别呈现于各线组（≥2 次）', dupSeen >= 2, 'occurrences=' + dupSeen)
  ok('G 全程无 JS 异常', page.errors.length === 0, page.errors.slice(0, 3).join('; '))
  const ham = String(new Date().getHours()).padStart(2, '0') + String(new Date().getMinutes()).padStart(2, '0')
  const shot = `${OUT}/timeline-demoorder-group-${ham}.png`
  const sc = await page.cmd('Page.captureScreenshot', { format: 'png' })
  writeFileSync(shot, Buffer.from(sc.data, 'base64'))
  console.log('SCREENSHOT: ' + shot)
} catch (e) {
  console.log('ERR ' + e.message)
  fails++
}
await page.close()
console.log(fails ? `FAILS ${fails}` : 'ALL PASS')
process.exit(fails ? 1 : 0)
