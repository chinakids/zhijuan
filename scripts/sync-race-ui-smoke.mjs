// 织卷无头冒烟 · Novel 浮条 6s 自动清除竞态（创作层 2026-09-19 00:45 轮，观察项「Novel 浮条 6s 定时器与二次保存竞态」）
// 背景：doSync 成功路径每次 window.setTimeout(6s) 清浮条、不清理旧 timer——
//   A）6s 内二次保存：旧 timer 会提前清掉第二次提示（只显示 <6s）；
//   B）成功→失败：旧 timer 会把常驻失败提示（「失败可感知可重试」语义）清掉；
// C）失败→重试成功：正常 6s 清除不应回归。
// 用法：node scripts/sync-race-ui-smoke.mjs
// 前置：npm run build && node scripts/serve-renderer.mjs（8123）；本机无头 Chrome CDP 127.0.0.1:9224
// 判定：A2 为红→绿核心断言（修复前旧 timer 在保存2后 ~4-5s 清掉浮条；修复后 timerB 在保存2后 6s 才清）
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

async function openNovel(qs) {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + qs + '#/project/demo-aseya/novel')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('第1章'), Boolean, 20000, '正文页载入')
  await page.eval(clickBtn('第1章 · 雾港', false))
  await evalUntil(page, `window.__ZJ_EDITORS && window.__ZJ_EDITORS.length > 0`, Boolean, 20000, '编辑器挂载')
  await page.eval(`(window.__ZJ_SYNCS ??= []); true`)
  return page
}

// ---------- A：6s 内二次保存竞态（核心红→绿） ----------
{
  const page = await openNovel('&zj-slice=雾港夜')
  try {
    await page.eval(`window.__ZJ_EDITORS[0].applyMarkdown('竞态A1：雾更浓了。', false)`)
    await evalUntil(page, bodyHas('未保存'), Boolean, 10000, '文档变脏A1')
    await page.eval(clickBtn('保存', false))
    await evalUntil(page, `(window.__ZJ_SYNCS ?? []).length`, (n) => n >= 1, 20000, '同步A1被触发')
    await evalUntil(page, bodyHas('✓ 无设定变化'), Boolean, 15000, 'A1 浮条出现')
    ok('A① 保存1：✓ 浮条出现', true)

    await sleep(800)
    await page.eval(`window.__ZJ_EDITORS[0].applyMarkdown('竞态A2：浪更急了。', false)`)
    await evalUntil(page, bodyHas('未保存'), Boolean, 10000, '文档变脏A2')
    await page.eval(clickBtn('保存', false))
    await evalUntil(page, `(window.__ZJ_SYNCS ?? []).length`, (n) => n >= 2, 20000, '同步A2被触发')
    await evalUntil(page, bodyHas('✓ 无设定变化'), Boolean, 15000, 'A2 浮条出现')
    ok('A② 保存2：✓ 浮条重新出现（6s 内二次保存）', true)

    // 等 5.2s：此时离保存1 ≈ 6.5-7s（旧 timerA 已触发清空=修复前 FAIL），离保存2 ≈ 5.2s（新 timerB 未到=修复后 PASS）
    await page.eval(`new Promise((r) => setTimeout(r, 5200))`)
    const stillThere = await page.eval(bodyHas('✓ 无设定变化'))
    ok('A③ 浮条在保存2后 ~5.2s 仍可见（旧 6s timer 未提前清二次提示）', stillThere === true)
  } finally {
    page.close()
    ok('A④ 无 JS 异常', page.errors.length === 0, page.errors.join('; ').slice(0, 200))
  }
}

// ---------- B：持续失败 → 失败提示常驻（超 6s 不被任何 timer 清） ----------
{
  const page = await openNovel('&zj-slice=雾港夜&zj-fail-x=agentSync')
  try {
    await page.eval(`window.__ZJ_EDITORS[0].applyMarkdown('竞态B1：潮更低了。', false)`)
    await evalUntil(page, bodyHas('未保存'), Boolean, 10000, '文档变脏B1')
    await page.eval(clickBtn('保存', false))
    await evalUntil(page, `(window.__ZJ_SYNCS ?? []).length`, (n) => n >= 1, 20000, '同步B1被触发')
    await evalUntil(page, bodyHas('✗ 切片同步失败'), Boolean, 15000, 'B1 失败浮条')
    ok('B① 持续失败：✗ 失败浮条出现', true)
    await page.eval(`new Promise((r) => setTimeout(r, 6500))`)
    const still = await page.eval(bodyHas('✗ 切片同步失败'))
    ok('B② 失败浮条 6.5s 后仍常驻（失败不随自动清除）', still === true)
  } finally {
    page.close()
    ok('B③ 无 JS 异常', page.errors.length === 0, page.errors.join('; ').slice(0, 200))
  }
}

// ---------- C：失败→重试成功→正常 6s 清除（回归） ----------
{
  const page = await openNovel('&zj-slice=雾港夜&zj-fail=agentSync')
  try {
    await page.eval(`window.__ZJ_EDITORS[0].applyMarkdown('竞态C1：雨更密了。', false)`)
    await evalUntil(page, bodyHas('未保存'), Boolean, 10000, '文档变脏C1')
    await page.eval(clickBtn('保存', false))
    await evalUntil(page, `(window.__ZJ_SYNCS ?? []).length`, (n) => n >= 1, 20000, '同步C1被触发')
    await evalUntil(page, bodyHas('✗ 切片同步失败'), Boolean, 15000, 'C1 失败浮条')
    await page.eval(clickBtn('重试同步', false))
    await evalUntil(page, `(window.__ZJ_SYNCS ?? []).length`, (n) => n >= 2, 20000, '重试同步被触发')
    await evalUntil(page, bodyHas('✓ 无设定变化'), Boolean, 15000, 'C2 重试成功浮条')
    ok('C① 失败→重试→✓ 浮条（重试链路正常）', true)
    await page.eval(`new Promise((r) => setTimeout(r, 6600))`)
    const gone = await page.eval(bodyHas('✓ 无设定变化'))
    ok('C② 成功浮条 6.6s 后按预期清除（正常自动清除未回归）', gone === false)
  } finally {
    page.close()
    ok('C③ 无 JS 异常', page.errors.length === 0, page.errors.join('; ').slice(0, 200))
  }
}

console.log(`\n==== sync-race-ui-smoke: ${pass}/${pass + fail} ====`)
process.exit(fail > 0 ? 1 : 0)
