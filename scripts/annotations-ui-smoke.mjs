// 织卷无头冒烟 · 批注定时优化（体验/创作层 2026-09-12，配合 devShim 演示批注）
// 用法：node scripts/annotations-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs；本机专用无头 Chrome CDP 127.0.0.1:9224
// 链路（真实用户路径）：设置页开启「批注定时优化」→ 保存 → 回项目 → 打开 10s 后自动首扫
//       → 生成 2 条「批注同步」提案 → 顶栏「待确认提案 2」→ 抽屉「扫描批注」按钮/来源
//       → 接受 → 正文按 before→after 替换 + csv 行删除（含防重：不重复生成）
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

const tab = await openTab(BASE + '/#/project/demo-aseya/settings')
const page = await attach(tab.webSocketDebuggerUrl)
await evalUntil(page, bodyHas('外观与数据'), Boolean, 20000, '设置页加载')
await page.eval(clickBtn('外观与数据', false))
await evalUntil(page, bodyHas('批注定时优化'), Boolean, 10000, '外观节批注开关')

// ① 开启「批注定时优化」开关（行内 switch）并保存
const sw = await page.eval(`(() => {
  const rows = [...document.querySelectorAll('div')].filter((d) => d.textContent && d.textContent.includes('批注定时优化') && d.querySelector('button[role="switch"]'))
  const row = rows[rows.length - 1]
  const s = row && row.querySelector('button[role="switch"]')
  if (!s) return 'NO_SWITCH'
  const checked = s.getAttribute('aria-checked')
  if (checked !== 'true') s.click()
  return 'OK:' + checked
})()`)
ok('设置页存在「批注定时优化」开关', sw === 'OK:false' || sw === 'OK:true', String(sw))
await page.eval(clickBtn('保存设置'))
await sleep(600)

// ② 回项目正文页，等自动首扫（打开 10s 后）
await page.eval(`(() => { location.hash = '#/project/demo-aseya/novel'; return 1 })()`)
await evalUntil(page, bodyHas('第01章'), Boolean, 20000, '正文载入')
await evalUntil(
  page,
  `window.zhijuan.listProposals('demo-aseya').then((ps) => ps.filter((p) => p.source === 'annotation-sync').length)`,
  (v) => Number(v) >= 2,
  30000,
  '自动扫描生成批注提案'
)
const propCount = await page.eval(`window.zhijuan.listProposals('demo-aseya').then((ps) => ps.length)`)
ok('自动首扫生成提案且未重复（恰 2 条）', propCount === 2, 'count=' + propCount)

// ③ 顶栏出现待确认入口
await evalUntil(page, bodyHas('待确认提案 2'), Boolean, 10000, '待确认提案入口')
ok('顶栏显示「待确认提案 2」', true)

// ④ 打开抽屉：来源=批注同步、有「扫描批注」按钮
await page.eval(clickBtn('待确认提案 2'))
await evalUntil(page, bodyHas('扫描批注'), Boolean, 10000, '抽屉扫描按钮')
ok('抽屉含「扫描批注」按钮', true)
const srcTxt = await page.eval(`document.body.innerText.includes('来自：批注同步')`)
ok('提案来源显示「批注同步」', srcTxt === true)

// ⑤ 再点「扫描批注」：pending 未决 → 防重不新增
await page.eval(clickBtn('扫描批注'))
await sleep(800)
const dup = await page.eval(`document.body.innerText.includes('已有待确认的批注提案')`)
ok('重复扫描防重提示', dup === true)

// ⑥ 接受第一条提案 → 正文替换 + csv 行删除
await page.eval(clickBtn('接受'))
await sleep(1200)
const doc = await page.eval(`window.zhijuan.readDoc('demo-aseya', '正文/第01章_雾港_批注.csv')`)
ok('批注 csv 行已删除（剩 1 条）', typeof doc === 'string' && !doc.includes('L10:1') && doc.includes('L12:1'), JSON.stringify(doc))
const md = await page.eval(`window.zhijuan.readDoc('demo-aseya', '正文/第01章_雾港.md')`)
ok('正文按批注意图改写生效', typeof md === 'string' && md.includes('攥着灯的手在抖'), '')

console.log(`RESULT: pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)
