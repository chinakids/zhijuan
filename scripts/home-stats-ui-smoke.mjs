// 织卷无头冒烟 · 首页项目卡片元信息完整性（模块设计 §四 A：每卡「章节数·人物数·素材数」）
// 用法：node scripts/home-stats-ui-smoke.mjs
// 前置：out/renderer 已 build；python3 scripts/spa_server.py 8123 --directory out/renderer；本机无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 卡片封面小字出现且带 data-testid="zj-card-stats"；
//         ② 每张卡「N 章 · 人物 N · 素材 N」与 window.zhijuan.listProjects() 的 stats 动态一致（含素材数，不硬编）；
//         ③ 回归：文本同时含「章」「人物」；
//         ④ 全程零 JS 异常。
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const ok = (label) => console.log('OK', label)
const bad = (label, why) => {
  failures++
  console.log('FAIL', label, '::', why)
}

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

async function evalUntil(page, expr, pred, timeoutMs = 15000, label = expr) {
  const t0 = Date.now()
  for (;;) {
    try {
      const v = await page.eval(expr)
      if (pred(v)) return v
    } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(250)
  }
}

// ===================== 主流程 =====================
const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)

try {
  await page.eval(`(() => {
    window.__zjErr = []
    window.addEventListener('error', (e) => window.__zjErr.push(String(e.message || e)))
    window.addEventListener('unhandledrejection', (e) => window.__zjErr.push('REJ:' + String(e.reason)))
  })()`)

  await evalUntil(
    page,
    `document.querySelectorAll('[data-testid="zj-card-stats"]').length`,
    (v) => v > 0,
    20000,
    '卡片封面元信息就绪'
  )
  ok('① 卡片封面元信息出现（data-testid=zj-card-stats）')

  // 动态对照：UI 卡片文本（按「最近打开」排序，不依赖顺序）应精确等于所有项目 stats 的期望文本集合
  const ui = await page.eval(`(() => {
    return [...document.querySelectorAll('[data-testid="zj-card-stats"]')].map((p) => p.innerText.trim())
  })()`)
  const stats = await page.eval(`window.zhijuan.listProjects().then((ps) => ps.map((p) => p.stats))`)
  if (ui.length !== stats.length) bad('② 卡片数与项目数一致', `ui=${ui.length} stats=${stats.length}`)
  else {
    const expectSet = new Set(stats.map((s) => `${s.chapters} 章 · 人物 ${s.characters} · 素材 ${s.materials}`))
    const uiSet = new Set(ui)
    const missing = [...expectSet].filter((t) => !uiSet.has(t))
    const extra = [...uiSet].filter((t) => !expectSet.has(t))
    if (missing.length || extra.length) bad('② 每卡文本与 stats 集合一致（含素材数）', `missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}`)
    else ok('② 每卡「N 章 · 人物 N · 素材 N」与 stats 一致（含素材数；样本：' + [...uiSet].join(' / ') + '）')
  }

  // 回归：同时含「章」与「人物」
  const okShape = ui.every((t) => t.includes('章') && t.includes('人物'))
  if (!okShape) bad('③ 卡片文本含「章」「人物」', JSON.stringify(ui))
  else ok('③ 回归：卡片文本含「章」「人物」')

  // ④ 零 JS 异常
  const errs = await page.eval(`window.__zjErr`)
  if (errs.length > 0) bad('④ 零 JS 异常', JSON.stringify(errs))
  else ok('④ 全程零 JS 异常')

  // 可选留证截图：ZJ_SHOT=/path/xx.png node scripts/home-stats-ui-smoke.mjs
  if (process.env.ZJ_SHOT) {
    const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(process.env.ZJ_SHOT, Buffer.from(shot.data, 'base64'))
    console.log('SHOT saved', process.env.ZJ_SHOT)
  }
} catch (e) {
  bad('主流程', String(e && e.stack ? e.stack : e))
}

console.log(failures === 0 ? 'ALL PASS' : 'SMOKE FAIL ' + failures)
await page.close()
process.exit(failures === 0 ? 0 : 1)
