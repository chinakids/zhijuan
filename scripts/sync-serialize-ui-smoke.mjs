// 织卷无头冒烟 · 同章切片同步「在途排队合并」（创作层 2026-09-22 09:45 轮，候选 3）
// 背景：切片同步=真模型调用（30s~min 级），Novel 保存入口此前无在途防护——作者在同步进行中再次保存
//   （改错别字/续写）会并发双跑 runSync（P1 排查看 09:29:18/09:30:14 两个并发 runSync 会话实锤）。
// 修复语义=GitHub Actions concurrency 同构：同一 group 同时最多一个在跑、新请求 pending 且只留最新；
//   在途期间的新保存在同步完成后串行重跑一次（读盘=最新保存内容，最终态必被比对）。
// 原理：?zj-syncdelay=N 让 devShim agentSync mock 延迟 N ms（模拟真模型耗时），在途窗口内连续保存 2 次。
// 用法：node scripts/sync-serialize-ui-smoke.mjs
// 前置：npm run build && node scripts/serve-renderer.mjs（8123）；本机无头 Chrome CDP 127.0.0.1:9224
// 判定：A③ 为红→绿核心断言（修复前第二次保存立即又触发一条=并发；修复后排队不触发、完成后串行补跑一次）
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

// ---------- A：在途期间连续保存 2 次 → 排队合并、串行补跑一次（核心红→绿） ----------
{
  const page = await openTab(BASE + '/?cb=' + Date.now() + '&zj-slice=雾港夜&zj-syncdelay=4000#/project/demo-aseya/novel')
  const page2 = await attach(page.webSocketDebuggerUrl)
  try {
    await evalUntil(page2, bodyHas('第1章'), Boolean, 20000, '正文页载入')
    await page2.eval(clickBtn('第1章 · 雾港', false))
    await evalUntil(page2, `window.__ZJ_EDITORS && window.__ZJ_EDITORS.length > 0`, Boolean, 20000, '编辑器挂载')
    await page2.eval(`(window.__ZJ_SYNCS ??= []); (window.__ZJ_SYNC_TIMES ??= []); true`)

    // 保存1：同步 A1 在途（mock 延迟 4000ms 模拟真模型耗时）
    await page2.eval(`window.__ZJ_EDITORS[0].applyMarkdown('串行A1：雾更浓了。', false)`)
    await evalUntil(page2, bodyHas('未保存'), Boolean, 10000, '文档变脏A1')
    await page2.eval(clickBtn('保存', false))
    await evalUntil(page2, `(window.__ZJ_SYNCS ?? []).length`, (n) => n >= 1, 20000, '同步A1被触发')
    ok('A① 保存1：同步被触发（A1 在途）', true)

    await evalUntil(page2, bodyHas('切片同步中…'), Boolean, 10000, 'A1 在途浮条')
    ok('A② 浮条「切片同步中…」（同步进行中可感知）', true)

    // 在途期间连续保存 2 次（A2/A3）：按新语义=排队合并，不立即再触发
    await page2.eval(`window.__ZJ_EDITORS[0].applyMarkdown('串行A2：浪更急了。', false)`)
    await evalUntil(page2, bodyHas('未保存'), Boolean, 10000, '文档变脏A2')
    await page2.eval(clickBtn('保存', false))
    await page2.eval(`window.__ZJ_EDITORS[0].applyMarkdown('串行A3：潮更低落。', false)`)
    await evalUntil(page2, bodyHas('未保存'), Boolean, 10000, '文档变脏A3')
    await page2.eval(clickBtn('保存', false))

    // A3 保存后：排队态明示（2026-09-22 15:45 创作层，NN/g #1 反馈）——作者需知第二次保存已被接住
    await evalUntil(page2, bodyHas('新保存已排队'), Boolean, 5000, '排队态浮条')
    ok('A②b 在途保存后浮条明示「新保存已排队」（修复前=仍只有「切片同步中…」）', true)
    try {
      const shot = await page2.cmd('Page.captureScreenshot', { format: 'png' })
      const { mkdirSync, writeFileSync } = await import('node:fs')
      mkdirSync(process.env.HOME + '/Pictures/zhijuan', { recursive: true })
      const sp = process.env.HOME + '/Pictures/zhijuan/sync-queued-' + new Date().toTimeString().slice(0, 5).replace(':', '') + '.png'
      writeFileSync(sp, Buffer.from(shot.data, 'base64'))
      console.log('SCREENSHOT ' + sp)
    } catch (e) {
      console.log('SCREENSHOT_FAIL ' + String(e))
    }

    await page2.eval(`new Promise((r) => setTimeout(r, 600))`)
    const nMid = await page2.eval(`(window.__ZJ_SYNCS ?? []).length`)
    ok('A③ 在途期间 2 次保存：600ms 后同步调用数仍为 1（排队未并发，修复前=3）', nMid === 1, 'n=' + nMid)

    // 排队重跑：A1 完成后串行补跑一次（最终 __ZJ_SYNCS=2，不是 3——「只留最新」语义）
    await evalUntil(page2, `(window.__ZJ_SYNCS ?? []).length`, (n) => n >= 2, 15000, '排队重跑被触发')
    const times = await page2.eval(`window.__ZJ_SYNC_TIMES ?? []`)
    const nEnd = await page2.eval(`(window.__ZJ_SYNCS ?? []).length`)
    ok('A④ 完成后串行补跑一次（总数 2，非 3；在途期多保存合并为一次）', nEnd === 2, 'n=' + nEnd)
    ok(
      'A⑤ 串行时序：第二次调用距第一次 ≥4000ms（无并发双跑）',
      times.length >= 2 && times[1] - times[0] >= 4000,
      'gap=' + (times.length >= 2 ? times[1] - times[0] : '?')
    )

    await evalUntil(page2, bodyHas('✓ 无设定变化'), Boolean, 10000, '重跑完成浮条')
    ok('A⑥ 重跑完成：✓ 浮条出现（最终态已比对）', true)
  } finally {
    page2.close()
    ok('A⑦ 无 JS 异常', page2.errors.length === 0, page2.errors.join('; ').slice(0, 200))
  }
}

console.log(`\n==== sync-serialize-ui-smoke: ${pass}/${pass + fail} ====`)
process.exit(fail > 0 ? 1 : 0)
