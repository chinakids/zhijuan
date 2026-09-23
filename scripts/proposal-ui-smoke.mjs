// 织卷无头冒烟 · 提案抽屉（ProposalDrawer）——切片归属展示
// 用法：node scripts/proposal-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；CDP 9224
// 验收点：① 提案卡显示「章：<chapter>」「切片：<slice>」归属；② 无 slice 时只显示章；③ 无 JS 异常。
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
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push((m.params.exceptionDetails?.exception?.description ?? '').slice(0, 200))
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push((m.params.args?.map((a) => a.value ?? a.description ?? '').join(' ') ?? '').slice(0, 200))
    }
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
        cmd,
        errors,
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

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)
let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'OK ' : 'NG ') + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

try {
  // ① 页面就绪（devShim 已挂）
  await evalUntil(page, `typeof window.zhijuan !== 'undefined' && typeof window.zhijuan.createProposals === 'function'`, (v) => v === true, 20000, 'devShim 就绪')

  // 植入一条带切片的 slice-sync 提案 + 一条无切片的 agent 提案（直接走 shim，模拟保存同步产物）
  await page.eval(`(() => {
    window.zhijuan.createProposals('demo-aseya', 'slice-sync', '第01章_雾港.md', '第一幕_雾港之夜', [{
      target: '人物/林晓.md', anchor: '切片：第一幕_雾港之夜', kind: 'upsert-section', before: '', after: '- 本幕动向：主动靠近', reason: '测试'
    }])
    window.zhijuan.createProposals('demo-aseya', 'agent-chat', '第2章_灯下.md', '', [{
      target: '人物/韩青.md', anchor: '', kind: 'append', before: '', after: '- 台词调整', reason: '测试2'
    }])
    return 1
  })()`)

  // ② 进入工作区页（首次挂载即 refresh 提案列表）→ 徽标出现 → 点开抽屉
  await page.eval(`(location.hash = '#/project/demo-aseya/novel', 1)`)
  await evalUntil(page, `document.body.innerText.includes('待确认提案') && [...document.querySelectorAll('button')].some((x) => x.title && x.title.includes('待确认') && (x.innerText || '').includes('2'))`, (v) => v === true, 20000, '待确认徽标')
  await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.includes('待确认提案')); return b ? (b.click(), 'CLICKED') : 'NOT_FOUND' })()`)

  // ③ 抽屉里出现章/切片归属（卡片级选择器）
  await evalUntil(page, `document.body.innerText.includes('切片：第一幕_雾港之夜')`, (v) => v === true, 10000, '切片归属显示')
  const cardText = await page.eval(`[...document.querySelectorAll('.rounded-xl')].find((x) => x.innerText?.includes('人物/林晓.md'))?.innerText ?? ''`)
  ok('slice-sync 卡：章+切片归属', cardText.includes('章：第01章_雾港.md') && cardText.includes('切片：第一幕_雾港之夜'), cardText.replace(/\\n/g, ' | ').slice(0, 120))
  const card2Text = await page.eval(`[...document.querySelectorAll('.rounded-xl')].find((x) => x.innerText?.includes('人物/韩青.md'))?.innerText ?? ''`)
  ok('agent 卡：无切片只显示章', card2Text.includes('章：第2章_灯下.md') && !card2Text.includes('切片：'), card2Text.replace(/\\n/g, ' | ').slice(0, 120))

  // ④ 无页面异常
  const errs = page.errors.filter((e) => !/ResizeObserver/.test(e) && !/Download the React DevTools/.test(e))
  ok('无 JS 异常', errs.length === 0, errs.slice(0, 3).join(' ;; '))
} catch (e) {
  console.error('FATAL ' + e.message)
  fails++
} finally {
  page.close()
  console.log(fails === 0 ? 'SMOKE PASS' : 'SMOKE FAIL (' + fails + ')')
  process.exit(fails === 0 ? 0 : 1)
}
