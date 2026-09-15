// 织卷无头冒烟 · 同步记录（切片同步历史日志）查看链路（创作层 2026-09-16 候选 2）
// 用法：node scripts/sync-log-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs（8123）；本机专用无头 Chrome CDP 127.0.0.1:9224
// 链路（devShim 演示项目 + ?zj-synclog=3 预置 3 条演示记录）：
//   Tab A：时间线页「同步记录」→ 抽屉 3 条（最新在前：第03章/第02章/第01章，第01章失败态）
//          → 收起 → 重开 → 真调 window.zhijuan.agentSync 产生第 4 条（最新）
//   Tab B：无预置 → 抽屉空态「还没有同步记录」
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

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
        shot: async (file) => {
          const s = await cmd('Page.captureScreenshot', { format: 'png' })
          mkdirSync(join(homedir(), 'Pictures', 'zhijuan'), { recursive: true })
          writeFileSync(join(homedir(), 'Pictures', 'zhijuan', file), Buffer.from(s.data, 'base64'))
        },
        close: () => ws.close()
      })
  })
}
async function evalUntil(page, expr, pred, timeoutMs = 20000, label = expr) {
  const t0 = Date.now()
  let last = ''
  for (;;) {
    try {
      const v = await page.eval(expr)
      if (pred(v)) return v
      last = 'v=' + JSON.stringify(v)
    } catch (e) {
      last = 'EXC ' + e.message
    }
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label + ' | last: ' + last)
    await sleep(300)
  }
}
const bodyHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
const qSel = (sel) => `document.querySelectorAll(${JSON.stringify(sel)})`
const clickByText = (text) => `(() => {
  const els = [...document.querySelectorAll('button')]
  const el = els.find((b) => (b.innerText || '').includes(${JSON.stringify(text)}))
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

// ---------- Tab A：预置 3 条演示记录（最新在前） ----------
{
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-synclog=3#/project/demo-aseya/timeline')
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    await evalUntil(page, bodyHas('项目时间线'), Boolean, 20000, '时间线页载入')
    ok('A① 时间线页加载且有「同步记录」按钮', await page.eval(`!!document.querySelector('[data-testid="sync-log-open"]')`))

    await page.eval(`document.querySelector('[data-testid="sync-log-open"]').click()`)
    await evalUntil(page, `document.querySelector('[role="dialog"][aria-label="同步记录"]') !== null`, Boolean, 10000, '抽屉打开')
    ok('A② 抽屉打开（role=dialog + aria-label=同步记录）', true)

    await evalUntil(page, `${qSel('[data-testid="sync-log-item"]')}.length`, (n) => n >= 3, 10000, '3 条记录出现')
    const items = await page.eval(`[...document.querySelectorAll('[data-testid="sync-log-item"]')].map((d) => d.innerText.replace(/\\s+/g, ' ').trim())`)
    ok('A③ 渲染 3 条记录', items.length === 3, 'n=' + items.length)
    ok('A④ 最新在前：首条为第03章', items[0]?.includes('第03章') && items[0]?.includes('切片「雾港夜」'), items[0])
    ok('A⑤ 次条含「提案 2」（i=2 种子）', (items[1] || '').includes('提案 2'), items[1])
    ok('A⑥ 末条为失败态（第01章 ok=false 显示「失败」）', (items[2] || '').includes('第01章') && (items[2] || '').includes('失败'), items[2])
    ok('A⑦ 守卫徽标在含守卫的条目（第03章 guard=1）', (items[0] || '').includes('守卫 1'), items[0])
    ok('A⑧ 头注「最近 3 条」', await page.eval(bodyHas('最近 3 条')))

    await page.shot('sync-log-drawer-' + new Date().toTimeString().slice(0, 5).replace(':', '') + '.png')

    // 收起 → 抽屉消失
    await page.eval(`document.querySelector('[data-testid="sync-log-close"]').click()`)
    await sleep(300)
    ok('A⑨ 「收起」后抽屉关闭', await page.eval(`document.querySelector('[role="dialog"][aria-label="同步记录"]') === null`))

    // 重开 + 真调 agentSync（devShim 与真机同入口语义）→ 新增 1 条且最新在后？unshift=最新在前
    await page.eval(`document.querySelector('[data-testid="sync-log-open"]').click()`)
    await evalUntil(page, `document.querySelector('[role="dialog"][aria-label="同步记录"]') !== null`, Boolean, 10000, '重开抽屉')
    const before = await page.eval(`window.zhijuan.syncLogList('demo-aseya').then((l) => l.length)`)
    await page.eval(`window.zhijuan.agentSync('demo-aseya', '正文/第01章_雾港.md')`)
    await evalUntil(
      page,
      `window.zhijuan.syncLogList('demo-aseya').then((l) => l.length)`,
      (n) => typeof n === 'number' && n === before + 1,
      10000,
      'agentSync 后新增 1 条'
    )
    ok('A⑩ 真调 agentSync 后日志 +1 条（旁路记录链路通）', true)
    const top = await page.eval(`window.zhijuan.syncLogList('demo-aseya').then((l) => l[0].chapter)`)
    ok('A⑪ 新增条目为最新（列表首位）', top === '正文/第01章_雾港.md', top)
    // UI 重载：抽屉打开时才拉取——re-open 后应展示 4 条
    await page.eval(`document.querySelector('[data-testid="sync-log-close"]').click()`)
    await sleep(300)
    await page.eval(`document.querySelector('[data-testid="sync-log-open"]').click()`)
    await evalUntil(page, `${qSel('[data-testid="sync-log-item"]')}.length`, (n) => n >= 4, 10000, '4 条记录出现')
    ok('A⑫ 重开后 UI 显示 4 条（最新在上）', true)
  } finally {
    page.close()
  }
}

// ---------- Tab B：无预置 → 空态 ----------
{
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/timeline')
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    await evalUntil(page, bodyHas('项目时间线'), Boolean, 20000, '时间线页载入（B）')
    await page.eval(`document.querySelector('[data-testid="sync-log-open"]').click()`)
    await evalUntil(page, `document.querySelector('[role="dialog"][aria-label="同步记录"]') !== null`, Boolean, 10000, '抽屉打开（B）')
    await evalUntil(page, bodyHas('还没有同步记录'), Boolean, 10000, '空态文案')
    ok('B① 无记录时显示「还没有同步记录」空态', true)
  } finally {
    page.close()
  }
}

console.log('')
console.log(`RESULT: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
