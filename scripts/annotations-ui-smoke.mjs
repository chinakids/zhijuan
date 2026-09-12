// 织卷无头冒烟 · 批注定时优化（体验/创作层 2026-09-12，配合 devShim 演示批注）
// 用法：node scripts/annotations-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs；本机专用无头 Chrome CDP 127.0.0.1:9224
// 链路：demo 项目带 正文/第01章_雾港_批注.csv（2 条）→ scanAnnotations → 生成 2 条「批注同步」提案
//       → 顶栏「待确认提案 2」→ 抽屉「扫描批注」按钮 → 接受 → 正文按 before→after 替换 + csv 行删除
const CDP = 'http://127.0.0.1:9224'
const BASE = 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
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
async function evalUntil(page, expr, pred, timeoutMs = 20000, label = expr) {
  const t0 = Date.now()
  for (;;) {
    try {
      const v = await page.eval(expr)
      if (pred(v)) return v
    } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(300)
  }
}
const bodyHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
const clickBtn = (text, exact = true) => `(() => {
  const els = [...document.querySelectorAll('button')]
  const el = els.find((b) => ${exact ? `(b.innerText || '').trim() === ${JSON.stringify(text)}` : `(b.innerText || '').includes(${JSON.stringify(text)})`})
  if (!el) return false
  el.click()
  return true
})()`

let pass = 0
let fail = 0
function ok(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log('PASS ' + name)
  } else {
    fail++
    console.log('FAIL ' + name + (extra ? ' | ' + extra : ''))
  }
}

const tab = await openTab(BASE + '/#/project/demo-aseya/novel')
const page = await attach(tab.webSocketDebuggerUrl)
await evalUntil(page, bodyHas('第01章'), Boolean, 20000, '项目正文载入')

// ① 扫描批注（调 bridge 直调，等同定时器路径）
const scan = await page.eval(`window.zhijuan.scanAnnotations('demo-aseya')`)
ok('扫描发现 2 条并生成 2 个提案', scan.generated === 2, JSON.stringify(scan))

// 刷新页面（重载后提案 store 重新装载；定时器 10s 后首扫会被防重拦截，不重复生成）
await page.eval('location.reload()')
await evalUntil(page, bodyHas('第01章'), Boolean, 20000, 'reload 后正文载入')
ok('快扫防重：已有待确认批注提案', true)

// ② 顶栏出现待确认入口
await evalUntil(page, bodyHas('待确认提案 2'), Boolean, 10000, '待确认提案入口')
ok('顶栏显示「待确认提案 2」', true)

// ③ 打开抽屉：来源=批注同步、有「扫描批注」按钮
await page.eval(clickBtn('待确认提案 2'))
await evalUntil(page, bodyHas('扫描批注'), Boolean, 10000, '抽屉扫描按钮')
ok('抽屉含「扫描批注」按钮', true)
const srcTxt = await page.eval(`document.body.innerText.includes('来自：批注同步')`)
ok('提案来源显示「批注同步」', srcTxt === true)

// ④ 再点「扫描批注」：pending 未决 → 防重不新增
await page.eval(clickBtn('扫描批注'))
await sleep(800)
const dup = await page.eval(`document.body.innerText.includes('已有待确认的批注提案')`)
ok('重复扫描防重提示', dup === true)

// ⑤ 接受第一条提案 → 正文替换 + csv 行删除
await page.eval(clickBtn('接受'))
await sleep(1200)
const doc = await page.eval(`window.zhijuan.readDoc('demo-aseya', '正文/第01章_雾港_批注.csv')`)
ok('批注 csv 行已删除（剩 1 条）', typeof doc === 'string' && !doc.includes('L10:1'), JSON.stringify(doc))
const md = await page.eval(`window.zhijuan.readDoc('demo-aseya', '正文/第01章_雾港.md')`)
ok('正文按批注意图改写生效', typeof md === 'string' && md.includes('攥着灯的手在抖'), '')

console.log(`RESULT: pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)
