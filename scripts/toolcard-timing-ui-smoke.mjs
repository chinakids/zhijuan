// 织卷无头冒烟 · 工具活动卡耗时显示（meta→meta-done 计时 + 进行中「已 Ns」tick）
// 用法：node scripts/toolcard-timing-ui-smoke.mjs
// 前置：npm run build；python3 -m http.server 8123 --directory out/renderer；CDP 9224
// 验收：① devShim 演示（zj-agent-delay=1600）zj_read_doc 进行中卡显示「已 1.x s」；
//       ② meta-done 完成后卡显示总耗时（x.xs）；③ 进行中 tick 每秒更新；④ 无 JS 异常。
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

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'OK ' : 'NG ') + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-agent-delay=1600#/project/demo-aseya/novel')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)

try {
  await evalUntil(page, `document.body.innerText.includes('Agent') && !!document.querySelector('textarea')`, (v) => v === true, 20000, 'Novel+Agent 就绪')
  ok('① Novel 页 + agent 输入框就绪', true)

  // 聚焦输入框并真实键入普通 prompt（不含演示触发词，devShim 只走 think+zj_read_doc）
  await page.cmd('DOM.enable')
  const doc = await page.cmd('DOM.getDocument')
  const { nodeId } = await page.cmd('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'textarea' })
  await page.cmd('DOM.focus', { nodeId })
  await page.cmd('Input.insertText', { text: '看看当前章节的设定' })
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 })
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })

  // ② 进行中卡出现（meta 已发 → zj_read_doc 卡 spinner + args）
  await evalUntil(page, `document.body.innerText.includes('正文/第01章_雾港.md')`, (v) => v === true, 15000, '工具卡出现')
  ok('② 工具卡（zj_read_doc 进行中）出现', true)

  // ③ 进行中「已 Ns」tick（meta 后 1s 起每秒更新；delay=1600 保证 meta-done 前至少有 1 次 tick）
  await evalUntil(
    page,
    `(() => { const cards = [...document.querySelectorAll('div')].filter((d) => d.className && /rounded-lg/.test(d.className) && d.innerText.includes('正文/第01章_雾港.md')); return cards.map((c) => c.innerText).find((t) => /已 [0-9]/.test(t)) ?? '' })()`,
    (v) => /已 [1-9](\.[0-9])?s/.test(v),
    12000,
    '进行中耗时 tick（≥1s 更新）'
  )
  const liveText = await page.eval(`(() => { const cards = [...document.querySelectorAll('div')].filter((d) => d.className && /rounded-lg/.test(d.className) && d.innerText.includes('正文/第01章_雾港.md')); return cards.map((c) => c.innerText).find((t) => /已 [0-9]/.test(t)) ?? '' })()`)
  ok('③ 进行中显示「已 Ns」且每秒更新（非 0.0s 停滞）', /已 [1-9](\.[0-9])?s/.test(liveText), liveText.replace(/\n/g, ' | '))

  // ④ meta-done 后：完成卡显示总耗时（x.xs，去掉「已」前缀），tick 徽章消失
  await evalUntil(page, `document.body.innerText.includes('章节已读完')`, (v) => v === true, 15000, 'meta-done 摘要')
  await sleep(400)
  const doneText = await page.eval(`(() => { const cards = [...document.querySelectorAll('div')].filter((d) => d.className && /rounded-lg/.test(d.className) && d.innerText.includes('正文/第01章_雾港.md')); return cards.map((c) => c.innerText).join(' || ') })()`)
  const hasDur = /([0-9]+(\.[0-9])?s|[0-9]+m[0-9]+s)/.test(doneText)
  const noLive = !/已 [0-9]/.test(doneText)
  ok('④ 完成后显示总耗时且进行中徽章消失', hasDur && noLive, doneText.replace(/\n/g, ' | ').slice(0, 200))

  // ⑤ 无 JS 异常
  const errs = page.errors.filter((e) => !/ResizeObserver/.test(e) && !/Download the React DevTools/.test(e) && !/DevTools/.test(e))
  ok('⑤ 无 JS 异常', errs.length === 0, errs.slice(0, 3).join(' ;; '))
} catch (e) {
  console.error('FATAL ' + e.message)
  fails++
}
page.close()

console.log(fails === 0 ? 'SMOKE PASS' : 'SMOKE FAIL (' + fails + ')')
process.exit(fails === 0 ? 0 : 1)
