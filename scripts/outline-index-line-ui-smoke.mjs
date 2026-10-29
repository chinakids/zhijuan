// 织卷无头冒烟 · 大纲索引「按线分布」+ 章块线标记（封版目标① 双线中篇结构可见性）
// 覆盖：多线项目回建后索引按线分布（章数/字数）与章块「（线：X）」（与成品导出同字）；
//       单线项目零冗余（无分布段、无线标记）——避免给老项目加噪声。
// 用法：node scripts/outline-index-line-ui-smoke.mjs
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

// 索引正文（Milkdown 只渲染当前文档；取 ProseMirror 文本，避开左栏章名列表的干扰）
const IDX_TEXT = "(() => { const pm = document.querySelector('.ProseMirror'); const t = pm ? pm.innerText : ''; return t.includes('章卡索引') ? t : document.body.innerText })()"

const tab = await openTab(BASE + '/?cb=' + cb + '#/project/demo-order/outline')
const page = await attach(tab.webSocketDebuggerUrl)
let shot = ''
try {
  // 1) 双线项目：真跑回建（与真机同一 shared 纯函数），索引落盘后页内可见
  await evalUntil(page, "typeof window.zhijuan?.agentOutlineRebuild === 'function'", (v) => v === true, 20000, 'zhijuan api')
  await evalUntil(page, "document.body.innerText.includes('章卡索引')", (v) => v === true, 20000, 'outline load')
  const rb = await page.eval("window.zhijuan.agentOutlineRebuild('demo-order').then(r => r && r.ok === true)")
  ok('A 双线项目回建成功', rb === true, String(rb))
  const txt = await evalUntil(page, IDX_TEXT, (v) => typeof v === 'string' && v.includes('按线分布'), 15000, 'index line stats')

  ok('B 索引出现「按线分布」段', txt.includes('按线分布（章块按章号排列）：'))
  // 渲染层是 Milkdown：列表项/标题的 markdown 前缀不入 innerText（只有文字），断言按可见文本
  const flat = txt.replace(/\s+/g, ' ')
  ok('C 分布按线给章数与字数（主线 · 3 章 / 过去线 · 3 章）', /主线 · 3 章( · \d+ 字)?/.test(flat) && /过去线 · 3 章( · \d+ 字)?/.test(flat), flat.slice(0, 240))
  ok('D 非主线章块带「（线：过去线）」', flat.includes('第2章 · 旧港（线：过去线）'), flat.slice(0, 400))
  ok('E 主线章块不标线（缺省零冗余）', flat.includes('第1章 · 晨港 ') && !flat.includes('第1章 · 晨港（线：'))
  ok('F 跨线重名切片不影响线标记（第06章仍标过去线）', flat.includes('第6章 · 旧港之二（线：过去线）'))

  const ham = String(new Date().getHours()).padStart(2, '0') + String(new Date().getMinutes()).padStart(2, '0')
  shot = `${OUT}/outline-index-line-${ham}.png`
  const sc = await page.cmd('Page.captureScreenshot', { format: 'png' })
  writeFileSync(shot, Buffer.from(sc.data, 'base64'))
  console.log('SCREENSHOT: ' + shot)

  // 2) 单线项目：同一页切项目 → 索引零冗余（无分布段、无线标记）
  await page.eval("location.hash = '#/project/demo-aseya/outline'")
  await evalUntil(page, "document.body.innerText.includes('章卡索引')", (v) => v === true, 20000, 'single-line outline')
  const rb2 = await page.eval("window.zhijuan.agentOutlineRebuild('demo-aseya').then(r => r && r.ok === true)")
  ok('G 单线项目回建成功', rb2 === true, String(rb2))
  const txt2 = await evalUntil(page, IDX_TEXT, (v) => typeof v === 'string' && v.includes('已回建章卡'), 15000, 'single index')
  ok('H 单线索引无「按线分布」（零冗余）', !txt2.includes('按线分布'))
  ok('I 单线章块无线标记', !txt2.includes('（线：'))
  ok('J 全程无 JS 异常', page.errors.length === 0, page.errors.slice(0, 3).join('; '))
} catch (e) {
  console.log('ERR ' + e.message)
  fails++
}
await page.close()
console.log(fails ? `FAILS ${fails}` : 'ALL PASS')
console.log('SHOT ' + shot)
process.exit(fails ? 1 : 0)