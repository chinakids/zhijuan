// 织卷无头冒烟 · 切片同步「在途切章结果落错页」归属校验（创作层 2026-09-22 12:45 轮，候选 3）
// 背景：切片同步=真模型调用（30s~min 级），作者在同步在途切到另一章时，完成的 setSyncMsg/
//   失败重试/守卫明细若照常写入=旧章结果落错页（作者误以为当前章刚同步过/失败，重试按钮还会
//   在别章页上触发旧章同步）。修复语义=React 官方 race condition 修复「ignore stale responses」
//   同构：过期结果丢弃、仅在发起上下文仍为当前时应用；数据动作（提案 bump/排队重跑）不受影响。
// 原理：?zj-syncdelay=N 让 devShim agentSync mock 延迟 N ms（模拟真模型耗时），在途窗口内切章。
// 用法：node scripts/sync-relocate-ui-smoke.mjs
// 前置：npm run build && node scripts/serve-renderer.mjs（8123）；本机无头 Chrome CDP 127.0.0.1:9224
// 判定：A⑤ 为红→绿核心断言（修复前切走后在别章页仍出现「✓ 无设定变化」；修复后不出现、同步仍跑）
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
  const errors = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
      return
    }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push('EXC: ' + JSON.stringify(m.params?.exceptionDetails?.exception?.description ?? m.params).slice(0, 200))
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
      errors.push('CONSOLE: ' + JSON.stringify(m.params.args?.map((a) => a.value ?? a.description)).slice(0, 200))
    }
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
        cmd,
        eval: async (expression) => {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
          return r.result?.value
        },
        close: () => ws.close(),
        errors
      })
    }
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
const clickBtn = (text, exact = false) => `(() => {
  const els = [...document.querySelectorAll('button')]
  const el = els.find((b) => ${exact ? `(b.innerText || '').trim() === ${JSON.stringify(text)}` : `(b.innerText || '').includes(${JSON.stringify(text)})`})
  if (!el) return false
  el.click()
  return true
})()`
// 等请求完成（完成时刻+渲染余量）：同步被触发后，按 __ZJ_SYNC_TIMES[0] + 4000ms 判断
async function waitSyncDone(page, delayMs) {
  await evalUntil(page, `(window.__ZJ_SYNCS ?? []).length`, (n) => n >= 1, 20000, '同步被触发')
  await evalUntil(
    page,
    `Date.now() - (window.__ZJ_SYNC_TIMES?.[0] ?? Infinity)`,
    (elapsed) => elapsed >= delayMs + 800,
    delayMs + 8000,
    '同步完成(延迟窗口过)'
  )
  await sleep(500)
}

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

// ---------- A：在途切章 → 旧章结果不落新页（核心红→绿）；同步数据仍执行 ----------
{
  const page = await openTab(BASE + '/?cb=' + Date.now() + '&zj-slice=雾港夜&zj-syncdelay=4000#/project/demo-aseya/novel')
  const page2 = await attach(page.webSocketDebuggerUrl)
  try {
    await evalUntil(page2, bodyHas('第1章'), Boolean, 20000, '正文页载入')
    await page2.eval(clickBtn('第1章 · 雾港', false))
    await evalUntil(page2, `window.__ZJ_EDITORS && window.__ZJ_EDITORS.length > 0`, Boolean, 20000, '编辑器挂载')
    await page2.eval(`(window.__ZJ_SYNCS ??= []); (window.__ZJ_SYNC_TIMES ??= []); true`)

    await page2.eval(`window.__ZJ_EDITORS[0].applyMarkdown('迁徙A1：雾更浓了。', false)`)
    await evalUntil(page2, bodyHas('未保存'), Boolean, 10000, '文档变脏A1')
    await page2.eval(clickBtn('保存', false))
    await evalUntil(page2, `(window.__ZJ_SYNCS ?? []).length`, (n) => n >= 1, 10000, '同步A1被触发')
    await evalUntil(page2, bodyHas('切片同步中…'), Boolean, 10000, 'A1 在途浮条')
    ok('A① 保存1：同步在途浮条「切片同步中…」（发起章页正常显示）', true)

    // 在途窗口内切到第2章
    await page2.eval(clickBtn('第2章 · 灯塔', false))
    await evalUntil(page2, `(window.__ZJ_EDITORS?.[0]?.getMarkdown?.() ?? '').includes('本章待写')`, Boolean, 15000, '已切到第2章(编辑器内容=第2章)')
    await evalUntil(page2, `!document.body.innerText.includes('未保存') && !document.body.innerText.includes('切片同步')`, Boolean, 10000, '切章后浮条被清')

    await waitSyncDone(page2, 4000)
    const nSync = await page2.eval(`(window.__ZJ_SYNCS ?? []).length`)
    const firstRel = await page2.eval(`(window.__ZJ_SYNCS ?? [])[0] ?? ''`)
    const barNow = await page2.eval(`document.body.innerText.includes('无设定变化') || document.body.innerText.includes('切片同步')`)
    ok('A② 同步完成：仍在第2章页（编辑器内容不变）', await page2.eval(`(window.__ZJ_EDITORS?.[0]?.getMarkdown?.() ?? '').includes('本章待写')`))
    ok('A③ 同步仍执行（__ZJ_SYNCS=1，数据动作不受归属影响）', nSync === 1, 'n=' + nSync)
    ok('A④ 触发章=第1章（rel 记录正确）', firstRel === 'demo-aseya|正文/第01章_雾港.md', firstRel)
    ok('A⑤ 核心：旧章结果未落新页（无「无设定变化」/无同步浮条）', barNow === false, barNow ? '仍有残留' : 'ok')
  } finally {
    page2.close()
    ok('A⑥ 无 JS 异常', page2.errors.length === 0, page2.errors.join('; ').slice(0, 200))
  }
}

// ---------- B：对照组——作者留守发起章，结果照常显示（归属校验零回归） ----------
{
  const page = await openTab(BASE + '/?cb=' + Date.now() + '&zj-slice=雾港夜&zj-syncdelay=4000#/project/demo-aseya/novel')
  const page2 = await attach(page.webSocketDebuggerUrl)
  try {
    await evalUntil(page2, bodyHas('第1章'), Boolean, 20000, '正文页载入')
    await page2.eval(clickBtn('第1章 · 雾港', false))
    await evalUntil(page2, `window.__ZJ_EDITORS && window.__ZJ_EDITORS.length > 0`, Boolean, 20000, '编辑器挂载')
    await page2.eval(`window.__ZJ_EDITORS[0].applyMarkdown('留守B1：浪更急了。', false)`)
    await evalUntil(page2, bodyHas('未保存'), Boolean, 10000, '文档变脏B1')
    await page2.eval(clickBtn('保存', false))
    await evalUntil(page2, bodyHas('切片同步中…'), Boolean, 10000, 'B 在途浮条')
    await evalUntil(page2, bodyHas('✓ 无设定变化'), Boolean, 20000, 'B 留守完成浮条')
    ok('B① 留守发起章：完成浮条「✓ 无设定变化」照常出现（归属门未误伤）', true)
  } finally {
    page2.close()
    ok('B② 无 JS 异常', page2.errors.length === 0, page2.errors.join('; ').slice(0, 200))
  }
}

// ---------- C：失败在途切章 → 失败条/重试按钮不落新页 ----------
{
  const page = await openTab(BASE + '/?cb=' + Date.now() + '&zj-slice=雾港夜&zj-syncdelay=4000&zj-fail-x=agentSync#/project/demo-aseya/novel')
  const page2 = await attach(page.webSocketDebuggerUrl)
  try {
    await evalUntil(page2, bodyHas('第1章'), Boolean, 20000, '正文页载入')
    await page2.eval(clickBtn('第1章 · 雾港', false))
    await evalUntil(page2, `window.__ZJ_EDITORS && window.__ZJ_EDITORS.length > 0`, Boolean, 20000, '编辑器挂载')
    await page2.eval(`window.__ZJ_EDITORS[0].applyMarkdown('迁徙C1：潮更低落。', false)`)
    await evalUntil(page2, bodyHas('未保存'), Boolean, 10000, '文档变脏C1')
    await page2.eval(clickBtn('保存', false))
    await evalUntil(page2, `(window.__ZJ_SYNCS ?? []).length`, (n) => n >= 1, 10000, '同步C1被触发')
    await evalUntil(page2, bodyHas('切片同步中…'), Boolean, 10000, 'C1 在途浮条')

    await page2.eval(clickBtn('第2章 · 灯塔', false))
    await evalUntil(page2, `(window.__ZJ_EDITORS?.[0]?.getMarkdown?.() ?? '').includes('本章待写')`, Boolean, 15000, '已切到第2章')

    await waitSyncDone(page2, 4000)
    const barNow = await page2.eval(`document.body.innerText.includes('切片同步失败') || document.body.innerText.includes('重试同步')`)
    ok('C① 失败未落新页（无「切片同步失败」/「重试同步」）', barNow === false, barNow ? '仍有残留' : 'ok')
  } finally {
    page2.close()
    ok('C② 无 JS 异常', page2.errors.length === 0, page2.errors.join('; ').slice(0, 200))
  }
}

console.log(`\n==== sync-relocate-ui-smoke: ${pass}/${pass + fail} ====`)
process.exit(fail > 0 ? 1 : 0)
