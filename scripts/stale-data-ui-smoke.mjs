// 织卷无头冒烟 · 切项目 stale 数据面（体验层 2026-09-22；Timeline 样板「切项目先回 loading 防旧数据闪现」全站核查）
// 验证：⌘K 项目搜索/浏览器前进后退直接切换项目（同路由组件复用）时——
//   Workspace：回 loading 骨架，旧项目名不残留；Novel 章列 / Outline 章卡列 / DocSection 文档列 /
//   LibraryBrowser 素材树：切项目加载窗口显示「正在读取…」且旧项目数据不残留，新数据最终到达。
// 用法：node scripts/stale-data-ui-smoke.mjs
// 前置：npm run build && node scripts/serve-renderer.mjs（已跑）；本机专用无头 Chrome CDP 127.0.0.1:9224
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
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
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

async function evalUntil(page, expr, pred, timeoutMs = 25000, label = expr) {
  const t0 = Date.now()
  for (;;) {
    try {
      const v = await page.eval(expr)
      if (pred(v)) return v
    } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(200)
  }
}

const bodyHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
const go = (hash) => `location.hash = ${JSON.stringify(hash)}`

let pass = 0
let fail = 0
async function step(name, fn) {
  try {
    await fn()
    pass++
    console.log('PASS', name)
  } catch (e) {
    fail++
    console.log('FAIL', name, '-', e.message)
  }
}

// ① Workspace 切项目：回 loading 骨架（旧项目名不残留）→ 新项目名到达
await step('① Workspace 切项目回骨架、旧项目名不残留', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-delay=listProjects:1200#/project/demo-aseya/novel')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('余烬的灯'), Boolean, 25000, 'project A loaded')
  await page.eval(go('#/project/demo-order/novel'))
  await evalUntil(page, bodyHas('正在打开项目'), Boolean, 12000, 'workspace loading')
  if (await page.eval(bodyHas('余烬的灯'))) throw new Error('旧项目名残留')
  await evalUntil(page, bodyHas('潮汐的岔路'), Boolean, 25000, 'project B loaded')
  page.close()
})

// ② Novel 章列：切项目加载窗口「正在读取章节…」+ 旧章名不残留 → 新章到达
await step('② Novel 章列切项目无旧章残留', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-delay=listChapters:1200#/project/demo-aseya/novel')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('第1章 · 雾港'), Boolean, 25000, 'A chapters loaded')
  await page.eval(go('#/project/demo-order/novel'))
  await evalUntil(page, bodyHas('正在读取章节'), Boolean, 15000, 'novel reloading')
  if (await page.eval(bodyHas('雾港'))) throw new Error('旧章名残留')
  await evalUntil(page, bodyHas('第1章 · 晨港'), Boolean, 25000, 'B chapters loaded')
  if (await page.eval(bodyHas('雾港'))) throw new Error('旧章名残留(终)')
  page.close()
})

// ③ Outline 章卡列：同上
await step('③ Outline 章卡列切项目无旧章残留', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-delay=listChapters:1200,listDocs:1200#/project/demo-aseya/outline')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('第1章 · 雾港'), Boolean, 25000, 'A outline chapters')
  await page.eval(go('#/project/demo-order/outline'))
  if (await page.eval(bodyHas('雾港'))) throw new Error('旧章残留(过渡期)')
  await evalUntil(page, bodyHas('第1章 · 晨港'), Boolean, 25000, 'B outline chapters')
  if (await page.eval(bodyHas('雾港'))) throw new Error('旧章残留(终)')
  page.close()
})

// ④ DocSection（人物）文档列：阿七 → 苏晚；切后回落「选择左侧一个文档开始」（sel 置空防读失败卡）
await step('④ 人物文档列切项目无旧文档残留', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-delay=listDocs:1200#/project/demo-aseya/characters')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('阿七'), Boolean, 25000, 'A docs loaded')
  await page.eval(go('#/project/demo-order/characters'))
  await evalUntil(page, bodyHas('选择左侧一个文档开始'), Boolean, 15000, 'doc section reset view')
  if (await page.eval(bodyHas('阿七'))) throw new Error('旧文档残留(过渡期)')
  await evalUntil(page, bodyHas('苏晚'), Boolean, 25000, 'B docs loaded')
  if (await page.eval(bodyHas('阿七'))) throw new Error('旧文档残留(终)')
  page.close()
})

// ⑤ LibraryBrowser 素材库：旧项目素材不残留 → demo-order 空态文案
await step('⑤ 素材库切项目无旧素材残留', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-delay=listDocs:1200#/project/demo-aseya/library')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('校园图书馆'), Boolean, 25000, 'A mats loaded')
  await page.eval(go('#/project/demo-order/library'))
  await evalUntil(page, bodyHas('还没有类别'), Boolean, 15000, 'B mats empty state')
  if (await page.eval(bodyHas('校园图书馆'))) throw new Error('旧素材残留(终)')
  page.close()
})

console.log(`\nRESULT ${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
